import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { TradeInsView } from '@/components/admin/tradeins/tradeins-view';

export const metadata: Metadata = { title: 'Trade-ins' };

/**
 * Buy-ins at the counter — same module as admin, minus the month-to-date
 * figure (employees never see period totals; `compact` drops those tiles).
 */
export default function PosTradeInsPage() {
  return (
    <RouteGuard permission="tradein.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <TradeInsView compact />
      </div>
    </RouteGuard>
  );
}
