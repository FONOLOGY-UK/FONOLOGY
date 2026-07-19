import type { Metadata } from 'next';
import { CartView } from '@/components/storefront/cart/cart-view';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Your bag',
  robots: { index: false },
};

/** Cart page — the prototype uses a slide-out drawer; this full page mirrors it. */
export default function CartPage() {
  return (
    <>
      <CartView />
      <SlimFooter />
    </>
  );
}
