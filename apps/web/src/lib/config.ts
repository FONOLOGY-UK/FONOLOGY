/**
 * Storefront business config — single source for client-confirmable values.
 * These are placeholders reproduced/derived from the prototype + PRD and are
 * PENDING CLIENT CONFIRMATION. No promotion
 * engine sits behind any promo copy (6.7).
 */

/**
 * UK-only delivery SPEEDS (6.3) — the customer's real choice. "Remote" is
 * deliberately not here: it isn't a speed the customer picks, it's a fact
 * about their postcode the server derives (see delivery_quote() /
 * 0021_delivery_quote.sql). Labels only — no prices: those are rows the owner edits
 * (admin Delivery, 0102), read from GET /shop for 'from £x' copy and from the
 * delivery-quote endpoint for the real, postcode-derived fee.
 */
export interface DeliveryOption {
  id: 'collect' | 'standard' | 'next-day';
  label: string;
  detail: string;
}

/*
 * `POS_CONFIG.blockBelowCost` used to live here.
 *
 * Removed: migration 0008 states that below-cost sales NEVER block — "that's
 * fixed, not configurable" — and `below_cost_reason` is always optional in the
 * schema. A flag that could be flipped to `true` was a trap: it would have
 * contradicted a client-confirmed rule the database itself documents, and
 * whoever flipped it would have had no idea. The warning behaviour is
 * unchanged; only the switch is gone.
 */

export const DELIVERY_OPTIONS: DeliveryOption[] = [
  { id: 'collect', label: 'Click & collect', detail: 'From the counter — free' },
  { id: 'standard', label: 'Standard delivery', detail: '2–3 working days' },
  { id: 'next-day', label: 'Next day', detail: 'Next working day · mainland UK only' },
];
