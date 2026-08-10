import type { Metadata } from 'next';
import { Hero } from '@/components/storefront/home/hero';
import { Teardown } from '@/components/storefront/home/teardown';
import { QuickQuote } from '@/components/storefront/home/quick-quote';
import { ShopStrip } from '@/components/storefront/home/shop-strip';
import { WhyStats } from '@/components/storefront/home/why-stats';
import { Manifesto } from '@/components/storefront/home/manifesto';
import { Reviews } from '@/components/storefront/home/reviews';
import { CtaBand } from '@/components/storefront/home/cta-band';
import { Footer } from '@/components/storefront/footer';
import { getShopDetails } from '@/lib/shop-details';
import { addressLines } from '@/lib/data/types';

export const metadata: Metadata = {
  title: 'Fonology — Cracked. Fixed. Same day.',
  description:
    'Fonology — the UK high-street phone repair counter. Screens, batteries and charging ports fixed same-day, plus accessories tested at our own bench.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Fonology — Cracked. Fixed. Same day.',
    description:
      'The UK high-street phone repair counter. Priced before we touch a screw, fixed while you get a coffee, warrantied in writing.',
    url: '/',
    siteName: 'Fonology',
    locale: 'en_GB',
    type: 'website',
  },
};

/**
 * LocalBusiness structured data — the copy of the shop's details that GOOGLE
 * reads, for search results and Maps.
 *
 * This was the worst of the five hardcoded copies, and the one a grep for
 * `CONTACT` missed entirely: `streetAddress` and `addressLocality` were plain
 * string literals ("Unit 4, The Parade, High Street" / "Yourtown"), so the
 * search-engine-facing address was fabricated independently of every other
 * fabricated address in the codebase.
 *
 * Built from the live settings row now, and from `openingHours` too, so the
 * hours Google publishes cannot drift from the ones on the door.
 *
 * `openingHours` uses schema.org's short day codes (Mo, Tu, ...) and 24h
 * times; a closed day is omitted rather than written as closed.
 */
const SCHEMA_DAY: Record<string, string> = {
  Mon: 'Mo',
  Tue: 'Tu',
  Wed: 'We',
  Thu: 'Th',
  Fri: 'Fr',
  Sat: 'Sa',
  Sun: 'Su',
};

export default async function HomePage() {
  const shop = await getShopDetails();
  const parts = addressLines(shop.shopAddress);
  const postcode = parts.length ? parts[parts.length - 1] : undefined;
  const locality = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const street = parts.slice(0, -2).join(', ') || undefined;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MobilePhoneStore',
    name: shop.shopName,
    description: 'UK high-street phone repair and accessories shop.',
    url: 'https://fonology.co.uk',
    ...(shop.shopPhone ? { telephone: shop.shopPhone } : {}),
    ...(shop.shopEmail ? { email: shop.shopEmail } : {}),
    address: {
      '@type': 'PostalAddress',
      ...(street ? { streetAddress: street } : {}),
      ...(locality ? { addressLocality: locality } : {}),
      ...(postcode ? { postalCode: postcode } : {}),
      addressCountry: 'GB',
    },
    openingHours: shop.openingHours
      .filter((h) => !h.closed && h.open && h.close)
      .map((h) => `${SCHEMA_DAY[h.day] ?? h.day} ${h.open}-${h.close}`),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero />
      <Teardown />
      <QuickQuote />
      <ShopStrip />
      <WhyStats />
      <Manifesto />
      <Reviews />
      <CtaBand
        lines={['In by 4pm.', <em key="e">Out the same day.</em>]}
        sub="Book a slot, walk in, walk out fixed. Or just turn up — the kettle’s on."
        buttonLabel="Start a repair"
        buttonHref="/repair"
        showTel
      />
      <Footer />
    </>
  );
}
