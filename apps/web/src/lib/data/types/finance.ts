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
 * A processed refund against an order. When the order is outside the return
 * window (Settings → returnWindowDays, default 30), processing requires an
 * explicit admin override and the reason is kept on record.
 */
export const refundInputSchema = z.object({
  orderReference: z.string().trim().min(1, 'Enter the order reference'),
  amount: moneySchema.positive('Enter the refund amount'),
  reason: z.string().trim().min(3, 'A reason is required'),
  tender: tenderSchema,
  /** True when an admin knowingly refunded outside the window. */
  override: z.boolean(),
});
export type RefundInput = z.infer<typeof refundInputSchema>;

export const refundSchema = refundInputSchema.extend({
  id: idSchema,
  at: isoDateTimeSchema,
  /** Whether the order was inside the return window at the time. */
  withinWindow: z.boolean(),
});
export type Refund = z.infer<typeof refundSchema>;
