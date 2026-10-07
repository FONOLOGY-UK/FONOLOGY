import type { Metadata } from 'next';
import { GoodsInLogView } from '@/components/admin/inventory-logs/goods-in-log-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Goods in' };

/** Log A — deliveries booked in on the tills (0103). Owners and managers (reports.view). */
export default function AdminGoodsInPage() {
  return (
    <RouteGuard permission="reports.view">
      <GoodsInLogView />
    </RouteGuard>
  );
}
