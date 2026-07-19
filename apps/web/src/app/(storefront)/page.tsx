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
import { CONTACT, HOURS } from '@/lib/site';

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

/** LocalBusiness structured data (SEO). Details pending client confirmation. */
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'MobilePhoneStore',
  name: 'Fonology',
  description: 'UK high-street phone repair and accessories shop.',
  url: 'https://fonology.co.uk',
  telephone: CONTACT.phone,
  email: CONTACT.email,
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Unit 4, The Parade, High Street',
    addressLocality: 'Yourtown',
    postalCode: CONTACT.postcode,
    addressCountry: 'GB',
  },
  openingHours: HOURS.filter((h) => !h.time.includes('closed')).map((h) => `${h.day} ${h.time}`),
};

export default function HomePage() {
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
      <CtaBand />
      <Footer />
    </>
  );
}
