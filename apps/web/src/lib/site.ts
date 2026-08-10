/**
 * Storefront site constants — navigation and link lists ONLY.
 *
 * THE SHOP'S CONTACT DETAILS ARE NOT HERE ANY MORE, AND MUST NOT COME BACK.
 *
 * This file used to hold `CONTACT` (phone, email, address, postcode), `HOURS`
 * and `MENU_META.addressLines` — placeholder values carried over from the
 * design prototype: "01234 567 890", "Unit 4, The Parade, High Street,
 * Yourtown YT1 2AB". Five independent copies of that fiction existed across
 * the codebase, including the schema.org JSON-LD Google reads and the API's
 * default email sender, and none of them was the `shop_settings` row that
 * migration 0009 says every screen, receipt and policy page must read.
 *
 * They now come from `GET /shop`:
 *   Server Components  →  `lib/shop-details.ts` (cached, 1h revalidate)
 *   Client Components  →  `useShopDetails()`
 *
 * If you are about to add a phone number or an address to this file: don't.
 * Add it to `shop_settings` and read it, so the owner can change it and so
 * there is one answer rather than six.
 */

export interface NavItem {
  label: string;
  href: string;
}

/** Primary nav — header, mobile overlay menu, and footer all use this order. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Shop', href: '/shop' },
  { label: 'Repair', href: '/repair' },
  { label: 'Sell', href: '/sell' },
];

export const SOCIALS: NavItem[] = [
  { label: 'Instagram', href: '#' },
  { label: 'TikTok', href: '#' },
  { label: 'Google', href: '#' },
];

/** Legal routes for the footer (Phase 6 placeholder pages). */
export const LEGAL_LINKS: NavItem[] = [
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'Returns', href: '/returns' },
];
