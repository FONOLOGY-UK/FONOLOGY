import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { JobsView } from '@/components/admin/jobs/jobs-view';

export const metadata: Metadata = { title: 'Jobs' };

/** Bench pipeline on the counter — same module as admin, employee-permitted. */
export default function PosJobsPage() {
  return (
    <RouteGuard permission="jobs.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <JobsView />
      </div>
    </RouteGuard>
  );
}
