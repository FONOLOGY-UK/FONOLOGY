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
  { label: 'Find us', href: '/find-us' },
];

/**
 * The shop's own Google Maps pins, keyed by shop code (F01, F02 ...), for the "Get directions"
 * buttons on Find us and in the footer.
 *
 * WHY THESE ARE HERE AND NOT IN `shop_settings`
 * Everything a customer reads about a shop (name, address, phone, hours) comes from the database,
 * and the comment at the top of this file is emphatic about keeping it that way. A map pin is the
 * one exception on purpose: it is not a shop fact the owner edits, it is a link to a third party
 * that exists once per shop and changes only if Google's short link breaks. Putting it in the
 * database would mean a migration, a new admin field and a live-data change for two URLs.
 *
 * A shop with no entry here simply gets no directions button — never a guessed map link, for the
 * same reason `lib/shop-details.ts` refuses to invent an address.
 */
export const SHOP_MAP_LINKS: Record<string, string> = {
  F01: 'https://maps.app.goo.gl/LfdtYxLSVZaR4CyR7',
  F02: 'https://maps.app.goo.gl/YjZfZP8WvdxtzYQDA',
};

/** The Google Maps pin for a shop code, or null when that shop has none. */
export function mapLinkForShop(code: string): string | null {
  return SHOP_MAP_LINKS[code] ?? null;
}

export const SOCIALS: NavItem[] = [
  { label: 'Instagram', href: 'https://www.instagram.com/fonology_mip' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@fonology' },
  { label: 'Facebook', href: 'https://www.facebook.com/share/1EuCJgXBYm/' },
  { label: 'Google Maps', href: 'https://maps.app.goo.gl/3zTDwDq4e5vFVcy99' },
];

/**
 * Legal and policy routes for the footer, in reading order. The short list the footer used to
 * carry (Privacy / Terms / Returns) is the first three; the rest are the pages the compliance
 * review (LEGAL_COMPLIANCE_CHECKLIST.md) marked as required or strongly recommended.
 */
export const LEGAL_LINKS: NavItem[] = [
  { label: 'Privacy notice', href: '/privacy' },
  { label: 'Cookie policy', href: '/cookies' },
  { label: 'Terms of sale', href: '/terms' },
  { label: 'Returns & cancellation', href: '/returns-policy' },
  { label: 'Delivery', href: '/shipping' },
  { label: 'Repair terms', href: '/repair-terms' },
  { label: 'Trade-in terms', href: '/trade-in-terms' },
  { label: 'Number plate terms', href: '/number-plate-terms' },
  { label: 'Complaints', href: '/complaints' },
  { label: 'Data complaints', href: '/data-protection-complaints' },
  { label: 'Accessibility', href: '/accessibility' },
  { label: 'Product safety & recycling', href: '/product-safety' },
  { label: 'Reviews policy', href: '/reviews-policy' },
  { label: 'Contact', href: '/contact' },
];
