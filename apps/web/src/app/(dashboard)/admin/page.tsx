import { Suspense } from 'react';
import { OverviewView } from '@/components/admin/overview/overview-view';

/** Admin overview — the Analytics module (item 7). */
export default function AdminOverviewPage() {
  return (
    <Suspense>
      <OverviewView />
    </Suspense>
  );
}
