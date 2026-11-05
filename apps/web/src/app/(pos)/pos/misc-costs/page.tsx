import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RouteGuard } from '@/components/pos/route-guard';
import { MiscCostsView } from '@/components/admin/misc-costs/misc-costs-view';

export const metadata: Metadata = { title: 'Missing costs' };

/** On the counter, the same module as admin. */
export default function PosMiscCostsPage() {
  return (
    <RouteGuard permission="costs.view">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <Suspense fallback={null}>
          <MiscCostsView />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
