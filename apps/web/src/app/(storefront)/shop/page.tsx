import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ShopHero } from '@/components/storefront/shop/shop-hero';
import { ShopCatalog } from '@/components/storefront/shop/shop-catalog';
import { PromiseStrip } from '@/components/storefront/promise-strip';
import { CtaBand } from '@/components/storefront/home/cta-band';
import { Footer } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Shop',
  description:
    'Cases, chargers, cables and audio — every product tested at the Fonology repair bench before it earns shelf space.',
  alternates: { canonical: '/shop' },
  openGraph: {
    title: 'Shop — Fonology',
    description: 'Good kit only — every product bench-tested before it earns shelf space.',
    url: '/shop',
    type: 'website',
  },
};

export default function ShopPage() {
  return (
    <>
      <ShopHero />
      <Suspense fallback={null}>
        <ShopCatalog />
      </Suspense>
      <PromiseStrip />
      <CtaBand
        lines={[
          'Phone needs fixing',
          <>
            <em key="e">before</em> the new case?
          </>,
        ]}
        sub="Book the repair first — accessories are 10% off with any same-day fix."
        buttonLabel="Start a repair"
        buttonHref="/repair"
      />
      <Footer />
    </>
  );
}
