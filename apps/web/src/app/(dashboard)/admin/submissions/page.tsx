import type { Metadata } from 'next';
import { SubmissionsView } from '@/components/admin/submissions/submissions-view';
import { RouteGuard } from '@/components/pos/route-guard';

// Round 4 #FEAT-03: was "Form submissions" — matches the nav label rename,
// which this page's own metadata missed at the time.
export const metadata: Metadata = { title: 'Repair Requests' };

export default function AdminSubmissionsPage() {
  return (
    <RouteGuard permission="jobs.manage">
      <SubmissionsView />
    </RouteGuard>
  );
}
