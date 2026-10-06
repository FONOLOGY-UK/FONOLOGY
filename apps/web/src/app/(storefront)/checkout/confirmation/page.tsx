import type { Metadata } from 'next';
import { ConfirmationView } from '@/components/storefront/checkout/confirmation-view';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false },
};

interface PageProps {
  // `intent` from our own checkout; `payment_intent` is what Stripe appends after a redirect.
  searchParams: Promise<{ ref?: string; intent?: string; payment_intent?: string }>;
}

export default async function CheckoutConfirmationPage({ searchParams }: PageProps) {
  const { ref, intent, payment_intent } = await searchParams;
  return (
    <>
      <ConfirmationView reference={ref ?? null} intentId={intent ?? payment_intent ?? null} />
      <SlimFooter />
    </>
  );
}
