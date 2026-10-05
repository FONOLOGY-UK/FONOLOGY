import type { Metadata } from 'next';
import { ConfirmationView } from '@/components/storefront/checkout/confirmation-view';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false },
};

interface PageProps {
  searchParams: Promise<{ ref?: string }>;
}

export default async function CheckoutConfirmationPage({ searchParams }: PageProps) {
  const { ref } = await searchParams;
  return (
    <>
      <ConfirmationView reference={ref ?? null} />
      <SlimFooter />
    </>
  );
}
