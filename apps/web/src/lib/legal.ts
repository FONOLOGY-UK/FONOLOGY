/**
 * Facts shared by the legal pages, the footer and the form notices.
 *
 * Anything the owner still has to supply is NOT stored here as a value: the pages render it with
 * `<Ph name="…" />` (components/storefront/legal-bits.tsx), which prints a highlighted
 * `[[NAME]]` so it cannot be published unnoticed. Search the codebase for `<Ph` to list them all.
 *
 * The shop's address, phone, email, opening hours, return window and ID-document retention come
 * from `shop_settings` through `GET /shop` (lib/shop-details.ts) — never copied here.
 */

/** One date for every legal page, so a change to any of them is a change to this line. */
export const LEGAL_UPDATED = '12 October 2026';

/**
 * The trading company, as the footer has always shown it. The exact registered name must match
 * Companies House — see the COMPANY_NUMBER placeholder next to it.
 */
export const LEGAL_TRADER_NAME = 'Fonology Ltd';

/** The ICO's own address for complaints about how personal information is handled. */
export const ICO_COMPLAINTS_URL = 'https://ico.org.uk/make-a-complaint/';
