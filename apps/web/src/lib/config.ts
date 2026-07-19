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
 * UK-only delivery options (6.3). Placeholder rates — client-confirmable.
 * `id` is stable for the backend; `price` is pence.
 */
export interface DeliveryOption {
  id: 'collect' | 'standard' | 'next-day' | 'remote';
  label: string;
  detail: string;
  price: Money;
}

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { id: 'collect', label: 'Click & collect', detail: 'From the counter — free', price: pounds(0) },
  { id: 'standard', label: 'Standard delivery', detail: '2–3 working days', price: pounds(3.95) },
  { id: 'next-day', label: 'Next day', detail: 'Order before 2pm', price: pounds(6.95) },
  {
    id: 'remote',
    label: 'Remote areas',
    detail: 'NI, Scottish Highlands & islands',
    price: pounds(9.95),
  },
];
