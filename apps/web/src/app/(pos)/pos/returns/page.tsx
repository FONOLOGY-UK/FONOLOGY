import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { ReturnsView } from '@/components/admin/returns/returns-view';

export const metadata: Metadata = { title: 'Returns' };

/** On the counter, the same module as admin. */
export default function PosReturnsPage() {
  return (
    <RouteGuard permission="returns.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <ReturnsView />
      </div>
    </RouteGuard>
  );
}
