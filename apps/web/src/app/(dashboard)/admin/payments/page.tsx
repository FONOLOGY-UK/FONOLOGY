import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageLoading } from '@/components/admin/page-loading';
import { PaymentsView } from '@/components/admin/payments/payments-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Payments' };

/** Payments ledger + payment methods report (item 7). */
export default function AdminPaymentsPage() {
  return (
    <RouteGuard permission="payments.view">
      <Suspense fallback={<PageLoading />}>
        <PaymentsView />
      </Suspense>
    </RouteGuard>
  );
}
