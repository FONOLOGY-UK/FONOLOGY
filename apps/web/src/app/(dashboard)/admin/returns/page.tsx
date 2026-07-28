import type { Metadata } from 'next';
import { ReturnsView } from '@/components/admin/returns/returns-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Returns' };

/** Returns & refunds (item 7). */
export default function AdminReturnsPage() {
  return (
    <RouteGuard permission="returns.manage">
      <ReturnsView />
    </RouteGuard>
  );
}
