import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';
import { getShopDetails } from '@/lib/shop-details';

export const metadata: Metadata = { title: 'Returns & warranty' };

/**
 * Server Component, so the returns window comes from the cached `/shop` fetch
 * rather than a hook. It used to print a hardcoded 30 — on the page whose
 * entire job is stating the shop's returns policy correctly.
 */
export default async function ReturnsPolicyPage() {
  const shop = await getShopDetails();
  return (
    <ContentPlaceholder
      eyebrow="Legal"
      title="Returns & warranty"
      note={`The shop operates a ${shop.returnWindowDays}-day returns window; the full policy wording comes from the client.`}
    />
  );
}
