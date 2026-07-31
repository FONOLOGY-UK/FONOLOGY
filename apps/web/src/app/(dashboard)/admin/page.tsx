import { Suspense } from 'react';
import { PageLoading } from '@/components/admin/page-loading';
import { OverviewView } from '@/components/admin/overview/overview-view';

/** Admin overview — the Analytics module (item 7). */
export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <OverviewView />
    </Suspense>
  );
}
