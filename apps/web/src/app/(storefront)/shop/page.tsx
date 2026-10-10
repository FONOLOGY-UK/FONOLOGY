import type { Metadata } from 'next';
import { Fragment } from 'react';
import { ShopCatalog } from '@/components/storefront/shop/shop-catalog';
import { PromiseStrip } from '@/components/storefront/promise-strip';
import { CtaBand } from '@/components/storefront/home/cta-band';
import { Footer } from '@/components/storefront/footer';
import { getShopDetails } from '@/lib/shop-details';
import { dataAdapter } from '@/lib/data/adapters';

export const metadata: Metadata = {
  title: 'Shop',
  description:
    'Cases, chargers, cables and audio — every product tested at the Fonology repair bench before it earns shelf space.',
  alternates: { canonical: '/shop' },
  openGraph: {
    title: 'Shop | Fonology',
    description: 'Good kit only — every product bench-tested before it earns shelf space.',
    url: '/shop',
    type: 'website',
  },
};

/**
 * Rendered per request, like the product page: the grid shows live stock and what is and is not
 * purchasable, so it must not be frozen at build time (and `next build` must not need the API).
 * See the comment on `revalidate` in shop/[slug]/page.tsx.
 */
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ShopPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const initialSearch = (q ?? '').trim();
  // Shop details are cached hourly by getShopDetails; the catalogue and categories are fetched
  // here so the first HTML already contains the grid.
  const [shop, products, categories] = await Promise.all([
    getShopDetails(),
    dataAdapter.listProducts({ search: initialSearch || undefined }),
    dataAdapter.listCategories(),
  ]);
  return (
    <>
      {/* No hero block: the grid (filters + products) is the first thing on
          /shop, matching standard e-commerce convention. */}
      {/* No Suspense boundary: this page is rendered per request with the data already in hand, and a
          boundary here streamed the grid in AFTER the first paint — the strips below it painted at
          the top and were then pushed down (a layout shift of 1). */}
      <ShopCatalog
        initialProducts={products}
        initialCategories={categories}
        initialSearch={initialSearch}
      />
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
