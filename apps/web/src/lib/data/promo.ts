import type { Money } from './types';

/**
 * PROMO CODES — MOCK / DEMO ONLY (6.3 checkout field, 6.7 "no promotion engine").
 * There is intentionally NO promotion engine. This is a single hard-coded demo
 * code so the checkout's discount field + error states can be exercised. The
 * real backend owns promo validation; the UI just renders what it returns. Do
 * not grow this into a rules engine.
 */
const DEMO_CODES: Record<string, { type: 'percent' | 'fixed'; value: number }> = {
  FIXED10: { type: 'percent', value: 10 }, // 10% off — demo
};

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
