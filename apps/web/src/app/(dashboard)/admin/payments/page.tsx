import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PaymentsView } from '@/components/admin/payments/payments-view';

export const metadata: Metadata = { title: 'Payments' };

/** Payments ledger + payment methods report (item 7). */
export default function AdminPaymentsPage() {
  return (
    <Suspense>
      <PaymentsView />
    </Suspense>
  );
}
