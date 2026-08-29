import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { TradeInQueueView } from '@/components/admin/tradeins/tradein-queue-view';
import { sellStatusSchema, type SellStatus } from '@/lib/data/types';

export const metadata: Metadata = { title: 'Sell In Requests' };

/**
 * Round 5 Phase 2 #2 — the staff-panel equivalent of /admin/trade-ins.
 *
 * This used to render TradeInsView (the payout ledger) directly, with its
 * own "Sell requests" button hardcoded to /admin/trade-ins — so the one
 * thing the "Sell In Requests" nav tab is named for sent counter staff
 * straight into the admin panel. This route now mirrors the admin
 * structure exactly: the queue lives here, the payout ledger moves to
 * /pos/trade-ins/payouts (its own new route, same as /admin/trade-ins/
 * payouts), and a detail page lives at /pos/trade-ins/[id]. Same
 * `tradein.manage` gate throughout — nothing here is a new permission,
 * just a new place for staff to reach what they already could act on from
 * the payout screen's "Website request" links.
 */
export default async function PosTradeInsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}) {
  const params = await searchParams;

  const status = (params.status ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s): s is SellStatus => sellStatusSchema.safeParse(s).success);

  const page = Number.parseInt(params.page ?? '1', 10);

  return (
    <RouteGuard permission="tradein.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <TradeInQueueView
          status={status.length ? status : undefined}
          search={params.search?.trim() || undefined}
          page={Number.isFinite(page) && page > 0 ? page : 1}
          basePath="/pos/trade-ins"
        />
      </div>
    </RouteGuard>
  );
}
