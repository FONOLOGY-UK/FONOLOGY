import type { Metadata } from 'next';
import { TradeInDetailView } from '@/components/admin/tradeins/tradein-detail-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Trade-in' };

/** One trade-in request: condition, quote, status, payout and restock. */
export default async function AdminTradeInDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard permission="tradein.manage">
      <TradeInDetailView id={id} />
    </RouteGuard>
  );
}
