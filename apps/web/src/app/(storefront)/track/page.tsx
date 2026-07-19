import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TrackRequest } from '@/components/storefront/track/track-request';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Track',
  description:
    'Enter your Fonology reference to track a repair request, a shop order or a sell request.',
  alternates: { canonical: '/track' },
  robots: { index: false },
};

export default function TrackPage() {
  return (
    <>
      <Suspense fallback={null}>
        <TrackRequest />
      </Suspense>
      <SlimFooter />
    </>
  );
}
