import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { CashView } from '@/components/admin/cash/cash-view';

export const metadata: Metadata = { title: 'Cash drawer' };

/** Float & petty cash on the counter — same module as admin. */
export default function PosCashPage() {
  return (
    <RouteGuard permission="cash.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <CashView />
      </div>
    </RouteGuard>
  );
}
