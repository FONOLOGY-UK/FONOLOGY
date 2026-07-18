import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';
import { dataAdapter } from '@/lib/data/adapters';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Product detail page (PDP) — NEW, must be built (Phase 2). SEO metadata is
 * derived server-side from the product so it's ready for search from day one.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await dataAdapter.getProductBySlug(slug);
  if (!product) return { title: 'Product not found' };
  return {
    title: product.name,
    description: product.description,
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;
  return (
    <ScaffoldNotice
      surface="Storefront"
      title="Product detail"
      phase="Phase 2 — new storefront page"
    >
      <p className="text-muted text-sm">
        Slug: <code className="bg-paper-2 text-ink rounded px-1.5 py-0.5">{slug}</code>
      </p>
    </ScaffoldNotice>
  );
}
