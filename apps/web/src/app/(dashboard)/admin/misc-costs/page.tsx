import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageLoading } from '@/components/admin/page-loading';
import { MiscCostsView } from '@/components/admin/misc-costs/misc-costs-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Missing cost prices' };

/**
 * Change request item 10 — the "separate view" the doc asks for: every misc
 * line rung through the till without a cost price, so someone can fill it in
 * and the profit figures stop being wrong.
 *
 * `costs.view`, matching the endpoints: this page shows what the shop paid
 * for things, which the till operator who rang the sale does not
 * automatically get to see.
 */
export default function AdminMiscCostsPage() {
  return (
    <RouteGuard permission="costs.view">
      <Suspense fallback={<PageLoading />}>
        <MiscCostsView />
      </Suspense>
    </RouteGuard>
  );
}
