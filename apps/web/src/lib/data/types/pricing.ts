import { z } from 'zod';

/**
 * MONEY
 * =====
 * All monetary amounts in the system are integers in **GBP pence** (e.g. £24.00
 * is `2400`). Integer minor-units avoid floating-point rounding errors on
 * subtotals and are the shape Raja's backend / payment provider will speak.
 * The display layer is the ONLY place pounds appear — via `formatGBP`.
 *
 * ---------------------------------------------------------------------------
 * HARD RULE #3 — NO VAT, ANYWHERE. This is a deliberate business decision:
 * Fonology is NOT VAT registered. Therefore there is intentionally:
 *   • no VAT field on Money, line items, orders or bookings,
 *   • no VAT column, VAT line, or ex-VAT / inc-VAT labelling on any receipt,
 *   • no VAT number in the footer or anywhere else.
 * A price is simply a price. Do not add VAT handling later without an explicit
 * change to Fonology's VAT-registration status. See NOTES.md.
 * ---------------------------------------------------------------------------
 */

/** Money in GBP pence. Always an integer. */
export const moneySchema = z.number().int('Money must be whole pence');
export type Money = z.infer<typeof moneySchema>;

/** Convenience constructor: pounds -> pence. */
export const pounds = (value: number): Money => Math.round(value * 100);

/** Format pence as a UK price string, e.g. 2400 -> "£24", 2450 -> "£24.50". */
export function formatGBP(pence: Money, options?: { alwaysShowPennies?: boolean }): string {
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const whole = Math.floor(abs / 100);
  const remainder = abs % 100;
  const showPennies = options?.alwaysShowPennies || remainder !== 0;
  const body = showPennies
    ? `£${whole.toLocaleString('en-GB')}.${remainder.toString().padStart(2, '0')}`
    : `£${whole.toLocaleString('en-GB')}`;
  return negative ? `-${body}` : body;
}
