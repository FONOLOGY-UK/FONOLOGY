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
  /**
   * What the staff member typed off the card machine's receipt slip.
   *
   * Optional everywhere, by design (migration 0030): a busy counter will skip
   * it, and making it required would either block a finished sale or train
   * people to type junk. Absent on cash and transfer, which have no slip.
   *
   * Note this is only ever SENT — the sale returned by the API reuses this
   * schema and the API does not echo the reference back, so it is optional in
   * both directions.
   */
  reference: z.string().trim().min(1).optional(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

export const saleInputSchema = z
  .object({
    lines: z.array(saleLineSchema).min(1, 'Nothing on the ticket'),
    /** Order-level discount in pence (already resolved from % or £ entry). */
    discount: moneySchema.min(0),
    payments: z.array(salePaymentSchema).min(1, 'No payment taken'),
    /**
     * Why this sale went through at or below cost — always optional, never
     * required to complete the sale (below-cost warns, it never blocks).
     * Additive over the original mock signature — the backend has accepted
     * this since B4; there was simply no input for it. See the
     * fix-the-small-stuff report.
     */
    belowCostReason: z.string().trim().optional(),
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
  /** Additive over the original mock signature — the API has always returned these. */
  belowCost: z.boolean().optional(),
  belowCostReason: z.string().nullable().optional(),
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

/** One completed counter sale, as the employee's day panel lists it. */
export const todaySaleSchema = z.object({
  reference: z.string(),
  at: isoDateTimeSchema,
  /** The sale total (all payment portions summed). */
  total: moneySchema,
  /** Which tenders paid for it — one entry per portion, in order taken. */
  tenders: z.array(posTenderSchema),
  description: z.string(),
});
export type TodaySale = z.infer<typeof todaySaleSchema>;

/** Takings for one tender within the day. */
export const todayTenderSchema = z.object({
  tender: posTenderSchema,
  count: z.number().int(),
  total: moneySchema,
});
export type TodayTender = z.infer<typeof todayTenderSchema>;

/**
 * The employee day panel (permission `sales.today`). It mirrors the admin
 * overview in spirit — total, count, payment mix, the day's sales — but is
 * scoped HARD to today: no range picker, no history, no cost or margin. The
 * backend must not let this endpoint reach beyond the current trading day.
 */
export const todayReportSchema = z.object({
  date: isoDateSchema,
  total: moneySchema,
  /** DISTINCT sales (split payments count once), unlike TodaySummary.sales. */
  salesCount: z.number().int(),
  /** Average sale value, pence (0 when no sales). */
  averageSale: moneySchema,
  /** When the last sale went through — null before the first one. */
  lastSaleAt: isoDateTimeSchema.nullable(),
  byTender: z.array(todayTenderSchema),
  sales: z.array(todaySaleSchema),
});
export type TodayReport = z.infer<typeof todayReportSchema>;
