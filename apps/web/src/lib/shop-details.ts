import 'server-only';
import { shopDetailsSchema, type ShopDetails } from '@/lib/data/types';

/**
 * Shop details for SERVER Components.
 *
 * The storefront is server-rendered for SEO, so the homepage JSON-LD, the
 * contact page and the legal pages cannot use a React hook. They use this.
 *
 * WHY A CACHED FETCH RATHER THAN A PER-RENDER ONE
 * These values change perhaps twice a year. Fetching them on every render
 * would put a network round trip in front of every storefront page load for
 * data that is effectively static — a bad trade, and the reason I pushed back
 * on doing this at all before the endpoint existed. `next.revalidate` makes it
 * one request an hour across ALL renders instead of one per render, which is
 * a cache decision rather than an architectural one.
 *
 * FALLBACK BEHAVIOUR IS DELIBERATE AND NARROW
 * If the API is unreachable the page still renders, with the shop's name and
 * nothing invented. It does NOT fall back to a hardcoded address or phone
 * number: the entire point of this change is that there is exactly one place
 * those live. A missing phone number is a page that looks incomplete; a
 * plausible wrong one is a customer ringing a stranger.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** One hour. These change about twice a year; this is already generous. */
const REVALIDATE_SECONDS = 3600;

const FALLBACK: ShopDetails = {
  shopName: 'Fonology',
  shopAddress: null,
  shopPhone: null,
  shopEmail: null,
  openingHours: [],
  returnWindowDays: 30,
  nextDayCutoffTime: null,
  idDocumentRetentionDays: 30,
  receiptHeaderText: null,
  receiptFooterText: null,
};

export async function getShopDetails(): Promise<ShopDetails> {
  if (!API_BASE) return FALLBACK;
  try {
    const res = await fetch(`${API_BASE}/shop`, {
      next: { revalidate: REVALIDATE_SECONDS, tags: ['shop-details'] },
    });
    if (!res.ok) return FALLBACK;
    return shopDetailsSchema.parse(await res.json());
  } catch {
    // Never let a shop-details fetch take a storefront page down with it.
    return FALLBACK;
  }
}
