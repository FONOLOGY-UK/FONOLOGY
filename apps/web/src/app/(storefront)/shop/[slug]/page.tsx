import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dataAdapter } from '@/lib/data/adapters';
import { isPurchasable } from '@/lib/data/types';
import { ProductDetail } from '@/components/storefront/shop/product-detail';
import { Footer } from '@/components/storefront/footer';
import { safeJsonLd } from '@/lib/json-ld';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * No `generateStaticParams` and no `dynamicParams = false`, on purpose.
 *
 * Both used to be here. With `revalidate = 0` (below) neither did anything:
 * nothing is pre-rendered, and an unknown slug is already a real 404 via
 * `notFound()` in the page itself — verified on staging, where a product
 * created after the build served 200 and a vape (hidden by the storefront
 * lock) served 404. What `generateStaticParams` DID do was call the API
 * during `next build`, so a push that redeployed web and api together failed
 * the web build whenever the API was mid-restart. Don't add it back unless
 * this page goes back to a cached `revalidate` value.
 */

/** Description HTML to plain text for meta tags — the stored description is rich text, not a sentence. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rendered fresh on every request, deliberately: whether a product can be bought online (`isPurchasable`,
 * driven by `product.kind`) must match the database the instant an admin moves it in or out of the vape
 * category — vapes are legally not orderable online. Cached HTML (static or ISR) could show stale
 * "in-store only" messaging. On-demand revalidation (`revalidatePath`) was tried and did not persist in
 * this deployment (standalone Docker output), so it was removed rather than left as a no-op.
 *
 * Cost: every view calls the live API. Fine at the current catalogue size; if it ever shows up as real
 * latency, move to a short time-based `revalidate` — but only after confirming on a deployment that a
 * real category move shows up within that window.
 */
export const revalidate = 0;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await dataAdapter.getProductBySlug(slug);
  if (!product) return { title: 'Product not found', robots: { index: false } };
  return {
    title: product.name,
    description: plainText(product.description),
    alternates: { canonical: `/shop/${product.slug}` },
    openGraph: {
      title: `${product.name} | Fonology`,
      description: plainText(product.description),
      url: `/shop/${product.slug}`,
      type: 'website',
    },
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await dataAdapter.getProductBySlug(slug);
  if (!product) notFound();

  // Related = the same category only, filtered by the API rather than fetching the whole
  // catalogue and filtering it here.
  const [categories, sameCategory] = await Promise.all([
    dataAdapter.listCategories(),
    dataAdapter.listProducts({ category: product.category }),
  ]);
  const categoryLabel = categories.find((c) => c.id === product.category)?.label ?? 'Shop';
  const related = sameCategory.filter((p) => p.id !== product.id).slice(0, 6);

  // Product structured data (SEO). NO VAT (HARD RULE #3) — price is the price.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: plainText(product.description),
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <ProductDetail product={product} categoryLabel={categoryLabel} related={related} />
      <Footer />
    </>
  );
}
