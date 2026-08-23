import type { Metadata } from 'next';
import { SubmissionsView } from '@/components/admin/submissions/submissions-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Form submissions' };

export default function AdminSubmissionsPage() {
  return (
    <RouteGuard permission="jobs.manage">
      <SubmissionsView />
    </RouteGuard>
  );
}
