import type { Metadata } from 'next';
import { Fragment, Suspense } from 'react';
import { ShopCatalog } from '@/components/storefront/shop/shop-catalog';
import { PromiseStrip } from '@/components/storefront/promise-strip';
import { CtaBand } from '@/components/storefront/home/cta-band';
import { Footer } from '@/components/storefront/footer';
import { getShopDetails } from '@/lib/shop-details';

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

export default async function ShopPage() {
  // Cached hourly by getShopDetails, so this does not put a round trip in front
  // of /shop — it reuses the same fetch the rest of the storefront shares.
  const shop = await getShopDetails();
  return (
    <>
      {/* No hero block: the grid (filters + products) is the first thing on
          /shop, matching standard e-commerce convention. */}
      <Suspense fallback={null}>
        <ShopCatalog />
      </Suspense>
      <PromiseStrip returnWindowDays={shop.returnWindowDays} />
      <CtaBand
        lines={[
          'Phone needs fixing',
          // Keyed Fragment: the array element itself needs the key, not its child.
          <Fragment key="l2">
            <em>before</em> the new case?
          </Fragment>,
        ]}
        sub="Book the repair first — accessories are 10% off with any same-day fix."
        buttonLabel="Start a repair"
        buttonHref="/repair"
      />
      <Footer />
    </>
  );
}
