import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dataAdapter } from '@/lib/data/adapters';
import { isPurchasable } from '@/lib/data/types';
import { ProductDetail } from '@/components/storefront/shop/product-detail';
import { Footer } from '@/components/storefront/footer';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Pre-render a static page per product. */
export async function generateStaticParams() {
  const products = await dataAdapter.listProducts();
  return products.map((p) => ({ slug: p.slug }));
}

/**
 * Fixed catalogue → any slug not produced by generateStaticParams is a real
 * 404 (correct status, no soft-404). When Raja moves to the http adapter with a
 * dynamically-growing catalogue, set this to `true` and rely on notFound().
 */
export const dynamicParams = false;

/**
 * Client-reported bug fix — the actual story, not the first two attempts:
 *
 * This page originally had no `revalidate` export at all, so it was built
 * once and served forever; a category move in admin (which flips
 * purchasability via the DB's `products_derive_kind` trigger, instantly)
 * never showed up here short of a full rebuild. The fix is on-demand
 * revalidation: the admin product-update endpoint calls
 * `/api-internal/revalidate-product` (see that route, and
 * apps/api/src/lib/revalidate.ts), which calls `revalidatePath`.
 *
 * Two targeted attempts at making that actually take effect in THIS
 * deployment (standalone-output Docker on Render) did not work, verified
 * live each time, not assumed: giving the page a real numeric `revalidate`
 * value (so it's a genuinely-cached, revalidatable ISR entry rather than
 * immutable static output), and separately ensuring `.next/cache` exists
 * and is writable in the runner image (`output: 'standalone'` excludes it
 * from its trace by design). Both deployed, both re-tested with a real
 * category move + `revalidatePath` call + immediate and delayed re-checks
 * against the live product page — still `x-nextjs-cache: HIT`, still
 * serving the pre-change content, every time. Whatever is actually wrong
 * with on-demand revalidation's persistence in this specific setup is
 * deeper than either of those two well-documented gotchas, and chasing it
 * further wasn't defensible against a check this task explicitly called
 * out as legally load-bearing.
 *
 * `revalidate = 0`: the page is rendered fresh on every request instead —
 * no cache to fail to invalidate, so nothing left for this bug to hide in.
 * The `/api-internal/revalidate-product` plumbing (previous two commits)
 * is left in place rather than ripped out: it's a harmless no-op against an
 * always-fresh page today, and turns into a real optimisation for free if
 * a later pass ever figures out why on-demand revalidation wasn't
 * persisting here and this page moves back to a cached `revalidate` value.
 * `generateStaticParams`/`dynamicParams = false` stay — they're about which
 * slugs 404, not about caching, and still narrow the catalogue correctly.
 *
 * Real cost, flagging rather than hiding it: every `/shop/[slug]` view now
 * calls the live API (product + full category list + full product list for
 * "related") instead of serving pre-built HTML. Fine at this catalogue's
 * current size; worth another look if the catalogue grows enough for that
 * to show up as real latency.
 */
export const revalidate = 0;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await dataAdapter.getProductBySlug(slug);
  if (!product) return { title: 'Product not found', robots: { index: false } };
  return {
    title: product.name,
    description: product.description,
    alternates: { canonical: `/shop/${product.slug}` },
    openGraph: {
      title: `${product.name} | Fonology`,
      description: product.description,
      url: `/shop/${product.slug}`,
      type: 'website',
    },
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await dataAdapter.getProductBySlug(slug);
  if (!product) notFound();

  const [categories, all] = await Promise.all([
    dataAdapter.listCategories(),
    dataAdapter.listProducts(),
  ]);
  const categoryLabel = categories.find((c) => c.id === product.category)?.label ?? 'Shop';
  const related = all
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 6);

  // Product structured data (SEO). NO VAT (HARD RULE #3) — price is the price.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.id,
    category: categoryLabel,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'GBP',
      price: (product.price / 100).toFixed(2),
      availability: !isPurchasable(product)
        ? 'https://schema.org/InStoreOnly'
        : product.stockStatus === 'in-stock'
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ProductDetail product={product} categoryLabel={categoryLabel} related={related} />
      <Footer />
    </>
  );
}
