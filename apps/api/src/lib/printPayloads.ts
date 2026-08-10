import { supabaseAdmin } from './supabase.js';

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
 * wording, the footer) is Part 3 of this build and is deliberately not decided
 * in this file. What is decided here is which facts get frozen.
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
  phone: string;
  deviceDescription: string;
  problemDescription: string;
  quotedPrice: number | null;
  paymentStatus: string;
}

export interface TestPrintPayload {
  version: 1;
  kind: 'test_print';
  target: 'receipt' | 'label';
  issuedAt: string;
}

export type PrintPayload = SaleReceiptPayload | JobLabelPayload | TestPrintPayload;

/** Which physical printer a kind belongs on. Not caller-supplied. */
export const TARGET_FOR_KIND = {
  sale_receipt: 'receipt',
  refund_receipt: 'receipt',
  payout_receipt: 'receipt',
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

  // `staff` arrives as an object or a one-element array depending on how
  // PostgREST resolves the embed; normalise rather than guess.
  const staffEmbed = (sale as { staff?: unknown }).staff;
  const staffName =
    (Array.isArray(staffEmbed)
      ? (staffEmbed[0] as { name?: string } | undefined)?.name
      : (staffEmbed as { name?: string } | null)?.name) ?? null;

  return {
    version: 1,
    kind: 'sale_receipt',
    reference: sale.reference,
    soldAt: sale.created_at,
    staffName,
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
      'reference, created_at, customer_name, phone, device_description, problem_description, quoted_price, payment_status',
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
    phone: job.phone,
    deviceDescription: job.device_description,
    problemDescription: job.problem_description,
    quotedPrice: job.quoted_price ?? null,
    paymentStatus: job.payment_status,
  };
}

/**
 * Build the frozen payload for a kind + entity.
 *
 * refund_receipt, payout_receipt and shelf_label are intentionally not
 * implemented yet: Phase 1 flagged that each needs its own investigation
 * (a BUY- payout is money OUT and excluded from revenue; a shelf label must
 * never carry stock counts, cost or margin). Guessing a format for them now
 * would be worse than refusing, so they refuse loudly.
 */
export async function buildPrintPayload(
  kind: keyof typeof TARGET_FOR_KIND,
  entityId: string | undefined,
): Promise<PrintPayload> {
  switch (kind) {
    case 'sale_receipt':
      if (!entityId) throw new PrintPayloadError('A sale id is required for a sale receipt.');
      return buildSaleReceipt(entityId);
    case 'job_label':
      if (!entityId) throw new PrintPayloadError('A job id is required for a job label.');
      return buildJobLabel(entityId);
    case 'test_print':
      return {
        version: 1,
        kind: 'test_print',
        target: 'receipt',
        issuedAt: new Date().toISOString(),
      };
    default:
      throw new PrintPayloadError(
        `Print kind "${kind}" is not built yet — its content is still being specified.`,
      );
  }
}
