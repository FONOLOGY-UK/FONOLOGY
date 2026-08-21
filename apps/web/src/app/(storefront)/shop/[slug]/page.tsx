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
