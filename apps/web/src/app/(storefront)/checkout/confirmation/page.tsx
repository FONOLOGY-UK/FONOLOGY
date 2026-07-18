import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false },
};

/** Order confirmation / receipt. Built in Phase 2. */
export default function CheckoutConfirmationPage() {
  return (
    <ScaffoldNotice
      surface="Storefront"
      title="Order confirmed"
      phase="Phase 2 — storefront reproduction"
    />
  );
}
