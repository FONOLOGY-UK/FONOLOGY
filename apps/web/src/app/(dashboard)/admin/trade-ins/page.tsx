import type { Metadata } from 'next';
import { TradeInQueueView } from '@/components/admin/tradeins/tradein-queue-view';
import { RouteGuard } from '@/components/pos/route-guard';
import { sellStatusSchema, type SellStatus } from '@/lib/data/types';

export const metadata: Metadata = { title: 'Trade-ins' };

/**
 * The trade-in queue.
 *
 * Filters are read HERE, on the server, and handed down as props. Reading them
 * in the client component with `useSearchParams()` would suspend it out of
 * prerendering and — on a route like this — never resume, leaving the screen on
 * skeletons with its query never registering. That bug cost a whole debugging
 * pass on /admin/inventory; this page is built the safe way from the start.
 */
export default async function AdminTradeInsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}) {
  const params = await searchParams;

  // An unknown status in a hand-edited URL is dropped rather than passed on to
  // the API, which would answer 400 and leave the screen looking broken.
  const status = (params.status ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s): s is SellStatus => sellStatusSchema.safeParse(s).success);

  const page = Number.parseInt(params.page ?? '1', 10);

  return (
    <RouteGuard permission="tradein.manage">
      <TradeInQueueView
        status={status.length ? status : undefined}
        search={params.search?.trim() || undefined}
        page={Number.isFinite(page) && page > 0 ? page : 1}
      />
    </RouteGuard>
  );
}
