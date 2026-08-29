import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { TradeInDetailView } from '@/components/admin/tradeins/tradein-detail-view';

export const metadata: Metadata = { title: 'Trade-in' };

/**
 * Round 5 Phase 2 #2 — the staff-panel equivalent of
 * /admin/trade-ins/[id]. Same detail view (condition, quote, status,
 * payout, restock — all already `tradein.manage`-scoped, no admin-only
 * figures), gated the same way, `basePath` keeping every link on this
 * screen inside /pos.
 */
export default async function PosTradeInDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard permission="tradein.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <TradeInDetailView id={id} basePath="/pos/trade-ins" />
      </div>
    </RouteGuard>
  );
}
