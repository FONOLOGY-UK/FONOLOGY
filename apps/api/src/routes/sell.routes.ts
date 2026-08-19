import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import {
  sellRequestBodySchema,
  sellQuoteBodySchema,
  sellStatusBodySchema,
  sellPayoutBodySchema,
  restockBodySchema,
  sellRequestListQuerySchema,
  payoutListQuerySchema,
} from '../schemas.js';
import { isRangeOverrun, page } from '../lib/pagination.js';
import { sendTransactionalEmail } from '../lib/email.js';
import { config } from '../config.js';

import { createRouter } from '../lib/router.js';

export const sellRouter = createRouter();

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
  // `device` is the embedded devices(name) resource from the `device:devices(name)`
  // select below — present whenever device_id is set, null for "something else"
  // requests and absent entirely if a caller forgot the join (falls back to null,
  // never to the raw id — see the fix in this pass for why that matters).
  const device = row.device as { name?: string } | null | undefined;
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    preferredContact: row.preferred_contact,
    deviceId: row.device_id,
    deviceName: device?.name ?? null,
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
    .select('*, device:devices(name)')
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
    .select('*, device:devices(name)')
    .eq('reference', reference)
    .maybeSingle();
  if (!row || !email || (row.email as string).trim().toLowerCase() !== email) return res.json(null);
  return res.json(toApiSellRequest(row));
});

/**
 * A queue row deliberately omits `condition` — the intake jsonb (storage,
 * screen, body, powers-on, network, accessories) is inspection detail for one
 * request, not something the queue lists or filters on. `GET /requests/:id`
 * returns it when a member of staff actually opens the request.
 */
// prettier-ignore
const SELL_QUEUE_COLUMNS = 'id, reference, customer_id, name, phone, email, preferred_contact, device_id, device_other, status, quoted_amount, quoted_by, quoted_at, notes, created_at, updated_at, device:devices(name)';

type SellListFilters = { status?: string[]; search?: string };

function sellSelect(head: boolean) {
  return supabaseAdmin.from('sell_requests').select(SELL_QUEUE_COLUMNS, { count: 'exact', head });
}

/** The filter half of the queue query, shared by the page and its count. */
function applySellFilters<Q extends ReturnType<typeof sellSelect>>(
  query: Q,
  { status, search }: SellListFilters,
): Q {
  let q = query;
  if (status && status.length > 0) {
    q = status.length === 1 ? q.eq('status', status[0]) : q.in('status', status);
  }
  if (search) {
    // Wildcards and commas stripped: a comma inside .or() reads as a filter
    // separator and would change the query's meaning, not just its terms.
    const term = search.replace(/[%_,]/g, '');
    if (term) {
      q = q.or(
        `reference.ilike.%${term}%,name.ilike.%${term}%,email.ilike.%${term}%,device_other.ilike.%${term}%`,
      );
    }
  }
  return q;
}

sellRouter.get('/requests', requireStaff, requirePermission('tradein.manage'), async (req, res) => {
  const parsed = sellRequestListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { status, search, sort, limit, offset } = parsed.data;
  const filters: SellListFilters = { status, search };

  let query = applySellFilters(sellSelect(false), filters);

  if (sort === 'created-asc') query = query.order('created_at', { ascending: true });
  else if (sort === 'updated-desc') query = query.order('updated_at', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    if (isRangeOverrun(error)) {
      const { count: total } = await applySellFilters(sellSelect(true), filters);
      return res.json(page([], total, limit, offset));
    }
    return res.status(500).json({ error: 'Could not load sell requests.' });
  }

  return res.json(
    page(
      (data ?? []).map((row) => toApiSellRequest(row as Record<string, unknown>)),
      count,
      limit,
      offset,
    ),
  );
});

sellRouter.get(
  '/requests/:id',
  requireStaff,
  requirePermission('tradein.manage'),
  async (req, res) => {
    const { data: row } = await supabaseAdmin
      .from('sell_requests')
      .select('*, device:devices(name)')
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
      .select('*, device:devices(name)')
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
      .select('*, device:devices(name)')
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

function acceptanceEmailHtml(customerName: string, url: string, expiresAt: string): string {
  // Matches the plain, no-frills style already used for the acceptance
  // screen itself (sell-accept.tsx) — no separate "marketing" template
  // system exists anywhere in this codebase to diverge from.
  const expiry = new Date(expiresAt).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  });
  return `
    <p>Hi ${customerName},</p>
    <p>Your trade-in quote is ready. Follow the link below to accept it and arrange sending your device in:</p>
    <p><a href="${url}">${url}</a></p>
    <p>This link works once and expires ${expiry}.</p>
    <p>Fonology</p>
  `;
}

/**
 * Staff/system issues an acceptance link after quoting. Returns the
 * plaintext token ONCE — only its hash is ever stored, here or anywhere
 * downstream. Also emails the link automatically via Brevo; the manual
 * copy-paste flow already in the admin screen stays as a fallback, so an
 * email failure never leaves staff with nothing they can hand the customer.
 *
 * The token appears in exactly two places: this one-time API response, and
 * the body of the one email sent here. Nothing logs it, including the email
 * lib's own error path (see lib/email.ts) — a failed send is reported by
 * status code, never by echoing what was being sent.
 */
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

    let emailSent = false;
    const { data: request } = await supabaseAdmin
      .from('sell_requests')
      .select('name, email')
      .eq('id', req.params.id)
      .single();

    if (request?.email) {
      const url = `${config.webAppUrl}/sell/accept?token=${encodeURIComponent(token)}`;
      const result = await sendTransactionalEmail({
        to: { email: request.email as string, name: request.name as string | undefined },
        subject: 'Your Fonology trade-in quote is ready',
        htmlContent: acceptanceEmailHtml((request.name as string) || 'there', url, expiresAt),
      });
      emailSent = result.sent;
    }

    // The only response that ever carries the plaintext token — the manual
    // copy-paste path in the admin screen still works from this regardless
    // of whether emailSent is true.
    return res.status(201).json({ token, expiresAt, emailSent });
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
    .select('*, device:devices(name)')
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

/**
 * The payout ledger — money the shop has paid OUT for devices.
 *
 * There was no way to READ these: only the two POSTs above existed, so a
 * payout could be recorded and then never listed. Amounts come back exactly
 * as stored, which is NEGATIVE — this is money out, and it is deliberately not
 * flipped to a friendly positive on the way through. `BUY-` references and
 * exclusion from every revenue figure are the schema's doing, not this
 * endpoint's.
 *
 * Staff names are resolved here rather than left as bare ids: shipping only
 * `staffId` is what broke the cash screen, where the frontend expected a name
 * and the parse threw.
 */
function toApiPayout(row: Record<string, unknown>, staffNames: Map<string, string>) {
  return {
    id: row.id,
    reference: row.reference,
    sellRequestId: row.sell_request_id,
    deviceLabel: row.device_label,
    customerName: row.customer_name,
    /** Negative. Money out. */
    amount: row.amount,
    method: row.method,
    staffId: row.staff_id,
    staffName: row.staff_id ? (staffNames.get(row.staff_id as string) ?? null) : null,
    notes: row.notes ?? null,
    restocked: row.restocked,
    resalePrice: row.resale_price ?? null,
    restockedProductId: row.restocked_product_id ?? null,
    createdAt: row.created_at,
  };
}

async function staffNamesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('staff').select('id, name').in('id', unique);
  return new Map((data ?? []).map((r) => [r.id as string, r.name as string]));
}

sellRouter.get('/payouts', requireStaff, requirePermission('tradein.manage'), async (req, res) => {
  const parsed = payoutListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { restocked, sellRequestId, search, limit, offset } = parsed.data;

  const build = (head: boolean) => {
    let q = supabaseAdmin.from('trade_in_payouts').select('*', { count: 'exact', head });
    if (restocked !== undefined) q = q.eq('restocked', restocked);
    if (sellRequestId) q = q.eq('sell_request_id', sellRequestId);
    if (search) {
      // Same comma/wildcard stripping as the request queue: a comma inside
      // .or() reads as a filter separator and would change the query's meaning.
      const term = search.replace(/[%_,]/g, '');
      if (term) {
        q = q.or(
          `reference.ilike.%${term}%,device_label.ilike.%${term}%,customer_name.ilike.%${term}%`,
        );
      }
    }
    return q;
  };

  const { data, error, count } = await build(false)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    if (isRangeOverrun(error)) {
      const { count: total } = await build(true);
      return res.json(page([], total, limit, offset));
    }
    return res.status(500).json({ error: 'Could not load payouts.' });
  }

  const rows = data ?? [];
  const names = await staffNamesFor(rows.map((r) => r.staff_id as string));
  return res.json(
    page(
      rows.map((r) => toApiPayout(r as Record<string, unknown>, names)),
      count,
      limit,
      offset,
    ),
  );
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
