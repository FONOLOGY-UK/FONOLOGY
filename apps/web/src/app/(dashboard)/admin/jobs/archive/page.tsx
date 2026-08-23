import type { Metadata } from 'next';
import { JobsArchiveView } from '@/components/admin/jobs/jobs-archive-view';
import { RouteGuard } from '@/components/pos/route-guard';
import { JOB_ARCHIVE_STATUSES, type JobQuery } from '@/lib/data/types';

export const metadata: Metadata = { title: 'Jobs archive' };

/**
 * Jobs archive (BUG-15-followup #13) — collected / sent_back / cancelled,
 * the three statuses the live board deliberately no longer shows (see
 * JOB_PIPELINE's comment in types/job.ts). Params read server-side, same
 * "useSearchParams() suspends the query-owning subtree" reasoning as the
 * live board's own page.
 */
export default async function AdminJobsArchivePage({
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
      <JobsArchiveView initialQuery={initialQuery} />
    </RouteGuard>
  );
}
