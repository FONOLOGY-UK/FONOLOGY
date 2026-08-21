import type { Money } from './types';

/**
 * PROMO CODES — MOCK / DEMO ONLY (6.3 checkout field, 6.7 "no promotion engine").
 * There is intentionally NO promotion engine. This is a single hard-coded demo
 * code so the checkout's discount field + error states can be exercised. The
 * real backend owns promo validation; the UI just renders what it returns. Do
 * not grow this into a rules engine.
 */
/**
 * EMPTY ON PURPOSE — DO NOT ADD A CODE HERE.
 *
 * This used to hold FIXED10 (10% off). It was written when the checkout was a
 * prototype and nothing charged anybody. It is dangerous now.
 *
 * There is no promotion engine on the server, by design: `create_order` is
 * called with `p_discount: 0` and the API's own comment says the schema has no
 * customer-facing discount-code path. `promoCode` is accepted by the request
 * body purely so a real request validates, and is never read again.
 *
 * So a code that discounts client-side changes the number on the Pay button
 * and the order summary, and changes NOTHING about what is charged — the
 * payment intent is built from `orders.total`, which the server computed with
 * no discount. A customer entering FIXED10 was shown one price and charged a
 * higher one. That is not a "free stuff" hole; it is the opposite, and
 * overcharging against a displayed price is a consumer-protection problem
 * rather than merely a bug.
 *
 * With the map empty, `isValidPromo` returns false for everything, the
 * checkout says the code isn't recognised — which is TRUE, because the server
 * recognises none — and the displayed total can never diverge from the charged
 * total. The field stays for whenever a real engine exists.
 *
 * If a promotion engine is ever built: the discount must be computed and
 * applied SERVER-side inside create_order, and this file should read what the
 * server returned rather than deciding anything itself.
 */
const DEMO_CODES: Record<string, { type: 'percent' | 'fixed'; value: number }> = {};

export function isValidPromo(code: string): boolean {
  return Boolean(DEMO_CODES[code.trim().toUpperCase()]);
}

/** Discount in pence for a subtotal, or 0 if the code is unknown/empty. */
export function applyPromo(code: string | undefined, subtotal: Money): Money {
  if (!code) return 0;
  const promo = DEMO_CODES[code.trim().toUpperCase()];
  if (!promo) return 0;
  return promo.type === 'percent'
    ? Math.round((subtotal * promo.value) / 100)
    : Math.min(subtotal, promo.value);
}
