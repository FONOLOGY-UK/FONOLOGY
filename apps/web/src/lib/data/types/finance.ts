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

export function tenderLabel(tender: Tender | null): string {
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
    case null:
      // A split-payment sale or an online order has no single tender to
      // show — see the transactions view (`transactions.tender` is
      // deliberately NULL for `sales`/`orders` rows; sale_payments carries
      // the real per-tender split). Never fabricated as one tender.
      return 'Mixed / online';
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
  /**
   * Null for a split-payment till sale or an online order — no single
   * tender honestly represents either (see tenderLabel's null case).
   * Additive over the original mock signature — see the connect-and-test
   * report.
   */
  tender: tenderSchema.nullable(),
  /**
   * Set only for a split-tender till sale (where `tender` above is null) —
   * the distinct methods it was actually paid across, e.g. `['cash', 'pos1']`.
   * FEATURE-13: lets the Counter Sales view show something for a split sale
   * instead of a blank cell, and is what "filter by payment type" actually
   * matches against for those rows server-side.
   */
  tenders: tenderSchema.array().nullable().optional(),
  category: productCategoryIdSchema.nullable(),
  /** Who handled it — set for till sales, null for online orders (FEATURE-13). */
  staffId: idSchema.nullable().optional(),
  staffName: z.string().nullable().optional(),
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

/**
 * A recorded cash entry as the API returns it.
 *
 * `staffId` is who recorded it, taken from the session server-side — the
 * request body's `staffName` is ignored, so a client can never attribute a
 * money record to someone else. `staffName` stays here only because the mock
 * fixtures carry it; against the real API it is absent and the recorder's
 * name is resolved from `staffId`.
 */
export const cashEntrySchema = cashEntryInputSchema.extend({
  id: idSchema,
  at: isoDateTimeSchema,
  staffId: idSchema.nullable().optional(),
  staffName: z.string().nullable().optional(),
});
export type CashEntry = z.infer<typeof cashEntrySchema>;

/* ---- Day close (end-of-day cash up) -------------------------------------- */

/**
 * How the server reached the expected figure. Every term is a positive
 * magnitude; the formula supplies the direction:
 *
 *   expected = floatOpen + pettyIn − pettyOut + cashSales + cashRepairs
 *              − cashRefunds − cashPayouts
 *
 * `cashPayouts` is cash handed over for customers' traded-in phones. It leaves
 * the same drawer, so leaving it out makes every close look short by exactly
 * that amount. The server computes all of this — never the client.
 *
 * `cashRepairs` is cash taken on repair deposits and balances (migration
 * 0031). It goes into the same drawer, and leaving it out made every close
 * with a cash repair look OVER by exactly that amount. There is deliberately
 * no separate repair-refund term: a cash refund of a repair deposit is
 * already inside `cashRefunds`, which is not filtered by what the refund is
 * linked to.
 *
 * Null on closes recorded before the breakdown was stored (migration 0024).
 * Closes recorded between 0024 and 0031 report `cashRepairs: 0` — they were
 * reconciled before repair cash counted, and 0031 does not restate history.
 */
/**
 * The shop's current trading day, from the server. Europe/London, never the
 * browser's clock — a machine past local midnight (or in another timezone)
 * would otherwise disagree with the server about which day is being closed.
 */
export const shopDaySchema = z.object({ date: isoDateSchema });
export type ShopDay = z.infer<typeof shopDaySchema>;

export const dayCloseBreakdownSchema = z.object({
  floatOpen: moneySchema,
  pettyIn: moneySchema,
  pettyOut: moneySchema,
  cashSales: moneySchema,
  cashRepairs: moneySchema,
  cashRefunds: moneySchema,
  cashPayouts: moneySchema,
});
export type DayCloseBreakdown = z.infer<typeof dayCloseBreakdownSchema>;

/**
 * What the operator submits. Deliberately just the count and an optional
 * note: the cash-up is BLIND. The expected figure is not shown before the
 * count is committed, because an operator who can see the target will recount
 * until they reach it, and a count that already knows the answer isn't a
 * count.
 */
export const dayCloseInputSchema = z.object({
  countedAmount: moneySchema.nonnegative('Counted cash cannot be negative'),
  note: z.string().trim().max(500).optional(),
});
export type DayCloseInput = z.infer<typeof dayCloseInputSchema>;

export const dayCloseSchema = z.object({
  id: idSchema,
  date: isoDateSchema,
  /** Server-computed. Legitimately negative on a heavy cash-payout day. */
  expectedAmount: moneySchema,
  countedAmount: moneySchema,
  /** countedAmount − expectedAmount. Recorded, not accusatory. */
  variance: moneySchema,
  note: z.string().nullable(),
  staffId: idSchema.nullable(),
  at: isoDateTimeSchema,
  breakdown: dayCloseBreakdownSchema.nullable(),
});
export type DayClose = z.infer<typeof dayCloseSchema>;

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
  /** Round 5 Phase 4 #16. Which variant, when the original line was one — a
   * restock credits this specific variant's shelf, not the parent's. */
  variantId: idSchema.nullable().optional(),
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
  /**
   * True when an admin knowingly refunded outside the window / with no
   * receipt. Input only — it comes back as `windowOverrideBy` (who
   * authorised it), not as a boolean.
   *
   * There is deliberately no `staffName` here. The API stamps the staff
   * member from the session and ignores anything the body says, so asking
   * the operator to type a name would only misrepresent who did it.
   */
  override: z.boolean(),
});
export type RefundInput = z.infer<typeof refundInputSchema>;

/**
 * A processed return as the API returns it.
 *
 * Deliberately NOT `refundInputSchema.extend(...)`. What the form sends and
 * what the server returns are different shapes, and conflating them is what
 * broke this screen: the input carries `staffName` (a free-text "who
 * processed this?" box) and `override` (a checkbox), neither of which comes
 * back. The server stamps the staff member from the session and records the
 * override as *who authorised it*, not as a bare boolean.
 */
export const refundSchema = z.object({
  id: idSchema,
  source: returnSourceSchema,
  /** The ORIGINAL sale/order reference the refund was taken against. */
  reference: z.string().nullable(),
  /**
   * The refund's OWN reference — `REF-` series, minted by migration 0035.
   *
   * Distinct from `reference` above, and both are printed on the refund
   * receipt. Before 0035 a refund had no reference of its own, so two partial
   * refunds against one sale were identical on the paper the customer keeps.
   */
  refundReference: z.string().nullable(),
  lines: z.array(returnLineSchema),
  amount: moneySchema,
  reason: z.string(),
  /** What the refund was paid out to. */
  tender: tenderSchema,
  /** What the customer originally paid with — server-derived from the sale. */
  originalTender: tenderSchema.nullable(),
  restock: z.boolean(),
  /** Taken from the session, never from the request body. */
  staffId: idSchema.nullable(),
  /** Resolved server-side from `staffId` — the screen never joins staff itself. */
  staffName: z.string().nullable(),
  /** Was the sale outside the return window at the time? */
  outsideWindow: z.boolean(),
  /** Who authorised an outside-window refund. Null when none was needed. */
  windowOverrideBy: idSchema.nullable(),
  at: isoDateTimeSchema,
  /** Convenience inverse of `outsideWindow`, sent by the API. */
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
/** How a payout leaves the till. Only these two — a device isn't bought on card. */
export const payoutMethodSchema = z.enum(['cash', 'bank_transfer']);
export type PayoutMethod = z.infer<typeof payoutMethodSchema>;

export function payoutMethodLabel(method: PayoutMethod): string {
  return method === 'cash' ? 'Cash' : 'Bank transfer';
}

/**
 * What the counter sends to record a buy-in.
 *
 * `amount` is POSITIVE here — "what we paid" as a person would say it — and
 * the server is the single place it becomes negative. There is deliberately
 * no `staffName`: the server stamps the staff member from the session, so
 * offering the field would only let the body disagree with the truth.
 *
 * There is also no `addToStock`/`resalePrice` here. Restocking is a separate,
 * deliberate step (`POST /sell/payouts/:id/restock`) — a bought device becomes
 * stock only when someone ticks the box and sets a price, never as a side
 * effect of paying for it.
 */
export const tradeInPayoutInputSchema = z.object({
  /** What was bought, as the counter would write it on the label. */
  deviceLabel: z.string().trim().min(2, 'What did we buy?'),
  customerName: z.string().trim().min(2, 'Who did we buy it from?'),
  amount: moneySchema.positive('Enter what we paid'),
  method: payoutMethodSchema,
  notes: z.string().trim().max(500).optional(),
});
export type TradeInPayoutInput = z.infer<typeof tradeInPayoutInputSchema>;

/**
 * A payout as the API returns it.
 *
 * `amount` is NEGATIVE — money out — exactly as stored, deliberately not
 * flipped to a friendly positive on the way through. Payouts carry the `BUY-`
 * reference series and are excluded from every revenue figure; the cash ones
 * are what the day-close subtracts.
 */
export const tradeInPayoutSchema = z.object({
  id: idSchema,
  /** `BUY-…` — its own series, printed on the buy-in form. */
  reference: z.string(),
  /** Set when the payout came from a website request; null for a walk-in. */
  sellRequestId: idSchema.nullable(),
  deviceLabel: z.string(),
  customerName: z.string(),
  /** Negative. Money out. */
  amount: moneySchema,
  method: payoutMethodSchema,
  staffId: idSchema.nullable(),
  /** Resolved server-side so the screen never has to join staff itself. */
  staffName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  restocked: z.boolean(),
  /** Set only once someone has actually restocked it. */
  resalePrice: moneySchema.nullable().optional(),
  restockedProductId: idSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
});
export type TradeInPayout = z.infer<typeof tradeInPayoutSchema>;

/** Payout ledger filters. `restocked` absent = all. */
export const tradeInPayoutQuerySchema = z.object({
  restocked: z.boolean().optional(),
  /**
   * Payouts for one sell request. `search` cannot do this — it matches a
   * payout's own BUY- reference, device label and customer name, never the
   * request's FNL- reference.
   */
  sellRequestId: z.string().optional(),
  search: z.string().trim().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type TradeInPayoutQuery = z.infer<typeof tradeInPayoutQuerySchema>;

export const tradeInPayoutPageSchema = z.object({
  items: z.array(tradeInPayoutSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type TradeInPayoutPage = z.infer<typeof tradeInPayoutPageSchema>;

/**
 * Putting a bought device on the shelf. The COST recorded against it is the
 * payout amount — what the shop actually paid — never a guess, so margin on
 * the eventual sale is real.
 */
export const restockInputSchema = z.object({
  name: z.string().trim().min(2, 'Name it as it will appear on the shelf'),
  // categories.id (FEATURE-05, migration 0045) — was its own hardcoded copy
  // of the fixed 7-value enum, independent of productCategoryIdSchema.
  categoryId: z.string().min(1, 'Choose a category'),
  resalePrice: moneySchema.positive('Set a resale price'),
});
export type RestockInput = z.infer<typeof restockInputSchema>;

/** The product created by a restock. */
export const restockedProductSchema = z.object({
  id: idSchema,
  slug: z.string(),
  name: z.string(),
  price: moneySchema,
  costPrice: moneySchema,
  stockQty: z.number().int(),
});
export type RestockedProduct = z.infer<typeof restockedProductSchema>;
