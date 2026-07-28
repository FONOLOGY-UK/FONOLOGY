import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PaymentsView } from '@/components/admin/payments/payments-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Payments' };

/** Payments ledger + payment methods report (item 7). */
export default function AdminPaymentsPage() {
  return (
    <RouteGuard permission="payments.view">
      <Suspense>
        <PaymentsView />
      </Suspense>
    </RouteGuard>
  );
}
