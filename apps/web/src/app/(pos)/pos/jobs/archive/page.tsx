import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { JobsArchiveView } from '@/components/admin/jobs/jobs-archive-view';
import { JOB_ARCHIVE_STATUSES, type JobQuery } from '@/lib/data/types';

export const metadata: Metadata = { title: 'Jobs archive' };

/**
 * Round 5 Phase 2 #1 — the staff-panel equivalent of /admin/jobs/archive.
 * Same view, same `jobs.manage` gate counter staff already hold for the
 * live board; `basePath="/pos/jobs"` keeps its own links inside /pos. This
 * route didn't exist before — the live board's "Archive" button sent
 * counter staff into the admin panel because there was nowhere else to go.
 */
export default async function PosJobsArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const params = await searchParams;

  const initialQuery: JobQuery = {
    status: JOB_ARCHIVE_STATUSES,
    search: params.search?.trim() || undefined,
    limit: 200,
    offset: 0,
  };

  return (
    <RouteGuard permission="jobs.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <JobsArchiveView initialQuery={initialQuery} basePath="/pos/jobs" />
      </div>
    </RouteGuard>
  );
}
