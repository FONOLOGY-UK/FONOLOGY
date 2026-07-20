import { z } from 'zod';
import { idSchema, isoDateSchema, isoDateTimeSchema } from './common';
import { moneySchema } from './pricing';

/**
 * POS checkout (item 8) — the counter sale. NO VAT anywhere (HARD RULE #3):
 * a price is a price, a total is a total.
 */

/** Tenders the counter accepts. Stripe is online-only — never a POS mode. */
export const posTenderSchema = z.enum(['cash', 'pos1', 'pos2', 'transfer']);
export type PosTender = z.infer<typeof posTenderSchema>;

export const saleLineSchema = z.object({
  productId: idSchema,
  name: z.string(),
  sub: z.string(),
  quantity: z.number().int().positive(),
  /** Price actually charged per unit (tier price when a bulk tier applied). */
  unitPrice: moneySchema,
  /** The normal shelf price, kept for the receipt's "you saved" honesty. */
  listPrice: moneySchema,
  /** Unit cost at time of sale — drives the below-cost warning. */
  costPrice: moneySchema,
  /** True when tiered bulk pricing set `unitPrice`. */
  tierApplied: z.boolean(),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

/** One portion of a (possibly split) payment. */
export const salePaymentSchema = z.object({
  tender: posTenderSchema,
  amount: moneySchema.positive(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

export const saleInputSchema = z
  .object({
    lines: z.array(saleLineSchema).min(1, 'Nothing on the ticket'),
    /** Order-level discount in pence (already resolved from % or £ entry). */
    discount: moneySchema.min(0),
    payments: z.array(salePaymentSchema).min(1, 'No payment taken'),
  })
  .refine(
    (v) => {
      const subtotal = v.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
      const total = Math.max(0, subtotal - v.discount);
      const paid = v.payments.reduce((s, p) => s + p.amount, 0);
      return paid === total;
    },
    { message: 'Payments must add up to the total exactly', path: ['payments'] },
  );
export type SaleInput = z.infer<typeof saleInputSchema>;

export const saleSchema = z.object({
  id: idSchema,
  reference: z.string(), // "FNL-1234" — printed on the receipt
  lines: z.array(saleLineSchema),
  subtotal: moneySchema,
  discount: moneySchema,
  total: moneySchema,
  /** Combined cost of goods — kept for admin analytics, never on the receipt. */
  cost: moneySchema,
  payments: z.array(salePaymentSchema),
  at: isoDateTimeSchema,
});
export type Sale = z.infer<typeof saleSchema>;

/**
 * The one sales figure employees may see (permission `sales.today`):
 * today's total and count. Deliberately contains NO history, margins or
 * breakdowns — those live behind `analytics.view`.
 */
export const todaySummarySchema = z.object({
  date: isoDateSchema,
  total: moneySchema,
  sales: z.number().int(),
});
export type TodaySummary = z.infer<typeof todaySummarySchema>;
