/**
 * Storefront site constants — nav, contact, hours. Contact details are copied
 * VERBATIM from the prototype and are pending client confirmation (see
 * CONTENT-TODO.md). "Sell" is the new fourth nav item added in Phase 2 (6.6).
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

export const CONTACT = {
  phone: '01234 567 890',
  phoneHref: 'tel:01234567890',
  email: 'hello@fonology.co.uk',
  emailHref: 'mailto:hello@fonology.co.uk',
  addressLines: ['Unit 4, The Parade', 'High Street, Yourtown', 'YT1 2AB, United Kingdom'],
  addressShort: 'Unit 4, The Parade, High Street',
  postcode: 'YT1 2AB',
} as const;

export const HOURS = [
  { day: 'Mon–Fri', time: '9:00–18:00' },
  { day: 'Saturday', time: '9:30–17:00' },
  { day: 'Sunday', time: 'closed (we sleep)' },
] as const;

/** Menu overlay short lines (from the prototype). */
export const MENU_META = {
  addressLines: ['Unit 4, The Parade, High Street', 'Yourtown YT1 2AB'],
  hoursLine: 'Mon–Sat 9:00–18:00',
} as const;

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
