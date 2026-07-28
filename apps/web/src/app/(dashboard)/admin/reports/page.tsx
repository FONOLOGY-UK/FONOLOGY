import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsView } from '@/components/admin/reports/reports-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Reports' };

/** Business performance report (item 7). */
export default function AdminReportsPage() {
  return (
    <RouteGuard permission="reports.view">
      <Suspense>
        <ReportsView />
      </Suspense>
    </RouteGuard>
  );
}
