import type { Metadata } from 'next';
import { SellAccept } from '@/components/storefront/sell/sell-accept';

export const metadata: Metadata = {
  title: 'Accept our offer',
  // A one-time token sits in this URL. Keep it out of search indexes and out of
  // the referrer sent to any third party the page might link to.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * The customer-facing end of the acceptance link.
 *
 * The token is read HERE, on the server, and passed down — not with
 * `useSearchParams()`, which suspends the component out of prerendering and can
 * leave the page permanently blank. On a page a customer reaches from a text
 * message, blank is indistinguishable from broken.
 */
export default async function SellAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <SellAccept token={token?.trim() || null} />;
}
