import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/storefront/footer';
import { getShopDetails } from '@/lib/shop-details';
import { mapLinkForShop } from '@/lib/site';
import { addressLines, groupedHours, mailtoHref, telHref } from '@/lib/data/types';

export const metadata: Metadata = {
  title: 'Find us',
  description:
    'Both Fonology shops: where they are, when they open, and directions straight to the door.',
  alternates: { canonical: '/find-us' },
  openGraph: {
    title: 'Find us | Fonology',
    description: 'Both Fonology shops — addresses, opening hours and directions.',
    url: '/find-us',
    type: 'website',
  },
};

/**
 * Reads shop details from the API at request time. Same reason as the contact page: without this,
 * `next build` inside Docker (no API reachable) would prerender the empty fallback and serve a page
 * with no addresses on it until the first hourly revalidation.
 */
export const dynamic = 'force-dynamic';

/**
 * Find us — the page the client asked for after customers told him they could not work out where
 * the two shops are.
 *
 * Everything on it except the map links comes from the database (`shops`, via `GET /shop`), so the
 * owner changes an address, a phone number or a set of hours in Admin → Shops and this page
 * follows. Nothing here is hardcoded and nothing is invented: a shop whose hours have never been
 * filled in says so, rather than borrowing the other shop's.
 *
 * It is a separate page rather than more of `/contact` on purpose — `/contact` carries the UK
 * trading disclosures and is reached from the legal row in the footer, where a customer looking
 * for a shop door will not go. This one sits in the main nav.
 */
export default async function FindUsPage() {
  const shop = await getShopDetails();

  /**
   * Fall back to the single `shop_settings` address only if the per-shop list is empty — which
   * happens when the API is unreachable at render time, or on a one-shop setup.
   */
  const locations =
    shop.shops.length > 0
      ? shop.shops
      : shop.shopAddress
        ? [
            {
              code: '',
              name: shop.shopName,
              address: shop.shopAddress,
              phone: shop.shopPhone,
              openingHours: shop.openingHours,
            },
          ]
        : [];

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-6 py-16 pt-[calc(var(--nav-h)+2rem)]">
        <p className="text-red text-[11px] font-bold uppercase tracking-[0.18em]">Visit</p>
        <h1 className="font-display text-ink mt-2 text-4xl font-extrabold uppercase leading-none tracking-tight sm:text-5xl">
          Find us
        </h1>
        <p className="text-ink-2 mt-4 max-w-[52ch] text-sm leading-relaxed">
          {locations.length > 1
            ? 'Two shops, both doing the same work: repairs while you wait, accessories off the shelf and cash for your old handset. Tap directions and your phone will take you to the door.'
            : 'Repairs while you wait, accessories off the shelf and cash for your old handset. Tap directions and your phone will take you to the door.'}
        </p>

        {locations.length === 0 ? (
          <p className="text-ink-2 mt-10 text-sm">
            Our shop details are not loading right now. Please{' '}
            <Link href="/contact" className="underline">
              contact us
            </Link>{' '}
            and we will point you the right way.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {locations.map((location) => (
              <ShopCard key={location.name} location={location} />
            ))}
          </div>
        )}

        <p className="text-ink-2 mt-10 text-sm leading-relaxed">
          Can&apos;t get in? {shop.shopPhone ? 'Give us a ring on ' : ''}
          {shop.shopPhone ? (
            <a href={telHref(shop.shopPhone)} className="text-ink font-semibold underline">
              {shop.shopPhone}
            </a>
          ) : null}
          {shop.shopPhone && shop.shopEmail ? ', email ' : shop.shopEmail ? 'Email us at ' : ''}
          {shop.shopEmail ? (
            <a href={mailtoHref(shop.shopEmail)} className="text-ink font-semibold underline">
              {shop.shopEmail}
            </a>
          ) : null}
          {shop.shopPhone || shop.shopEmail ? ', or ' : ''}
          <Link href="/repair" className="text-ink font-semibold underline">
            book a repair online
          </Link>{' '}
          and post it in.
        </p>
      </div>
      <Footer />
    </>
  );
}

interface CardLocation {
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  openingHours: { day: string; open: string | null; close: string | null; closed: boolean }[];
}

function ShopCard({ location }: { location: CardLocation }) {
  const lines = addressLines(location.address);
  const hours = groupedHours(location.openingHours);
  const mapHref = location.code ? mapLinkForShop(location.code) : null;

  return (
    <section className="border-line-strong bg-card rounded-tile border p-6">
      <h2 className="font-display text-ink text-xl font-extrabold uppercase tracking-tight">
        {location.name}
      </h2>

      <address className="text-ink-2 mt-3 text-sm not-italic leading-relaxed">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </address>

      {location.phone ? (
        <p className="mt-3 text-sm">
          <a href={telHref(location.phone)} className="text-ink hover:text-red font-semibold">
            {location.phone}
          </a>
        </p>
      ) : null}

      <p className="text-muted mt-5 text-[11px] font-bold uppercase tracking-[0.14em]">Hours</p>
      {hours.length > 0 ? (
        <ul className="mt-2 grid gap-1">
          {hours.map((h) => (
            <li key={h.days} className="text-ink-2 flex justify-between gap-4 text-sm">
              <span>{h.days}</span>
              <span className="font-semibold">{h.time}</span>
            </li>
          ))}
        </ul>
      ) : (
        // Deliberately not the other shop's hours: a wrong closing time is a wasted journey.
        <p className="text-ink-2 mt-2 text-sm">
          Hours not listed yet — please ring the shop before setting off.
        </p>
      )}

      {mapHref ? (
        <a
          href={mapHref}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--red btn--sm mt-6"
          data-cursor
        >
          Get directions
        </a>
      ) : null}
    </section>
  );
}
