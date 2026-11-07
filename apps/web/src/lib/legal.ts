/**
 * Facts shared by the legal pages, the footer and the form notices, as the owner supplied them.
 *
 * The shop's address, phone, email, opening hours, return window and ID-document retention come
 * from `shop_settings` through `GET /shop` (lib/shop-details.ts) — never copied here.
 */

/** One date for every legal page, so a change to any of them is a change to this line. */
export const LEGAL_UPDATED = '7 November 2026';

/** The company behind the Fonology name, as registered at Companies House. */
export const LEGAL_TRADER_NAME = 'Zakaso LTD';
export const LEGAL_COMPANY_NUMBER = 'SC719377';
export const LEGAL_REGISTERED_IN = 'Scotland';
export const LEGAL_REGISTERED_OFFICE = '61c Main Street, Thornliebank, G46 7RX';

/** The ICO's own address for complaints about how personal information is handled. */
export const ICO_COMPLAINTS_URL = 'https://ico.org.uk/make-a-complaint/';
