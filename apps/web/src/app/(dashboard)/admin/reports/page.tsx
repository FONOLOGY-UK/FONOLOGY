import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ReportsView } from '@/components/admin/reports/reports-view';

export const metadata: Metadata = { title: 'Reports' };

/** Business performance report (item 7). */
export default function AdminReportsPage() {
  return (
    <Suspense>
      <ReportsView />
    </Suspense>
  );
}
