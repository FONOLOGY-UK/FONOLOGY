import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RepairFlow } from '@/components/storefront/repair/repair-flow';
import { SlimFooter } from '@/components/storefront/footer';

export const metadata: Metadata = {
  title: 'Start a repair',
  description:
    'Start a mail-in phone repair with Fonology. Pick your phone, the problem and your part grade — priced up front, posted in, fixed and returned.',
  alternates: { canonical: '/repair' },
  openGraph: {
    title: 'Start a repair — Fonology',
    description: 'Priced before we touch a screw. Post it in, we fix it, we post it back.',
    url: '/repair',
    type: 'website',
  },
};

export default function RepairPage() {
  return (
    <>
      <Suspense fallback={null}>
        <RepairFlow />
      </Suspense>
      <SlimFooter />
    </>
  );
}
