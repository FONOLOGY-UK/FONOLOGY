import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { TradeInsView } from '@/components/admin/tradeins/tradeins-view';

export const metadata: Metadata = { title: 'Payouts' };

/**
 * Round 5 Phase 2 #2 — the staff-panel equivalent of /admin/trade-ins/
 * payouts (this is what used to be mounted at /pos/trade-ins itself before
 * the queue took that slot — see the comment on that page). `compact`
 * drops the month-to-date stat tiles, same as before: employees never see
 * period totals, only this shift's ledger. A static segment, so it takes
 * priority over `[id]` and "payouts" is never mistaken for a request id —
 * same reasoning as the admin route.
 */
export default function PosTradeInPayoutsPage() {
  return (
    <RouteGuard permission="tradein.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <TradeInsView compact basePath="/pos/trade-ins" />
      </div>
    </RouteGuard>
  );
}
