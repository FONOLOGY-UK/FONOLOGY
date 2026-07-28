import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { purgeExpiredDocuments } from '../lib/documentRetention.js';
import {
  orderInputBodySchema,
  orderStatusBodySchema,
  documentRejectBodySchema,
  deliveryQuoteBodySchema,
} from '../schemas.js';

export const ordersRouter = Router();

/**
 * UK delivery method -> DB delivery_method. 'remote' is not a real DB
 * method — it was the mock's own fixed-price self-report ("I know I'm in a
 * remote area"). The schema derives the real zone from the postcode on
 * every order regardless of what the customer picked, so 'remote' collapses
 * into 'standard' service tier here; the ACTUAL fee still comes out at the
 * remote rate if the postcode really is remote, and at the standard rate if
 * it isn't — never from what the client claims. See the B3 report.
 */
function mapDeliveryMethod(input: string): 'collect' | 'standard' | 'next_day' {
  if (input === 'collect') return 'collect';
  if (input === 'next-day') return 'next_day';
  return 'standard';
}

function mapDeliveryMethodOut(method: string): 'collect' | 'standard' | 'next-day' {
  if (method === 'next_day') return 'next-day';
  if (method === 'collect') return 'collect';
  return 'standard';
}

interface OrderLineRow {
  id: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  products: { slug: string; sub: string | null; kind: string } | null;
}

async function toApiOrder(orderRow: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: lineRows } = await supabaseAdmin
    .from('order_lines')
    .select('id, product_id, name, unit_price, quantity, products(slug, sub, kind)')
    .eq('order_id', orderRow.id as string);

  const lines = ((lineRows ?? []) as unknown as OrderLineRow[]).map((line) => ({
    productId: line.product_id ?? line.id,
    name: line.name,
    // sub/slug/kind aren't snapshotted on order_lines (only name + price are
    // — the historically-meaningful fields). Joined from the live product
    // when it still exists; honest fallbacks when it's been deleted since.
    sub: line.products?.sub ?? '',
    slug: line.products?.slug ?? '',
    kind: line.products?.kind ?? 'accessory',
    unitPrice: line.unit_price,
    quantity: line.quantity,
  }));

  let email = orderRow.guest_email as string | null;
  if (!email && orderRow.customer_id) {
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('email')
      .eq('id', orderRow.customer_id as string)
      .maybeSingle();
    email = customer?.email ?? null;
  }

  return {
    id: orderRow.id,
    reference: orderRow.reference,
    lines,
    name: orderRow.recipient_name ?? '',
    email: email ?? '',
    phone: orderRow.phone ?? '',
    delivery: mapDeliveryMethodOut(orderRow.delivery_method as string),
    address: orderRow.address_line1 ?? null,
    postcode: orderRow.postcode ?? null,
    subtotal: orderRow.subtotal,
    deliveryFee: orderRow.delivery_fee,
    discount: orderRow.discount,
    total: orderRow.total,
    status: orderRow.status,
    createdAt: orderRow.created_at,
  };
}

/**
 * Admin: all orders, for the online-orders board. Gated the same as the
 * status-move endpoint below (requireStaff only) — there's no dedicated
 * "orders.manage" in the 15-value permission enum, and every counter/repair
 * staff member already needs visibility of what's shipped/awaiting collection.
 */
ordersRouter.get('/', requireStaff, async (_req, res) => {
  const { data: rows, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load orders.' });
  return res.json(
    await Promise.all((rows ?? []).map((row) => toApiOrder(row as Record<string, unknown>))),
  );
});

/**
 * Read-only: what create_order would actually charge for delivery, for this
 * basket/method/postcode, before the order exists. Calls delivery_quote() —
 * the exact same function create_order() calls — so what the checkout screen
 * shows can never drift from what gets charged (see 0021_delivery_quote.sql).
 */
ordersRouter.post('/delivery-quote', async (req, res) => {
  const parsed = deliveryQuoteBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const { data: products, error: productsErr } = await supabaseAdmin
    .from('products')
    .select('id, is_active')
    .in('id', productIds);
  if (productsErr) return res.status(500).json({ error: 'Could not price the basket.' });
  const byId = new Set((products ?? []).map((p) => p.id as string));
  for (const line of body.lines) {
    if (!byId.has(line.productId)) {
      return res
        .status(400)
        .json({ error: `One of the items in your bag is no longer available.` });
    }
  }

  const pLines = body.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity }));
  const deliveryMethod = mapDeliveryMethod(body.delivery);

  const { data, error } = await supabaseAdmin
    .rpc('delivery_quote', {
      p_lines: pLines,
      p_delivery_method: deliveryMethod,
      p_postcode: body.postcode ?? null,
    })
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const row = data as { delivery_fee: number; zone_code: string | null };
  return res.json({ deliveryFee: row.delivery_fee, zone: row.zone_code });
});

ordersRouter.post('/', async (req, res) => {
  const parsed = orderInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const { data: products, error: productsErr } = await supabaseAdmin
    .from('products')
    .select('id, price, stock_qty, is_active, kind, free_delivery')
    .in('id', productIds);
  if (productsErr) return res.status(500).json({ error: 'Could not validate the basket.' });

  const byId = new Map((products ?? []).map((p) => [p.id as string, p]));

  for (const line of body.lines) {
    const product = byId.get(line.productId);
    if (!product || !product.is_active) {
      return res
        .status(400)
        .json({ error: `One of the items in your bag is no longer available.` });
    }
    if (product.kind === 'vape') {
      return res
        .status(400)
        .json({ error: 'Vapes are in-store only and cannot be ordered online.' });
    }
    if ((product.stock_qty as number) < line.quantity) {
      return res
        .status(409)
        .json({
          error: `Only ${product.stock_qty} left of one item in your bag — please adjust the quantity.`,
        });
    }
  }

  // Identity: from the authenticated session if one exists, never from the
  // request body. A customer can't place an order "as" someone else by
  // editing a client-side field, because there is no client-side field for
  // it — customer_id only ever comes from the verified session cookie.
  const customerId = req.user?.kind === 'customer' ? req.user.id : null;
  const guestEmail = customerId ? null : body.email;

  const pLines = body.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity }));
  const recipientName = `${body.firstName} ${body.lastName}`.trim();
  const deliveryMethod = mapDeliveryMethod(body.delivery);

  const { data: orderId, error: createErr } = await supabaseAdmin.rpc('create_order', {
    p_lines: pLines,
    p_delivery_method: deliveryMethod,
    p_customer_id: customerId,
    p_guest_email: guestEmail,
    p_recipient_name: recipientName,
    p_address_line1: body.address ?? null,
    p_address_line2: null,
    p_city: null,
    p_county: null,
    p_postcode: body.postcode ?? null,
    // Deliberately always 0 — see schemas.ts: there is no customer-facing
    // discount-code path in this schema. promoCode is accepted so the
    // request validates, and is never read again after that.
    p_discount: 0,
    p_phone: body.phone,
  });

  if (createErr) {
    return res.status(400).json({ error: createErr.message });
  }

  const hasPlateLine = body.lines.some((l) => byId.get(l.productId)?.kind === 'plate');
  if (hasPlateLine && body.verification) {
    await supabaseAdmin.from('order_documents').insert([
      {
        order_id: orderId,
        kind: 'v5c',
        storage_path: body.verification.registrationDoc,
        status: 'pending',
      },
      {
        order_id: orderId,
        kind: 'driving_licence',
        storage_path: body.verification.licence,
        status: 'pending',
      },
    ]);
  }

  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();
  return res.status(201).json(await toApiOrder(orderRow as Record<string, unknown>));
});

ordersRouter.get('/:reference', async (req, res) => {
  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (!orderRow) return res.json(null);

  const isOwningCustomer = req.user?.kind === 'customer' && req.user.id === orderRow.customer_id;
  if (!isOwningCustomer) {
    const emailParam =
      typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : null;
    let ownerEmail: string | null = orderRow.guest_email as string | null;
    if (!ownerEmail && orderRow.customer_id) {
      const { data: customer } = await supabaseAdmin
        .from('customers')
        .select('email')
        .eq('id', orderRow.customer_id as string)
        .maybeSingle();
      ownerEmail = customer?.email ?? null;
    }
    if (!emailParam || !ownerEmail || ownerEmail.trim().toLowerCase() !== emailParam) {
      // Same rule as B1's /guest/resolve: never distinguish "wrong email"
      // from "no such order" — both look identical from the outside.
      return res.json(null);
    }
  }

  return res.json(await toApiOrder(orderRow as Record<string, unknown>));
});

/**
 * Stand-in for the real payment webhook (Stripe/Clearpay — Tanoli's
 * integration, not built in this phase). The real webhook handler will call
 * exactly this: `UPDATE orders SET status = 'paid' WHERE id = ...`, which
 * the DB's own validate_order_status_transition trigger turns into the
 * paid_at timestamp + one stock_consume('online_order') per line —
 * idempotently, because the trigger's very first check is
 * `if new.status = old.status then return new;`, so firing this twice on an
 * already-paid order is a genuine no-op, not just an app-layer guard.
 *
 * Gated by requireStaff for now purely so this dev API isn't a wide-open
 * "mark anything paid" endpoint with no gate at all — NOT a stand-in for
 * real webhook security. When the real integration lands, this gate should
 * be replaced with payment-provider signature verification (Stripe's
 * webhook secret, etc.), not staff auth.
 */
ordersRouter.post('/:reference/paid', requireStaff, async (req, res) => {
  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('reference', reference)
    .maybeSingle();
  if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

  const { error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'paid' })
    .eq('id', orderRow.id);
  if (error) return res.status(409).json({ error: error.message });

  const { data: updated } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderRow.id)
    .single();
  return res.json(await toApiOrder(updated as Record<string, unknown>));
});

/**
 * Staff-driven status moves (ready/shipped/collected/cancelled) — the admin
 * orders panel. Keyed by `id`, not `reference`, to match
 * DataAdapter.updateOrderStatus(id, status) exactly — the frontend already
 * has an order's `id` from wherever it fetched the order, and this is the
 * one order-mutation the mock interface names by id rather than reference.
 */
ordersRouter.post('/id/:id/status', requireStaff, async (req, res) => {
  const parsed = orderStatusBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const id = req.params.id;
  const { error } = await supabaseAdmin
    .from('orders')
    .update({ status: parsed.data.status })
    .eq('id', id);
  if (error) return res.status(409).json({ error: error.message });

  const { data: updated } = await supabaseAdmin.from('orders').select('*').eq('id', id).single();
  return res.json(await toApiOrder(updated as Record<string, unknown>));
});

/**
 * Owner-only visibility (B6) — gated behind settings.manage, the closest
 * fit in the existing 15-value permission enum (there's no dedicated
 * "documents.manage"; retention/verification policy is settings-adjacent).
 * See the B6 report.
 */
ordersRouter.get(
  '/:reference/documents',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: documents } = await supabaseAdmin
      .from('order_documents')
      .select(
        'id, kind, status, storage_path, reviewed_by, reviewed_at, rejection_reason, uploaded_at',
      )
      .eq('order_id', orderRow.id);

    return res.json(documents ?? []);
  },
);

ordersRouter.post(
  '/:reference/documents/:kind/approve',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: updated, error } = await supabaseAdmin
      .from('order_documents')
      .update({
        status: 'approved',
        reviewed_by: req.user!.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('order_id', orderRow.id)
      .eq('kind', req.params.kind)
      .select('id, kind, status')
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Could not approve document.' });
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    return res.json(updated);
  },
);

ordersRouter.post(
  '/:reference/documents/:kind/reject',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const parsed = documentRejectBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: updated, error } = await supabaseAdmin
      .from('order_documents')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.reason,
        reviewed_by: req.user!.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('order_id', orderRow.id)
      .eq('kind', req.params.kind)
      .select('id, kind, status')
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Could not reject document.' });
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    return res.json(updated);
  },
);

/**
 * Issues a short-lived signed URL for a private document and calls
 * log_document_view() first — the database can't observe Storage access on
 * its own (see 0009_settings.sql's own comment), so this call IS the audit
 * log, not a side effect of one. Every view goes through here; there is no
 * other path in this API that reads a document's bytes.
 */
ordersRouter.get(
  '/:reference/documents/:kind/view',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: doc } = await supabaseAdmin
      .from('order_documents')
      .select('id, storage_path')
      .eq('order_id', orderRow.id)
      .eq('kind', req.params.kind)
      .maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    await supabaseAdmin.rpc('log_document_view', {
      p_document_id: doc.id,
      p_document_type: 'order_document',
      p_staff_id: req.user!.id,
    });

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('id-documents')
      .createSignedUrl(doc.storage_path, 60); // short-lived: 60 seconds
    if (signErr) {
      // The dev-proof documents from B3 are placeholder filenames with no
      // real object behind them, so signing can fail here — the audit log
      // above already recorded the view attempt regardless, which is the
      // part that actually matters for this proof. See the B6 report.
      return res.status(200).json({ signedUrl: null, note: signErr.message, viewLogged: true });
    }
    return res.json({ signedUrl: signed.signedUrl, viewLogged: true });
  },
);

/**
 * Global — every private document past its retention window, across all
 * orders, so a scheduled job (or an owner, on demand) can see what's due
 * before purge_expired_order_documents() removes the rows for real.
 */
ordersRouter.get(
  '/documents/due-for-deletion',
  requireStaff,
  requirePermission('settings.manage'),
  async (_req, res) => {
    // Same function the purge job itself uses to pick candidates — one
    // definition of "due", never two definitions that can drift apart. See
    // documents_due_for_deletion() (0020_document_retention_job.sql).
    const { data, error } = await supabaseAdmin.rpc('documents_due_for_deletion');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(
      (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        orderId: row.order_id,
        reference: row.reference,
        kind: row.kind,
        uploadedAt: row.uploaded_at,
        orderStatus: row.order_status,
      })),
    );
  },
);

/**
 * Manual/admin-triggerable purge — the same function the scheduled job
 * (scripts/purge-documents.ts) calls. No separate "manual" logic to drift
 * from what actually runs on a schedule.
 */
ordersRouter.post(
  '/documents/purge',
  requireStaff,
  requirePermission('settings.manage'),
  async (_req, res) => {
    try {
      const result = await purgeExpiredDocuments();
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Purge failed.' });
    }
  },
);
