import { Router } from 'express';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import {
  sellRequestBodySchema,
  sellQuoteBodySchema,
  sellStatusBodySchema,
  sellPayoutBodySchema,
  restockBodySchema,
} from '../schemas.js';

export const sellRouter = Router();

/**
 * No adapter/mock wiring — see the B5 report. The mock's SellStatus enum
 * (received|quoted|accepted|paid|declined) reuses 'received' for the
 * INITIAL submission; the schema's sell_request_status uses 'received' for
 * a LATER state (the device has physically arrived at the shop, after
 * acceptance) and has a distinct 'submitted' for the initial state, plus
 * 'rejected' (device inspected and found unfit) which the mock has no value
 * for at all. The same word means two different points in the flow on each
 * side — not a naming gap a hyphen/underscore swap can fix. Built here to
 * match the schema exactly.
 */

function toApiSellRequest(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    preferredContact: row.preferred_contact,
    deviceId: row.device_id,
    deviceOther: row.device_other,
    condition: row.condition,
    status: row.status,
    quotedAmount: row.quoted_amount,
    quotedBy: row.quoted_by,
    quotedAt: row.quoted_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

sellRouter.post('/requests', async (req, res) => {
  const parsed = sellRequestBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  if (!body.deviceId && !body.deviceOther) {
    return res.status(400).json({ error: 'Pick a device, or describe it under "something else".' });
  }

  const { data: row, error } = await supabaseAdmin
    .from('sell_requests')
    .insert({
      device_id: body.deviceId ?? null,
      device_other: body.deviceOther ?? null,
      condition: body.condition,
      name: body.name,
      phone: body.phone,
      email: body.email,
      preferred_contact: body.preferredContact,
      notes: body.notes ?? null,
      // No automatic grading or pricing anywhere — quoted_amount stays null
      // until a person sets it (POST /requests/:id/quote below).
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiSellRequest(row));
});

/** Guest read-back: reference + email. */
sellRouter.get('/requests/by-reference/:reference', async (req, res) => {
  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : null;
  const { data: row } = await supabaseAdmin
    .from('sell_requests')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();
  if (!row || !email || (row.email as string).trim().toLowerCase() !== email) return res.json(null);
  return res.json(toApiSellRequest(row));
});

sellRouter.get(
  '/requests/:id',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const { data: row } = await supabaseAdmin
      .from('sell_requests')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!row) return res.status(404).json({ error: 'Sell request not found.' });
    return res.json(toApiSellRequest(row));
  },
);

/** Sets the quote AND moves status to 'quoted' in one call — always a person, never derived. */
sellRouter.post(
  '/requests/:id/quote',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = sellQuoteBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { data: row, error } = await supabaseAdmin
      .from('sell_requests')
      .update({
        quoted_amount: parsed.data.amount,
        quoted_by: req.user!.id,
        quoted_at: new Date().toISOString(),
        status: 'quoted',
      })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();

    if (error) return res.status(409).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Sell request not found.' });
    return res.json(toApiSellRequest(row));
  },
);

/** Staff-driven status moves (decline, mark received, reject) — the schema's own transition guard enforces legality. */
sellRouter.post(
  '/requests/:id/status',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = sellStatusBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { data: row, error } = await supabaseAdmin
      .from('sell_requests')
      .update({ status: parsed.data.status })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();

    if (error) return res.status(409).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Sell request not found.' });
    return res.json(toApiSellRequest(row));
  },
);

/* ---------------------------------------------------------------------- */
/* Guest-safe acceptance — single-use signed token                          */
/* ---------------------------------------------------------------------- */

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Staff/system issues an acceptance link after quoting. Returns the plaintext token ONCE — only its hash is ever stored. */
sellRouter.post(
  '/requests/:id/accept-token',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabaseAdmin.from('sell_request_acceptance_tokens').insert({
      sell_request_id: req.params.id,
      token_hash: hashToken(token),
      expires_at: expiresAt,
    });
    if (error) return res.status(400).json({ error: error.message });

    // The only response that ever carries the plaintext token — never
    // logged, never stored. A real deployment emails/texts this link;
    // returning it here stands in for that channel.
    return res.status(201).json({ token, expiresAt });
  },
);

/** Guest-facing: redeem the token from the acceptance link. No auth — the token itself is the proof of identity. */
sellRouter.post('/accept', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : null;
  if (!token) return res.status(400).json({ error: 'A token is required.' });

  const { data: sellRequestId, error } = await supabaseAdmin.rpc('redeem_sell_acceptance_token', {
    p_token_hash: hashToken(token),
  });
  if (error) return res.status(500).json({ error: 'Could not process this link.' });
  if (!sellRequestId) {
    return res
      .status(400)
      .json({ error: 'This link is invalid, expired, or has already been used.' });
  }

  const { data: row } = await supabaseAdmin
    .from('sell_requests')
    .select('*')
    .eq('id', sellRequestId)
    .single();
  return res.json(toApiSellRequest(row));
});

/* ---------------------------------------------------------------------- */
/* Payout — money OUT, excluded from revenue                                */
/* ---------------------------------------------------------------------- */

sellRouter.post(
  '/requests/:id/payout',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = sellPayoutBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await supabaseAdmin
      .from('trade_in_payouts')
      .insert({
        sell_request_id: req.params.id,
        device_label: body.deviceLabel,
        customer_name: body.customerName,
        // Stored negative — money OUT — enforced by the schema's own
        // `amount < 0` CHECK; the client sends a positive "what we paid"
        // figure (matches the mock's tradeInPayoutInputSchema, which is
        // always positive too) and this is the one place it gets negated.
        amount: -body.amount,
        method: body.method,
        staff_id: req.user!.id,
        notes: body.notes ?? null,
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({
      id: row.id,
      reference: row.reference,
      sellRequestId: row.sell_request_id,
      deviceLabel: row.device_label,
      customerName: row.customer_name,
      amount: row.amount,
      method: row.method,
      staffId: row.staff_id,
      notes: row.notes,
      restocked: row.restocked,
      createdAt: row.created_at,
    });
  },
);

/** Walk-in buy-in — no prior sell_request. Same payout table, sell_request_id null. */
sellRouter.post('/payouts', requireStaff, requirePermission('tradein.manage'), async (req, res) => {
  const parsed = sellPayoutBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await supabaseAdmin
    .from('trade_in_payouts')
    .insert({
      device_label: body.deviceLabel,
      customer_name: body.customerName,
      amount: -body.amount,
      method: body.method,
      staff_id: req.user!.id,
      notes: body.notes ?? null,
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({
    id: row.id,
    reference: row.reference,
    sellRequestId: row.sell_request_id,
    deviceLabel: row.device_label,
    customerName: row.customer_name,
    amount: row.amount,
    method: row.method,
    staffId: row.staff_id,
    createdAt: row.created_at,
  });
});

/* ---------------------------------------------------------------------- */
/* Restock — manual, staff-priced, never automatic                          */
/* ---------------------------------------------------------------------- */

sellRouter.post(
  '/payouts/:id/restock',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const parsed = restockBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: productId, error } = await supabaseAdmin.rpc('restock_trade_in', {
      p_payout_id: req.params.id,
      p_name: body.name,
      p_category: body.category,
      p_resale_price: body.resalePrice,
      p_kind: 'accessory',
      p_staff_id: req.user!.id,
    });
    if (error) return res.status(409).json({ error: error.message });

    const { data: product, error: productErr } = await supabaseAdmin
      .from('products')
      .select('id, slug, name, price, cost_price, stock_qty')
      .eq('id', productId)
      .single();
    if (productErr || !product)
      return res.status(500).json({ error: 'Restocked, but could not load the new product.' });
    return res.status(201).json({
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      costPrice: product.cost_price,
      stockQty: product.stock_qty,
    });
  },
);
