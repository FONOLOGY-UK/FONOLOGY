import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requireUnlocked, requirePermission } from '../middleware/auth.js';
import {
  saleInputBodySchema,
  refundInputBodySchema,
  cashEntryInputBodySchema,
  dayCloseBodySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const posRouter = createRouter();

/* ---------------------------------------------------------------------- */
/* Helpers                                                                  */
/* ---------------------------------------------------------------------- */

function mapCashKindIn(input: 'float-open' | 'petty-in' | 'petty-out'): string {
  return { 'float-open': 'float_open', 'petty-in': 'petty_in', 'petty-out': 'petty_out' }[input];
}
function mapCashKindOut(db: string): string {
  return { float_open: 'float-open', petty_in: 'petty-in', petty_out: 'petty-out' }[db] ?? db;
}

interface SaleLineRow {
  id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  list_price: number;
  cost_price: number;
  tier_applied: boolean;
  products: { sub: string | null } | null;
}

async function toApiSale(saleRow: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [{ data: lineRows }, { data: paymentRows }] = await Promise.all([
    supabaseAdmin
      .from('sale_lines')
      .select(
        'id, product_id, name, quantity, unit_price, list_price, cost_price, tier_applied, products(sub)',
      )
      .eq('sale_id', saleRow.id as string),
    supabaseAdmin
      .from('sale_payments')
      .select('tender, amount')
      .eq('sale_id', saleRow.id as string),
  ]);

  const lines = ((lineRows ?? []) as unknown as SaleLineRow[]).map((l) => ({
    productId: l.product_id ?? l.id,
    name: l.name,
    sub: l.products?.sub ?? '',
    quantity: l.quantity,
    unitPrice: l.unit_price,
    listPrice: l.list_price,
    costPrice: l.cost_price,
    tierApplied: l.tier_applied,
  }));

  return {
    id: saleRow.id,
    reference: saleRow.reference,
    lines,
    subtotal: saleRow.subtotal,
    discount: saleRow.discount,
    total: saleRow.total,
    cost: saleRow.cost,
    belowCost: saleRow.below_cost,
    belowCostReason: saleRow.below_cost_reason,
    payments: (paymentRows ?? []).map((p) => ({ tender: p.tender, amount: p.amount })),
    at: saleRow.created_at,
  };
}

/**
 * Shapes one refunds row for the API.
 *
 * `names` lets the list endpoint resolve every staff name in a single query
 * and pass the map in; without it (the single-refund POST path) the one name
 * needed is looked up here. The screen must never have to join staff itself —
 * it only ever receives an id, and demanding a name it was never sent is
 * exactly what left /admin/cash stuck on a skeleton.
 */
async function toApiRefund(
  refundRow: Record<string, unknown>,
  names?: Map<string, string>,
): Promise<Record<string, unknown>> {
  const { data: lineRows } = await supabaseAdmin
    .from('refund_lines')
    .select('product_id, name, quantity, unit_price, restocked')
    .eq('refund_id', refundRow.id as string);

  const staffId = (refundRow.staff_id as string | null) ?? null;
  const resolved = names ?? (await staffNamesFor([staffId]));

  let source: 'order' | 'counter' | 'no-receipt' = 'no-receipt';
  let reference: string | null = null;
  if (refundRow.sale_id) {
    source = 'counter';
    const { data: sale } = await supabaseAdmin
      .from('sales')
      .select('reference')
      .eq('id', refundRow.sale_id as string)
      .maybeSingle();
    reference = sale?.reference ?? null;
  } else if (refundRow.order_id) {
    source = 'order';
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('reference')
      .eq('id', refundRow.order_id as string)
      .maybeSingle();
    reference = order?.reference ?? null;
  }

  return {
    id: refundRow.id,
    source,
    reference,
    lines: (lineRows ?? []).map((l) => ({
      productId: l.product_id,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unit_price,
    })),
    amount: refundRow.amount,
    reason: refundRow.reason,
    tender: refundRow.refund_tender,
    // Additive over the mock's RefundInput/Refund shape — see the B4 report.
    // originalTender is server-derived (from the sale's own sale_payments),
    // never client-supplied.
    originalTender: refundRow.original_tender ?? null,
    restock: (lineRows ?? []).some((l) => l.restocked),
    staffId,
    staffName: staffId ? (resolved.get(staffId) ?? null) : null,
    outsideWindow: refundRow.outside_window,
    windowOverrideBy: refundRow.window_override_by,
    at: refundRow.created_at,
    withinWindow: !refundRow.outside_window,
  };
}

/** Reference -> entity id via reference_registry, scoped to one entity_type. */
async function resolveReference(
  reference: string,
  entityType: 'sale' | 'order',
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('reference_registry')
    .select('entity_id, entity_type')
    .eq('reference', reference.trim().toUpperCase())
    .maybeSingle();
  if (!data || data.entity_type !== entityType) return null;
  return data.entity_id as string;
}

/* ---------------------------------------------------------------------- */
/* Complete a sale                                                          */
/* ---------------------------------------------------------------------- */

posRouter.post(
  '/sales',
  requireStaff,
  requireUnlocked,
  requirePermission('pos.operate'),
  async (req, res) => {
    const parsed = saleInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const productIds = [...new Set(body.lines.map((l) => l.productId))];
    const { data: products, error: productsErr } = await supabaseAdmin
      .from('products')
      .select('id, price, is_active, kind')
      .in('id', productIds);
    if (productsErr) return res.status(500).json({ error: 'Could not validate the basket.' });
    const byId = new Map((products ?? []).map((p) => [p.id as string, p]));

    const pLines: Array<{
      product_id: string;
      quantity: number;
      unit_price: number;
      list_price: number;
      tier_applied: boolean;
    }> = [];

    for (const line of body.lines) {
      const product = byId.get(line.productId);
      if (!product || !product.is_active) {
        return res
          .status(400)
          .json({ error: 'One of the items on this ticket is no longer available.' });
      }
      // Vapes ARE sellable at the till (unlike online) — no kind check here at
      // all, deliberately, unlike orders.routes.ts's vape rejection.

      // The real per-unit price, resolved server-side — the schema's own bulk-
      // tier logic, never the client's claimed unitPrice/tierApplied.
      const { data: realUnitPrice, error: priceErr } = await supabaseAdmin.rpc(
        'resolve_sale_unit_price',
        {
          p_product_id: line.productId,
          p_quantity: line.quantity,
        },
      );
      if (priceErr) return res.status(500).json({ error: 'Could not price one of the items.' });

      pLines.push({
        product_id: line.productId,
        quantity: line.quantity,
        unit_price: realUnitPrice as number,
        list_price: product.price as number,
        tier_applied: (realUnitPrice as number) < (product.price as number),
      });
    }

    // `reference` is the card machine's slip reference, passed straight
    // through to complete_sale (0030), which records it alongside who
    // confirmed the leg. Optional at every layer; undefined simply means the
    // operator didn't type one. confirmed_by is NOT sent from here — the
    // function takes it from p_staff_id, i.e. the session.
    const pPayments = body.payments.map((p) => ({
      tender: p.tender,
      amount: p.amount,
      reference: p.reference ?? null,
    }));

    const { data: saleId, error: saleErr } = await supabaseAdmin.rpc('complete_sale', {
      p_staff_id: req.user!.id,
      p_lines: pLines,
      p_payments: pPayments,
      p_discount: body.discount,
      p_below_cost_reason: body.belowCostReason ?? null,
    });

    if (saleErr) {
      // Surfaces the schema's own errors cleanly: payments not summing to the
      // total (deferred constraint), a discount over the subtotal (CHECK), or
      // insufficient stock (stock_consume's CHECK) — never re-derived here.
      return res.status(409).json({ error: saleErr.message });
    }

    const { data: saleRow } = await supabaseAdmin
      .from('sales')
      .select('*')
      .eq('id', saleId)
      .single();
    return res.status(201).json(await toApiSale(saleRow as Record<string, unknown>));
  },
);

/* ---------------------------------------------------------------------- */
/* Today's takings — employee view, hard-scoped to today                    */
/* ---------------------------------------------------------------------- */

/**
 * The shop's current trading day, per `shop_day()` — Europe/London, so it
 * survives BST and does not roll at UTC midnight.
 *
 * A screen must never work this out from the browser's clock: a machine set
 * to another timezone (or simply past midnight local while the shop day is
 * still yesterday) would disagree with the server about which day it is, and
 * "has today been closed?" would answer wrongly.
 *
 * Gated on `requireStaff` alone, deliberately. It carries no business data —
 * just a date — and tying it to any one permission would mean a member of
 * staff who can close the till can't ask which day they're closing.
 */
posRouter.get('/shop-day', requireStaff, async (_req, res) => {
  const { data, error } = await supabaseAdmin.rpc('shop_day', { ts: new Date().toISOString() });
  if (error) return res.status(500).json({ error: 'Could not read the trading day.' });
  return res.json({ date: data });
});

posRouter.get('/today', requireStaff, requirePermission('sales.today'), async (_req, res) => {
  // No query parameters are read at all — there is nothing a caller can
  // pass to widen this beyond today. pos_today_summary() takes zero
  // arguments and always means shop_day(now()) — see 0016_pos_today.sql.
  const { data, error } = await supabaseAdmin.rpc('pos_today_summary').single();
  if (error) return res.status(500).json({ error: 'Could not load today’s summary.' });
  const summary = data as { total: number; sales_count: number };
  const { data: today } = await supabaseAdmin.rpc('shop_day', { ts: new Date().toISOString() });
  return res.json({ date: today, total: summary.total, sales: summary.sales_count });
});

posRouter.get(
  '/today/report',
  requireStaff,
  requirePermission('sales.today'),
  async (_req, res) => {
    const { data, error } = await supabaseAdmin.rpc('pos_today_report');
    if (error) return res.status(500).json({ error: 'Could not load today’s report.' });
    return res.json(data);
  },
);

/* ---------------------------------------------------------------------- */
/* Refunds                                                                   */
/* ---------------------------------------------------------------------- */

posRouter.post('/refunds', requireStaff, requirePermission('returns.manage'), async (req, res) => {
  const parsed = refundInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  if (body.source === 'no-receipt') {
    return res.status(400).json({
      error:
        'A refund must reference a sale or an order — there is no link-less "goodwill, no receipt" refund in this system. Use the counter sale or online order reference.',
    });
  }
  if (!body.reference) {
    return res.status(400).json({ error: 'A reference is required.' });
  }

  const entityType = body.source === 'counter' ? 'sale' : 'order';
  const entityId = await resolveReference(body.reference, entityType);
  if (!entityId) {
    return res.status(404).json({ error: `No ${entityType} found for ${body.reference}.` });
  }

  // Compute whether this is genuinely outside the return window — from the
  // real original date and the real setting, never from the client's say-so.
  const { data: settings } = await supabaseAdmin
    .from('shop_settings')
    .select('return_window_days')
    .single();
  const windowDays = (settings?.return_window_days as number) ?? 30;

  let originalCreatedAt: string | null = null;
  let originalTender: string | null = null;
  if (entityType === 'sale') {
    const { data: sale } = await supabaseAdmin
      .from('sales')
      .select('created_at')
      .eq('id', entityId)
      .single();
    originalCreatedAt = sale?.created_at ?? null;
    const { data: payments } = await supabaseAdmin
      .from('sale_payments')
      .select('tender, created_at')
      .eq('sale_id', entityId)
      .order('created_at', { ascending: true })
      .limit(1);
    originalTender = payments?.[0]?.tender ?? null;
  } else {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('created_at')
      .eq('id', entityId)
      .single();
    originalCreatedAt = order?.created_at ?? null;
    // Online orders don't have a tender_method-compatible payment record
    // (Stripe/Clearpay aren't till tenders) — left null rather than guessed.
  }

  const ageDays = originalCreatedAt
    ? (Date.now() - new Date(originalCreatedAt).getTime()) / 86400000
    : Infinity;
  const isOutsideWindow = ageDays > windowDays;

  if (isOutsideWindow && !body.override) {
    return res.status(409).json({
      error: `This sale is outside the ${windowDays}-day return window. Confirm the override to refund it anyway — the authorisation is kept on record.`,
    });
  }

  const pLines = body.lines.map((l) => ({
    product_id: l.productId,
    name: l.name,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    restock: body.restock,
  }));

  const { data: refundId, error: refundErr } = await supabaseAdmin.rpc('create_refund', {
    p_staff_id: req.user!.id,
    p_amount: body.amount,
    p_refund_tender: body.tender === 'stripe' ? 'transfer' : body.tender, // stripe isn't a till tender_method; nearest real refund-out method
    p_reason: body.reason,
    p_lines: pLines,
    p_sale_id: entityType === 'sale' ? entityId : null,
    p_order_id: entityType === 'order' ? entityId : null,
    p_job_id: null,
    p_original_tender: originalTender,
    p_outside_window: isOutsideWindow,
    p_window_override_by: isOutsideWindow ? req.user!.id : null,
  });

  if (refundErr) {
    // Surfaces the schema's own cap ("would exceed what was paid") cleanly.
    return res.status(409).json({ error: refundErr.message });
  }

  const { data: refundRow } = await supabaseAdmin
    .from('refunds')
    .select('*')
    .eq('id', refundId)
    .single();
  return res.status(201).json(await toApiRefund(refundRow as Record<string, unknown>));
});

posRouter.get('/refunds', requireStaff, requirePermission('returns.manage'), async (_req, res) => {
  const { data: rows } = await supabaseAdmin
    .from('refunds')
    .select('*')
    .order('created_at', { ascending: false });
  // One staff query for the whole page, not one per row.
  const names = await staffNamesFor((rows ?? []).map((r) => r.staff_id as string | null));
  const refunds = await Promise.all(
    (rows ?? []).map((r) => toApiRefund(r as Record<string, unknown>, names)),
  );
  return res.json(refunds);
});

/* ---------------------------------------------------------------------- */
/* Cash drawer                                                              */
/* ---------------------------------------------------------------------- */

posRouter.post('/cash', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const parsed = cashEntryInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await supabaseAdmin
    .from('cash_entries')
    // trading_day is deliberately omitted — the column default (shop_day(now()))
    // is what the schema itself specifies for "today", exactly matching
    // "use shop_day() for the trading day".
    .insert({
      kind: mapCashKindIn(body.kind),
      amount: body.amount,
      note: body.note,
      staff_id: req.user!.id,
    })
    .select('*')
    .single();

  if (error) {
    // The schema's own unique index catches a second float-open for the
    // same trading day — surfaced cleanly, not re-derived here.
    if (error.code === '23505') {
      return res
        .status(409)
        .json({ error: 'An opening float has already been recorded for today.' });
    }
    return res.status(500).json({ error: 'Could not record the cash entry.' });
  }

  return res.status(201).json({
    id: row.id,
    date: row.trading_day,
    kind: mapCashKindOut(row.kind),
    amount: row.amount,
    note: row.note,
    staffId: row.staff_id,
    staffName: req.user!.name ?? null,
    at: row.created_at,
  });
});

/**
 * Names for a set of staff ids, in one query. The cash log shows who recorded
 * each entry; resolving that here rather than client-side keeps the screen
 * off `/admin/staff` (a different permission, and a heavier payload) just to
 * turn an id into a name.
 */
async function staffNamesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('staff').select('id, name').in('id', unique);
  return new Map((data ?? []).map((s) => [s.id as string, s.name as string]));
}

posRouter.get('/cash', requireStaff, requirePermission('cash.manage'), async (_req, res) => {
  const { data: rows } = await supabaseAdmin
    .from('cash_entries')
    .select('*')
    .order('created_at', { ascending: false });
  const names = await staffNamesFor((rows ?? []).map((r) => r.staff_id as string | null));
  return res.json(
    (rows ?? []).map((row) => ({
      id: row.id,
      date: row.trading_day,
      kind: mapCashKindOut(row.kind),
      amount: row.amount,
      note: row.note,
      staffId: row.staff_id,
      staffName: names.get(row.staff_id as string) ?? null,
      at: row.created_at,
    })),
  );
});

/* ---------------------------------------------------------------------- */
/* End-of-day close                                                          */
/* ---------------------------------------------------------------------- */
/**
 * No adapter/UI wiring — same as B1's PIN lock, there is no DataAdapter
 * method or component for day-close anywhere in the frontend yet. Built and
 * proven directly against dev via real requests, ready for a future admin
 * pass to wire a hook + component to it.
 */

posRouter.post('/day-close', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const parsed = dayCloseBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: today } = await supabaseAdmin.rpc('shop_day', { ts: new Date().toISOString() });

  const expected = await computeExpectedCash(today as string);

  const { data: row, error } = await supabaseAdmin
    .from('day_close')
    .insert({
      trading_day: today,
      expected_amount: expected.total,
      counted_amount: body.countedAmount,
      note: body.note ?? null,
      staff_id: req.user!.id,
      // Snapshot of how expected.total was reached, stored alongside it
      // (0024, extended to seven terms by 0031). The DB checks these sum
      // back to expected_amount.
      float_open: expected.breakdown.floatOpen,
      petty_in: expected.breakdown.pettyIn,
      petty_out: expected.breakdown.pettyOut,
      cash_sales: expected.breakdown.cashSales,
      cash_repairs: expected.breakdown.cashRepairs,
      cash_refunds: expected.breakdown.cashRefunds,
      cash_payouts: expected.breakdown.cashPayouts,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This trading day has already been closed.' });
    }
    return res.status(500).json({ error: 'Could not record the day close.' });
  }

  return res.status(201).json({
    id: row.id,
    date: row.trading_day,
    expectedAmount: row.expected_amount,
    countedAmount: row.counted_amount,
    variance: row.variance,
    note: row.note,
    staffId: row.staff_id,
    at: row.created_at,
    breakdown: expected.breakdown,
  });
});

/**
 * expected = floatOpen + pettyIn − pettyOut + cashSales − cashRefunds − cashTradeInPayouts
 * Every term is scoped to the given trading day via shop_day(), computed
 * fresh from the ledger — never stored/cached, never trusted from a caller.
 */
async function computeExpectedCash(tradingDay: string) {
  const dayStart = `${tradingDay}T00:00:00`;
  const dayEnd = `${tradingDay}T23:59:59.999`;

  const { data: cashEntries } = await supabaseAdmin
    .from('cash_entries')
    .select('kind, amount')
    .eq('trading_day', tradingDay);

  let floatOpen = 0;
  let pettyIn = 0;
  let pettyOut = 0;
  for (const row of cashEntries ?? []) {
    if (row.kind === 'float_open') floatOpen += row.amount as number;
    else if (row.kind === 'petty_in') pettyIn += row.amount as number;
    else if (row.kind === 'petty_out') pettyOut += row.amount as number;
  }

  // Cash sale payments for sales created on this trading day (shop_day of
  // the sale's created_at, via a join filtered in SQL by the same day
  // window — sales.created_at is timestamptz, trading_day is a plain date
  // matching shop_day()'s own Europe/London conversion).
  const { data: cashSaleRows } = await supabaseAdmin
    .from('sale_payments')
    .select('amount, sales!inner(created_at)')
    .eq('tender', 'cash')
    .gte('sales.created_at', dayStart)
    .lte('sales.created_at', dayEnd);
  const cashSales = (cashSaleRows ?? []).reduce((s, r) => s + (r.amount as number), 0);

  const { data: cashRefundRows } = await supabaseAdmin
    .from('refunds')
    .select('amount, created_at')
    .eq('refund_tender', 'cash')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);
  const cashRefunds = (cashRefundRows ?? []).reduce((s, r) => s + (r.amount as number), 0);

  const { data: cashPayoutRows } = await supabaseAdmin
    .from('trade_in_payouts')
    .select('amount, created_at')
    .eq('method', 'cash')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);
  // trade_in_payouts.amount is already stored negative (money out) — summing
  // it directly and ADDING is the same as subtracting its absolute value.
  const cashPayoutsSigned = (cashPayoutRows ?? []).reduce((s, r) => s + (r.amount as number), 0);

  // Cash taken on repairs (deposits and balances). record_job_payment writes
  // ONLY to job_payments — no sale, no sale_payments row — so this money is
  // in the drawer but was invisible to this calculation until 0031, giving a
  // phantom overage on every day a repair was paid in cash.
  //
  // Cannot double-count with cashSales: the jobs routes never call
  // complete_sale, so a job payment can never also be a sale payment.
  //
  // No matching subtraction for repair refunds: the refunds query above
  // filters only on refund_tender, not on what the refund is linked to, so a
  // cash refund of a repair deposit is already inside cashRefunds. Adding a
  // term here would subtract it twice.
  const { data: cashRepairRows } = await supabaseAdmin
    .from('job_payments')
    .select('amount, at')
    .eq('tender', 'cash')
    .gte('at', dayStart)
    .lte('at', dayEnd);
  const cashRepairs = (cashRepairRows ?? []).reduce((s, r) => s + (r.amount as number), 0);

  const total =
    floatOpen + pettyIn - pettyOut + cashSales + cashRepairs - cashRefunds + cashPayoutsSigned;

  return {
    total,
    breakdown: {
      floatOpen,
      pettyIn,
      pettyOut,
      cashSales,
      cashRepairs,
      cashRefunds,
      cashPayouts: -cashPayoutsSigned, // reported as a positive "amount paid out" for readability
    },
  };
}

/**
 * The stored breakdown, or null for a row closed before 0024 existed. Never
 * recomputed from today's ledger — see 0024's own note: a reconstructed
 * breakdown can disagree with the `expected_amount` beside it.
 */
function toApiBreakdown(row: Record<string, unknown>) {
  if (row.float_open === null || row.float_open === undefined) return null;
  return {
    floatOpen: row.float_open,
    pettyIn: row.petty_in,
    pettyOut: row.petty_out,
    cashSales: row.cash_sales,
    // Null on rows closed between 0024 and 0031 — they were reconciled
    // before repair cash was counted, and 0031 deliberately does not restate
    // their expected figure. Coalesced to 0 so the shape stays uniform.
    cashRepairs: row.cash_repairs ?? 0,
    cashRefunds: row.cash_refunds,
    cashPayouts: row.cash_payouts,
  };
}

posRouter.get('/day-close', requireStaff, requirePermission('cash.manage'), async (_req, res) => {
  const { data: rows } = await supabaseAdmin
    .from('day_close')
    .select('*')
    .order('trading_day', { ascending: false });
  return res.json(
    (rows ?? []).map((row) => ({
      id: row.id,
      date: row.trading_day,
      expectedAmount: row.expected_amount,
      countedAmount: row.counted_amount,
      variance: row.variance,
      note: row.note,
      staffId: row.staff_id,
      at: row.created_at,
      breakdown: toApiBreakdown(row as Record<string, unknown>),
    })),
  );
});
