import type { MetadataRoute } from 'next';
import { dataAdapter } from '@/lib/data/adapters';

// Built per request, never at build time: `next build` must not need the API (see shop/[slug]/page.tsx).
export const dynamic = 'force-dynamic';

const BASE = 'https://fonology.co.uk';
const PAGES = [
  '',
  '/shop',
  '/repair',
  '/sell',
  '/track',
  '/about',
  '/faq',
  '/contact',
  '/privacy',
  '/terms',
  '/cookies',
  '/returns-policy',
  '/shipping',
  '/repair-terms',
  '/trade-in-terms',
  '/number-plate-terms',
  '/complaints',
  '/data-protection-complaints',
  '/accessibility',
  '/product-safety',
  '/reviews-policy',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let products: Awaited<ReturnType<typeof dataAdapter.listProducts>> = [];
  try {
    products = await dataAdapter.listProducts({});
  } catch {
    // The static pages are still worth listing if the API is briefly down.
  }
  return [
    ...PAGES.map((path) => ({ url: BASE + path })),
    ...products.map((p) => ({ url: `${BASE}/shop/${p.slug}` })),
  ];
}
