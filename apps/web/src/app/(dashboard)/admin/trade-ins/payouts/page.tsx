import type { Metadata } from 'next';
import { TradeInsView } from '@/components/admin/tradeins/tradeins-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Payouts' };

/**
 * The payout ledger. A static segment, so it takes priority over `[id]` and
 * "payouts" is never mistaken for a request id.
 */
export default function AdminTradeInPayoutsPage() {
  return (
    <RouteGuard permission="tradein.manage">
      <TradeInsView />
    </RouteGuard>
  );
}
