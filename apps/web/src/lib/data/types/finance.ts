import { z } from 'zod';
import { idSchema, isoDateSchema, isoDateTimeSchema } from './common';
import { moneySchema } from './pricing';
import { productCategoryIdSchema } from './product';

/**
 * Money movement (item 7: Payments, Float & petty cash, Returns & refunds).
 * Everything is integer pence, NO VAT anywhere (HARD RULE #3 — see pricing.ts).
 *
 * `Tender` is how money physically changed hands at the counter/online —
 * distinct from the storefront's checkout `paymentMethod` (stripe/clearpay),
 * which is a customer-facing choice. The backend maps one onto the other.
 */

export const tenderSchema = z.enum(['cash', 'pos1', 'pos2', 'transfer', 'stripe']);
export type Tender = z.infer<typeof tenderSchema>;

/** Fixed display order — reports and filters always list tenders in this order. */
export const TENDERS: Tender[] = ['cash', 'pos1', 'pos2', 'transfer', 'stripe'];

export function tenderLabel(tender: Tender): string {
  switch (tender) {
    case 'cash':
      return 'Cash';
    case 'pos1':
      return 'Card — POS 1';
    case 'pos2':
      return 'Card — POS 2';
    case 'transfer':
      return 'Online transfer';
    case 'stripe':
      return 'Stripe (online)';
  }
}

/** Which side of the business earned (or spent) the money. */
export const revenueStreamSchema = z.enum(['shop', 'repair', 'trade-in']);
export type RevenueStream = z.infer<typeof revenueStreamSchema>;

export function revenueStreamLabel(stream: RevenueStream): string {
  switch (stream) {
    case 'shop':
      return 'Shop';
    case 'repair':
      return 'Repairs';
    case 'trade-in':
      return 'Trade-in';
  }
}

/**
 * One settled payment. Negative `amount` = money out (refunds, trade-in
 * payouts). `category` is set for shop sales so analytics can break revenue
 * down by product category; null for repairs and trade-ins.
 */
export const transactionSchema = z.object({
  id: idSchema,
  at: isoDateTimeSchema,
  stream: revenueStreamSchema,
  /** Order/job/sell reference this payment settles, e.g. "FNL-1042". */
  reference: z.string(),
  description: z.string(),
  amount: moneySchema,
  /** Cost of goods/parts for this sale, in pence — drives profit/margin. */
  cost: moneySchema,
  tender: tenderSchema,
  category: productCategoryIdSchema.nullable(),
});
export type Transaction = z.infer<typeof transactionSchema>;

/* ---- Float & petty cash --------------------------------------------------- */

/**
 * Till cash movements, tracked separately from sales revenue (per the brief).
 * `float-open` is recorded once per trading day — the shell prompts on the
 * first admin visit of the day if it's missing.
 */
export const cashEntryKindSchema = z.enum(['float-open', 'petty-in', 'petty-out']);
export type CashEntryKind = z.infer<typeof cashEntryKindSchema>;

export function cashEntryKindLabel(kind: CashEntryKind): string {
  switch (kind) {
    case 'float-open':
      return 'Opening float';
    case 'petty-in':
      return 'Petty cash in';
    case 'petty-out':
      return 'Petty cash out';
  }
}

export const cashEntryInputSchema = z.object({
  date: isoDateSchema,
  kind: cashEntryKindSchema,
  /** Always positive; `kind` carries the direction. */
  amount: moneySchema.positive('Enter an amount'),
  note: z.string().trim().min(2, 'Say what this was for'),
  staffName: z.string().trim().min(1, 'Who recorded this?'),
});
export type CashEntryInput = z.infer<typeof cashEntryInputSchema>;

export const cashEntrySchema = cashEntryInputSchema.extend({
  id: idSchema,
  at: isoDateTimeSchema,
});
export type CashEntry = z.infer<typeof cashEntrySchema>;

/* ---- Returns & refunds ---------------------------------------------------- */

/**
 * Where the returned goods came from. A return is not only money out — it is
 * stock coming back, and the three sources behave differently:
 *   • `order`      — an online order, looked up by its FNL reference
 *   • `counter`    — a till sale, looked up by its receipt reference
 *   • `no-receipt` — a goodwill return with no reference; items are picked
 *                    from the catalogue by hand and an override is required
 */
export const returnSourceSchema = z.enum(['order', 'counter', 'no-receipt']);
export type ReturnSource = z.infer<typeof returnSourceSchema>;

export function returnSourceLabel(source: ReturnSource): string {
  switch (source) {
    case 'order':
      return 'Online order';
    case 'counter':
      return 'Counter sale';
    case 'no-receipt':
      return 'No receipt';
  }
}

/** One item physically coming back over the counter. */
export const returnLineSchema = z.object({
  /** Null when the item isn't a catalogue product (a repair, a one-off). */
  productId: idSchema.nullable(),
  name: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  /** What the customer paid per unit, in pence. */
  unitPrice: moneySchema,
});
export type ReturnLine = z.infer<typeof returnLineSchema>;

/**
 * A processed return. When the sale is outside the return window (Settings →
 * returnWindowDays, default 30) — or there is no receipt at all — processing
 * requires an explicit admin override and the reason is kept on record.
 */
export const refundInputSchema = z.object({
  source: returnSourceSchema,
  /** Order or receipt reference. Null only for `no-receipt` returns. */
  reference: z.string().trim().nullable(),
  /** What came back. May be empty for a partial money-only adjustment. */
  lines: z.array(returnLineSchema),
  amount: moneySchema.positive('Enter the refund amount'),
  reason: z.string().trim().min(3, 'A reason is required'),
  tender: tenderSchema,
  /** Put the returned items back on the shelf (false = faulty/write-off). */
  restock: z.boolean(),
  staffName: z.string().trim().min(1, 'Who processed this?'),
  /** True when an admin knowingly refunded outside the window / with no receipt. */
  override: z.boolean(),
});
export type RefundInput = z.infer<typeof refundInputSchema>;

export const refundSchema = refundInputSchema.extend({
  id: idSchema,
  at: isoDateTimeSchema,
  /** Whether the sale was inside the return window at the time. */
  withinWindow: z.boolean(),
});
export type Refund = z.infer<typeof refundSchema>;

/* ---- Trade-ins / buy-ins -------------------------------------------------- */

/**
 * Money paid OUT to a customer for a device the shop bought in. This is the
 * counterpart to the `trade-in` rows already in the payments ledger: it posts
 * a NEGATIVE transaction, so a buy-in reduces net revenue for the period
 * rather than looking like a sale.
 *
 * `addToStock` is a request, not a guarantee — creating the resale listing is
 * the backend's job (see INTEGRATION.md). The frontend records the intent and
 * the asking price so nothing is lost.
 */
export const tradeInPayoutInputSchema = z.object({
  /** What was bought, as the counter would write it on the label. */
  deviceLabel: z.string().trim().min(2, 'What did we buy?'),
  /** Sell-request reference (FNL-3xxx) when it came from the website. */
  sourceReference: z.string().trim().nullable(),
  customerName: z.string().trim().min(2, 'Who did we buy it from?'),
  /** Always positive here; it is stored in the ledger as money out. */
  amount: moneySchema.positive('Enter what we paid'),
  tender: tenderSchema,
  staffName: z.string().trim().min(1, 'Who bought it in?'),
  notes: z.string().trim().max(500).optional(),
  /** Add the device to inventory for resale. */
  addToStock: z.boolean(),
  /** Intended resale price, in pence. Null when not decided yet. */
  resalePrice: moneySchema.nullable(),
});
export type TradeInPayoutInput = z.infer<typeof tradeInPayoutInputSchema>;

export const tradeInPayoutSchema = tradeInPayoutInputSchema.extend({
  id: idSchema,
  /** The payout's own reference, printed on the buy-in form. */
  reference: z.string(),
  at: isoDateTimeSchema,
});
export type TradeInPayout = z.infer<typeof tradeInPayoutSchema>;
