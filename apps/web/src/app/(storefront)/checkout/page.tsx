import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckoutFlow } from '@/components/storefront/checkout/checkout-flow';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
};

/**
 * Full-page checkout (6.3) — replaces the prototype's modal with a real,
 * refreshable, back-button-friendly page. Guest checkout by default. No VAT
 * anywhere on the receipt (HARD RULE #3).
 */
export default function CheckoutPage() {
  return (
    <>
      <Suspense fallback={null}>
        <CheckoutFlow />
      </Suspense>
      <SlimFooter />
    </>
  );
}
