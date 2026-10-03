import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { PosView } from '@/components/pos/pos-view';

export const metadata: Metadata = { title: 'Checkout' };

/**
 * POS checkout — the counter till (item 8).
 *
 * `?job=<id>` (and optionally `&amount=<pence>`) opens it with a repair's payment on the ticket:
 * every payment, for a repair or a sale, is taken here. Read on the server and passed down, like
 * the inventory page's filter, so nothing suspends.
 */
export default async function PosCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; amount?: string }>;
}) {
  const { job, amount } = await searchParams;
  const pence = amount ? Number.parseInt(amount, 10) : undefined;
  return (
    <RouteGuard permission="pos.operate">
      <PosView
        jobId={job && /^[0-9a-f-]{36}$/i.test(job) ? job : undefined}
        jobAmount={pence && pence > 0 ? pence : undefined}
      />
    </RouteGuard>
  );
}
