import { pounds, type Money } from '@/lib/data/types';

/**
 * Storefront business config — single source for client-confirmable values.
 * These are placeholders reproduced/derived from the prototype + PRD and are
 * PENDING CLIENT CONFIRMATION (see CONTENT-TODO.md / NOTES.md). No promotion
 * engine sits behind any promo copy (6.7).
 */

/** Return window, in days. Matches the prototype's "30-DAY" copy (6.7). */
export const RETURN_WINDOW_DAYS = 30;

/**
 * UK-only delivery SPEEDS (6.3) — the customer's real choice. "Remote" is
 * deliberately not here: it isn't a speed the customer picks, it's a fact
 * about their postcode the server derives (see delivery_quote() /
 * 0021_delivery_quote.sql). `price` is the standard-zone rate, shown as
 * informational copy only (e.g. on the product page); the checkout screen
 * always shows the real, postcode-derived fee from the delivery-quote
 * endpoint, never this value.
 */
export interface DeliveryOption {
  id: 'collect' | 'standard' | 'next-day';
  label: string;
  detail: string;
  price: Money;
}

/**
 * POS behaviour flags (item 8). `blockBelowCost: false` = selling below the
 * combined cost price shows a clear warning but still completes; flip to
 * `true` to make it blocking — no code change needed.
 */
export const POS_CONFIG = {
  blockBelowCost: false,
} as const;

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { id: 'collect', label: 'Click & collect', detail: 'From the counter — free', price: pounds(0) },
  { id: 'standard', label: 'Standard delivery', detail: '2–3 working days', price: pounds(3.95) },
  { id: 'next-day', label: 'Next day', detail: 'Order before 2pm', price: pounds(6.95) },
];
