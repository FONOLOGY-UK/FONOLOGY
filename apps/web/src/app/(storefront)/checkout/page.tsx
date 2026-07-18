import type { Metadata } from 'next';
import { ScaffoldNotice } from '@/components/shared/scaffold-notice';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
};

/**
 * Checkout — NEW as a full page (the prototype had a modal). Built in Phase 2.
 * No VAT anywhere on the receipt (HARD RULE #3).
 */
export default function CheckoutPage() {
  return (
    <ScaffoldNotice
      surface="Storefront"
      title="Checkout"
      phase="Phase 2 — new full-page checkout"
    />
  );
}
