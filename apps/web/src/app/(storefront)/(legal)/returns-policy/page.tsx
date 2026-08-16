import type { Metadata } from 'next';
import { ContentPlaceholder } from '@/components/storefront/content-placeholder';
import { getShopDetails } from '@/lib/shop-details';

export const metadata: Metadata = { title: 'Returns & warranty' };

/**
 * Server Component, so the returns window comes from the cached `/shop` fetch
 * rather than a hook. It used to print a hardcoded 30 — on the page whose
 * entire job is stating the shop's returns policy correctly.
 *
 * If the fetch failed the window is null, and this page states no number at
 * all. On the returns policy page specifically, a confidently wrong number is
 * the worst possible output: it is the page a customer would screenshot.
 */
export default async function ReturnsPolicyPage() {
  const shop = await getShopDetails();
  return (
    <ContentPlaceholder
      eyebrow="Legal"
      title="Returns & warranty"
      note={
        shop.returnWindowDays != null
          ? `The shop operates a ${shop.returnWindowDays}-day returns window; the full policy wording comes from the client.`
          : 'The full policy wording comes from the client.'
      }
    />
  );
}
