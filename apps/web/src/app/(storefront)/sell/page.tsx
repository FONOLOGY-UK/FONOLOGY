import type { Metadata } from 'next';
import { SellFlow } from '@/components/storefront/sell/sell-flow';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Sell your phone',
  description:
    'Sell or trade in your old phone with Fonology. Tell us the model and condition for an indicative estimate — we confirm the offer, you post it in, we pay out.',
  alternates: { canonical: '/sell' },
  openGraph: {
    title: 'Sell your phone — Fonology',
    description:
      'Cash for your old phone. Indicative estimate in a minute, firm offer after we check it.',
    url: '/sell',
    type: 'website',
  },
};

export default function SellPage() {
  return (
    <>
      <SellFlow />
      <SlimFooter />
    </>
  );
}
