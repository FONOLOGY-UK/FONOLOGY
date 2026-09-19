import { supabaseAdmin } from './supabase.js';
import type { PrintTestVariant } from '../schemas.js';

/**
 * Building the frozen payload for a print job.
 * =========================================================================
 * Two rules, both load-bearing.
 *
 * 1. THE SERVER BUILDS IT. The till asks to print "the receipt for sale X".
 *    It never hands over content. A client that could post a finished payload
 *    could print any total it liked onto shop letterhead, which is the same
 *    class of hole as trusting a client-supplied amount.
 *
 * 2. IT FREEZES DATA, NOT PIXELS. This is a deliberate refinement of "frozen
 *    render snapshot" and worth being explicit about, because the obvious
 *    reading — freeze the finished bytes — is actively wrong here:
 *
 *      - Paper width, cut behaviour and especially CODEPAGE are still
 *        UNVERIFIED and live in shop_settings precisely so they can be
 *        corrected after the first test print. Bytes frozen against a wrong
 *        codepage would be permanently wrong, in every queued job, and
 *        unfixable without re-enqueuing.
 *      - A queued payload would be tens of kilobytes of opaque binary that
 *        nobody can inspect when something goes wrong at 5pm on a Saturday.
 *
 *    So the money, the names and the reference are frozen at enqueue — those
 *    are what a refund dispute turns on, and what must show what the customer
 *    was actually handed. Layout is applied at print time from current
 *    settings. A reprint shows the original figures in today's layout, which
 *    is the correct trade.
 *
 * Money stays integer pence all the way through. Pounds appear only when the
 * agent renders, never in here.
 *
 * NOTE ON SCOPE: the exact receipt LAYOUT (what sits where, the warranty
 * wording, the footer) belongs to the agent's renderers. What is decided here
 * is which facts get frozen.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY *NOT* FROZEN, AND WHY
 * ---------------------------------------------------------------------------
 * These are content decisions, made once, here, rather than re-argued in each
 * renderer:
 *
 *   - A REFUND'S `reason` IS NOT PRINTED. It is free text a staff member typed
 *     for the shop's own record ("goodwill", "customer says faulty at 6 weeks").
 *     It is not written for the customer, and a receipt is the one document
 *     they keep and can quote back. The reason stays in `refunds.reason` and
 *     the audit log, where it belongs.
 *
 *   - `outside_window` / `window_override_by` ARE NOT PRINTED. Whether the
 *     owner waived the returns window is an internal control, not something to
 *     hand the customer in writing.
 *
 *   - STOCK, COST AND MARGIN NEVER APPEAR ON A SHELF LABEL. Client rule, and
 *     the shelf label is by definition the most public surface in the shop.
 *     `buildShelfLabel` selects the columns it needs by name and `cost_price`
 *     and `stock_qty` are not among them — the protection is that they are
 *     never loaded, not that a renderer remembers to skip them.
 */

export class PrintPayloadError extends Error {}

export interface SaleReceiptPayload {
  version: 1;
  kind: 'sale_receipt';
  reference: string;
  soldAt: string;
  staffName: string | null;
  lines: {
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    tierApplied: boolean;
  }[];
  subtotal: number;
  discount: number;
  total: number;
  payments: {
    tender: string;
    amount: number;
    /** Frozen by 0032 — the machine's name at the time, not today's. */
    machineLabel: string | null;
    /** The slip reference staff typed in, when they did. */
    reference: string | null;
  }[];
}

export interface JobLabelPayload {
  version: 1;
  kind: 'job_label';
  reference: string;
  createdAt: string;
  customerName: string;
  /**
   * Nullable, because `jobs.phone` is (0006_repairs.sql). Found while adding
   * the two item 1 fields: this was typed as a plain string, the column has
   * always allowed null, and Supabase's untyped rows meant nothing complained.
   * The agent's own schema then required a string, so a job booked without a
   * phone number produced a label payload the agent could not parse — the
   * bench ticket simply never came out. Nullable here, handled in the renderer.
   */
  phone: string | null;
  deviceDescription: string;
  problemDescription: string;
  quotedPrice: number | null;
  paymentStatus: string;
  /**
   * Change request item 1. Both were already on the row and simply weren't
   * selected — the label has been printing without them since it existed.
   *
   * `source` is the one the bench actually needs: a mail-in device must never
   * be handed to whoever walks up to the counter, and the ticket on the device
   * was the only thing in the room that didn't say so.
   *
   * `notes` is the free-text job note — "back glass too, customer knows",
   * "battery swollen, do not charge". Nullable: most jobs have none.
   */
  source: 'walk_in' | 'mail_in' | 'online';
  notes: string | null;
}

/**
 * A refund. Money going back to a customer.
 *
 * TWO REFERENCES, not one, and they answer different questions:
 *   `reference`         — this refund's own REF- number (migration 0035)
 *   `originalReference` — the sale or order it was taken against
 *
 * Before 0035 only the second existed, so two partial refunds against one sale
 * printed identically and neither the shop nor the customer could say which
 * one they meant.
 *
 * TWO TENDERS, also not one. The client confirmed a refund can go back by a
 * different method than the sale came in on (a card sale refunded as cash).
 * The customer needs to know where their money actually went, and the drawer
 * only balances at close if both sides are on record.
 */
export interface RefundReceiptPayload {
  version: 1;
  kind: 'refund_receipt';
  reference: string;
  originalReference: string | null;
  /** 'sale' | 'order' — what `originalReference` points at, so the paper can say. */
  originalKind: 'sale' | 'order' | null;
  refundedAt: string;
  staffName: string | null;
  lines: {
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  /** Positive pence. `refunds.amount` has a `> 0` check — this is money returned. */
  amount: number;
  /** How the money actually went back out. */
  refundTender: string;
  /** How the sale was originally paid, where known. Null for online orders. */
  originalTender: string | null;
}

/**
 * A trade-in payout. The shop BUYING a device from a customer.
 *
 * This is not a sale receipt with a minus sign. Nothing was sold, no returns
 * window applies, no repair warranty applies, and the money moved the other
 * way. The document exists so the customer has written proof of what they
 * handed over and what they were paid for it.
 */
export interface PayoutReceiptPayload {
  version: 1;
  kind: 'payout_receipt';
  /** BUY- series. Trade-in payouts have always had their own prefix (0007). */
  reference: string;
  paidAt: string;
  staffName: string | null;
  customerName: string;
  deviceLabel: string;
  /**
   * NEGATIVE, exactly as stored. Money out.
   *
   * Deliberately not flipped to a friendly positive here — `toApiPayout` in
   * sell.routes.ts made the same call for the same reason. The renderer takes
   * the absolute value and labels the direction in words, so the sign
   * convention is stated in exactly one place instead of being quietly lost
   * somewhere between the ledger and the paper.
   */
  amount: number;
  method: string;
  /** The online sell request this settles, when there was one. */
  sellRequestReference: string | null;
}

/**
 * A shelf label. The most public surface in the shop.
 *
 * `price` is the EFFECTIVE single-unit price from `resolve_sale_unit_price` —
 * the same function the till charges by — not `products.price`. A shelf label
 * showing £10 while the till rings £8 because a promotion is running is a
 * wrong-price complaint at the counter, and the shelf is where the customer
 * makes their decision.
 *
 * `bulkTiers` exists for the same reason: if the till WILL apply "3 for £24",
 * a label that only says "£10" understates the offer the shop is running.
 */
export interface ShelfLabelPayload {
  version: 1;
  kind: 'shelf_label';
  name: string;
  sub: string | null;
  /** Effective single-unit price, integer pence. */
  price: number;
  /** Manufacturer EAN/UPC. Null when the product has none — no barcode is drawn. */
  barcode: string | null;
  bulkTiers: { minQty: number; unitPrice: number }[];
  issuedAt: string;
}

export interface TestPrintPayload {
  version: 1;
  kind: 'test_print';
  target: 'receipt' | 'label';
  variant: PrintTestVariant;
  issuedAt: string;
  /**
   * Set for the `barcode` and `label` variants only.
   *
   * The point of that test is not that bars appear — it is that the shop's own
   * Eyoyo EY-7130 reads them back as a REAL product. So the payload carries a
   * real product's name and barcode, and "pass" means the scanner finds that
   * product on the till. Machine-checked, not eyeballed.
   */
  product: { name: string; barcode: string } | null;
}

/**
 * The end-of-day summary staff print off the till (change request item 7).
 *
 * NOT a day close. `day_closes` is a locking, blind-count cash
 * reconciliation that ends the trading day; this ends nothing. The doc is
 * explicit that "End Day" must not lock the till, that staff keep selling
 * afterwards, and that printing again later gives an updated version — so
 * this is a snapshot of pos_today_report() at the moment the button was
 * pressed, and pressing it twice legitimately produces two different
 * documents. Frozen the same way every other payload is: the figures are
 * fixed at enqueue so the paper shows what was on screen, even if a sale
 * lands while the job is still in the queue.
 */
export interface DayReportPayload {
  version: 1;
  kind: 'day_report';
  /** The shop's trading day, from shop_day() — never the device's clock. */
  date: string;
  /** When the button was pressed. Two prints of one day differ by this. */
  issuedAt: string;
  staffName: string | null;
  total: number;
  salesCount: number;
  averageSale: number;
  /** Units, not lines — three of the same case is three items sold. */
  itemsSold: number;
  /**
   * Approximate. Nothing timestamps a job status change in this schema, so
   * this counts jobs in a finished state last touched today. The renderer
   * says so on the paper rather than presenting it as exact.
   */
  jobsCompleted: number;
  /** Repair money taken at the counter today, called out on its own. */
  repairTakings: number;
  /** Every payment method — sale payments AND job payments. See 0084. */
  byTender: { tender: string; count: number; total: number }[];
}

export type PrintPayload =
  | SaleReceiptPayload
  | RefundReceiptPayload
  | PayoutReceiptPayload
  | JobLabelPayload
  | ShelfLabelPayload
  | DayReportPayload
  | TestPrintPayload;

/** Which physical printer a kind belongs on. Not caller-supplied. */
export const TARGET_FOR_KIND = {
  sale_receipt: 'receipt',
  refund_receipt: 'receipt',
  payout_receipt: 'receipt',
  // Item 7 — a summary off the receipt printer, not the label roll.
  day_report: 'receipt',
  job_label: 'label',
  shelf_label: 'label',
  test_print: 'receipt',
} as const;

async function buildSaleReceipt(saleId: string): Promise<SaleReceiptPayload> {
  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('id, reference, subtotal, discount, total, created_at, staff:staff_id (name)')
    .eq('id', saleId)
    .maybeSingle();
  if (!sale) throw new PrintPayloadError('That sale no longer exists.');

  const { data: lines } = await supabaseAdmin
    .from('sale_lines')
    .select('name, quantity, unit_price, line_total, tier_applied')
    .eq('sale_id', saleId)
    .order('created_at');

  const { data: payments } = await supabaseAdmin
    .from('sale_payments')
    .select('tender, amount, machine_label, provider_reference')
    .eq('sale_id', saleId)
    .order('created_at');

  return {
    version: 1,
    kind: 'sale_receipt',
    reference: sale.reference,
    soldAt: sale.created_at,
    staffName: embeddedStaffName(sale),
    lines: (lines ?? []).map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      lineTotal: l.line_total,
      tierApplied: l.tier_applied ?? false,
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    payments: (payments ?? []).map((p) => ({
      tender: p.tender,
      amount: p.amount,
      machineLabel: p.machine_label ?? null,
      reference: p.provider_reference ?? null,
    })),
  };
}

async function buildJobLabel(jobId: string): Promise<JobLabelPayload> {
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select(
      'reference, created_at, customer_name, phone, device_description, problem_description, quoted_price, payment_status, source, notes',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (!job) throw new PrintPayloadError('That job no longer exists.');

  return {
    version: 1,
    kind: 'job_label',
    reference: job.reference,
    createdAt: job.created_at,
    customerName: job.customer_name,
    phone: job.phone ?? null,
    deviceDescription: job.device_description,
    problemDescription: job.problem_description,
    quotedPrice: job.quoted_price ?? null,
    paymentStatus: job.payment_status,
    // Item 1. Frozen here with everything else — a note edited after the label
    // was queued must not change what the printed ticket says it said.
    source: job.source,
    notes: job.notes ?? null,
  };
}

async function buildRefundReceipt(refundId: string): Promise<RefundReceiptPayload> {
  const { data: refund } = await supabaseAdmin
    .from('refunds')
    .select(
      'id, reference, amount, refund_tender, original_tender, sale_id, order_id, created_at, staff:staff_id (name)',
    )
    .eq('id', refundId)
    .maybeSingle();
  if (!refund) throw new PrintPayloadError('That refund no longer exists.');

  const { data: lines } = await supabaseAdmin
    .from('refund_lines')
    .select('name, quantity, unit_price')
    .eq('refund_id', refundId)
    .order('created_at');

  // The sale or order this came back against. One of the two, or neither.
  let originalReference: string | null = null;
  let originalKind: 'sale' | 'order' | null = null;
  if (refund.sale_id) {
    originalKind = 'sale';
    const { data } = await supabaseAdmin
      .from('sales')
      .select('reference')
      .eq('id', refund.sale_id)
      .maybeSingle();
    originalReference = data?.reference ?? null;
  } else if (refund.order_id) {
    originalKind = 'order';
    const { data } = await supabaseAdmin
      .from('orders')
      .select('reference')
      .eq('id', refund.order_id)
      .maybeSingle();
    originalReference = data?.reference ?? null;
  }

  return {
    version: 1,
    kind: 'refund_receipt',
    reference: refund.reference,
    originalReference,
    originalKind,
    refundedAt: refund.created_at,
    staffName: embeddedStaffName(refund),
    lines: (lines ?? []).map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      // Computed here rather than trusted from anywhere: the server computes
      // every money figure, and refund_lines stores only the unit price.
      lineTotal: l.unit_price * l.quantity,
    })),
    amount: refund.amount,
    refundTender: refund.refund_tender,
    originalTender: refund.original_tender ?? null,
  };
}

async function buildPayoutReceipt(payoutId: string): Promise<PayoutReceiptPayload> {
  const { data: payout } = await supabaseAdmin
    .from('trade_in_payouts')
    .select(
      'reference, created_at, customer_name, device_label, amount, method, sell_request_id, staff:staff_id (name)',
    )
    .eq('id', payoutId)
    .maybeSingle();
  if (!payout) throw new PrintPayloadError('That trade-in payout no longer exists.');

  // The customer's own online quote reference, when this settles one. Lets them
  // match the paper in their hand to the email they were sent.
  let sellRequestReference: string | null = null;
  if (payout.sell_request_id) {
    const { data } = await supabaseAdmin
      .from('sell_requests')
      .select('reference')
      .eq('id', payout.sell_request_id)
      .maybeSingle();
    sellRequestReference = data?.reference ?? null;
  }

  return {
    version: 1,
    kind: 'payout_receipt',
    reference: payout.reference,
    paidAt: payout.created_at,
    staffName: embeddedStaffName(payout),
    customerName: payout.customer_name,
    deviceLabel: payout.device_label,
    amount: payout.amount,
    method: payout.method,
    sellRequestReference,
  };
}

/**
 * A shelf label from a product — or, since Round 5 Phase 4 #16, from a
 * specific VARIANT of one. `entityId` is looked up against product_variants
 * first (same disambiguation-by-lookup pattern as the barcode-scan route in
 * admin.routes.ts) and falls back to products — no separate parameter was
 * worth adding to printEnqueueBodySchema for this, since a variant id and a
 * product id can never collide (both gen_random_uuid()).
 *
 * NOTE THE SELECT LISTS. `cost_price` and `stock_qty` are not in either one,
 * and that is the entire protection: they are never loaded, so no renderer
 * can leak them by forgetting to skip them. If you add a column here, ask
 * whether a customer standing in the shop may read it.
 */
async function buildShelfLabel(entityId: string): Promise<ShelfLabelPayload> {
  const { data: variant } = await supabaseAdmin
    .from('product_variants')
    .select('id, product_id, options, barcode, price_adjustment')
    .eq('id', entityId)
    .maybeSingle();

  const productId = variant ? (variant.product_id as string) : entityId;

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id, name, sub, barcode, price')
    .eq('id', productId)
    .maybeSingle();
  if (!product) throw new PrintPayloadError('That product no longer exists.');

  // The price the TILL will actually charge for one, promotions included —
  // not products.price. Same function complete_sale resolves against, so the
  // shelf and the till cannot disagree. resolve_sale_unit_price is untouched
  // by variants (promotions stay product-level, trimmed v1) — a variant's
  // price_adjustment is layered on top only when no tier is running, same
  // split documented in pos.routes.ts's /sales handler.
  const { data: unitPrice, error: priceError } = await supabaseAdmin.rpc(
    'resolve_sale_unit_price',
    { p_product_id: productId, p_quantity: 1 },
  );
  if (priceError) throw priceError;

  const tierApplied = (unitPrice as number) < (product.price as number);
  const effectivePrice =
    variant && !tierApplied
      ? (unitPrice as number) + (variant.price_adjustment as number)
      : (unitPrice as number);

  // Bulk tiers on a currently-running promotion. A label that says only "£10"
  // while the till rings "3 for £24" understates the shop's own offer.
  // Product-level regardless of variant (trimmed v1) — same rows either way.
  const { data: tiers } = await supabaseAdmin
    .from('promotions')
    .select('is_active, starts_at, ends_at, promo_tiers (min_qty, unit_price)')
    .eq('product_id', productId)
    .eq('is_active', true);

  const now = Date.now();
  const live = (tiers ?? []).filter(
    (p) =>
      (!p.starts_at || new Date(p.starts_at).getTime() <= now) &&
      (!p.ends_at || new Date(p.ends_at).getTime() > now),
  );
  const bulkTiers = live
    .flatMap((p) => (p.promo_tiers ?? []) as { min_qty: number; unit_price: number }[])
    // min_qty 1 is not a "bulk" tier — it is the single-unit price, which
    // resolve_sale_unit_price has already returned above. Printing it twice
    // would read as a second, different offer.
    .filter((t) => t.min_qty > 1)
    .sort((a, b) => a.min_qty - b.min_qty)
    // Two is what fits legibly on 62mm without shrinking the price.
    .slice(0, 2)
    .map((t) => ({ minQty: t.min_qty, unitPrice: t.unit_price }));

  const name = variant
    ? `${product.name} — ${Object.values(variant.options as Record<string, string>).join(', ')}`
    : product.name;

  return {
    version: 1,
    kind: 'shelf_label',
    name,
    sub: product.sub ?? null,
    price: effectivePrice,
    barcode: (variant ? (variant.barcode as string | null) : product.barcode) ?? null,
    bulkTiers,
    issuedAt: new Date().toISOString(),
  };
}

/** Which printer each test variant belongs on. */
const TARGET_FOR_TEST_VARIANT: Record<PrintTestVariant, 'receipt' | 'label'> = {
  width: 'receipt',
  cut: 'receipt',
  encoding: 'receipt',
  barcode: 'receipt',
  label: 'label',
};

/**
 * Which printer a job goes to.
 *
 * `test_print` is the only kind whose target is not fixed by the kind alone —
 * it can exercise either printer, which is the whole point of it. Everything
 * else is a lookup.
 */
export function resolveTarget(
  kind: keyof typeof TARGET_FOR_KIND,
  variant: PrintTestVariant | undefined,
): 'receipt' | 'label' {
  if (kind === 'test_print') return TARGET_FOR_TEST_VARIANT[variant ?? 'width'];
  return TARGET_FOR_KIND[kind];
}

/**
 * Change request item 7 — freeze today's figures for the printed End Day
 * report.
 *
 * Reads pos_today_report(), the SAME function the "My day" panel on screen
 * reads. That is the whole design: the panel and the paper cannot disagree
 * about the day's takings, because there is one definition of them. The
 * doc's requirement that a later reprint show newer transactions comes free —
 * each press reads the function again.
 *
 * `staffId` is who pressed the button, resolved to a name here rather than
 * taken from the request, like every other staff attribution in this
 * codebase. Null is fine and prints nothing.
 */
async function buildDayReport(staffId: string | undefined): Promise<DayReportPayload> {
  const { data, error } = await supabaseAdmin.rpc('pos_today_report');
  if (error || !data) throw new PrintPayloadError('Could not read the day’s figures.');

  const report = data as {
    date: string;
    total: number;
    salesCount: number;
    averageSale: number;
    itemsSold?: number;
    jobsCompleted?: number;
    repairTakings?: number;
    byTender: { tender: string; count: number; total: number }[];
  };

  let staffName: string | null = null;
  if (staffId) {
    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('name')
      .eq('id', staffId)
      .maybeSingle();
    staffName = (staff?.name as string | undefined) ?? null;
  }

  return {
    version: 1,
    kind: 'day_report',
    date: report.date,
    issuedAt: new Date().toISOString(),
    staffName,
    total: report.total,
    salesCount: report.salesCount,
    averageSale: report.averageSale,
    // Defaulted rather than required: these three arrive with 0084, and a
    // report printed against an older function body should still print.
    itemsSold: report.itemsSold ?? 0,
    jobsCompleted: report.jobsCompleted ?? 0,
    repairTakings: report.repairTakings ?? 0,
    byTender: report.byTender ?? [],
  };
}

async function buildTestPrint(
  variant: PrintTestVariant,
  entityId: string | undefined,
): Promise<TestPrintPayload> {
  let product: { name: string; barcode: string } | null = null;

  // The two scannable variants need a real product, because the test is
  // "does the shop's scanner read this back as the right item", not "did bars
  // appear". Refused rather than degraded: a barcode test that silently prints
  // no barcode is a test that always passes.
  if (variant === 'barcode' || variant === 'label') {
    if (!entityId) {
      throw new PrintPayloadError(
        "Pick a product for this test — it prints that product's barcode so it can be scanned back on the till.",
      );
    }
    const { data } = await supabaseAdmin
      .from('products')
      .select('name, barcode')
      .eq('id', entityId)
      .maybeSingle();
    if (!data) throw new PrintPayloadError('That product no longer exists.');
    if (!data.barcode) {
      throw new PrintPayloadError(
        `"${data.name}" has no barcode saved, so there is nothing to scan back. Pick a product with a barcode.`,
      );
    }
    product = { name: data.name, barcode: data.barcode };
  }

  return {
    version: 1,
    kind: 'test_print',
    target: TARGET_FOR_TEST_VARIANT[variant],
    variant,
    issuedAt: new Date().toISOString(),
    product,
  };
}

/**
 * `staff` arrives as an object or a one-element array depending on how
 * PostgREST resolves the embed; normalise rather than guess.
 *
 * One copy. It was written out three times across the builders below, which is
 * how a fix lands on the sale receipt and not the refund.
 */
function embeddedStaffName(row: unknown): string | null {
  const embed = (row as { staff?: unknown }).staff;
  return (
    (Array.isArray(embed)
      ? (embed[0] as { name?: string } | undefined)?.name
      : (embed as { name?: string } | null)?.name) ?? null
  );
}

/** Build the frozen payload for a kind + entity. */
export async function buildPrintPayload(
  kind: keyof typeof TARGET_FOR_KIND,
  entityId: string | undefined,
  variant?: PrintTestVariant,
): Promise<PrintPayload> {
  switch (kind) {
    case 'sale_receipt':
      if (!entityId) throw new PrintPayloadError('A sale id is required for a sale receipt.');
      return buildSaleReceipt(entityId);
    case 'refund_receipt':
      if (!entityId) throw new PrintPayloadError('A refund id is required for a refund receipt.');
      return buildRefundReceipt(entityId);
    case 'payout_receipt':
      if (!entityId) throw new PrintPayloadError('A payout id is required for a payout receipt.');
      return buildPayoutReceipt(entityId);
    case 'job_label':
      if (!entityId) throw new PrintPayloadError('A job id is required for a job label.');
      return buildJobLabel(entityId);
    case 'shelf_label':
      if (!entityId) throw new PrintPayloadError('A product id is required for a shelf label.');
      return buildShelfLabel(entityId);
    case 'day_report':
      // No entity id: the day is not a row, it is whatever shop_day() says
      // now. entityId is used here for the STAFF member whose name goes on
      // the paper — see buildDayReport.
      return buildDayReport(entityId);
    case 'test_print':
      return buildTestPrint(variant ?? 'width', entityId);
    default: {
      // Exhaustive: adding a kind to TARGET_FOR_KIND without a builder is a
      // compile error here rather than a 400 discovered at the counter.
      const unreachable: never = kind;
      throw new PrintPayloadError(`Print kind "${String(unreachable)}" has no payload builder.`);
    }
  }
}
