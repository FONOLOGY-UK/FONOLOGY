import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { JobsView } from '@/components/admin/jobs/jobs-view';
import { jobStatusSchema, type JobQuery, type JobSource, type JobStatus } from '@/lib/data/types';

export const metadata: Metadata = { title: 'Jobs' };

const SOURCES: JobSource[] = ['walk_in', 'mail_in', 'online'];

/**
 * Bench pipeline on the counter — same module as admin, employee-permitted.
 * Params are read on the server here for the same reason as the admin route:
 * `useSearchParams()` in the view suspends the component that owns the query.
 */
export default async function PosJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string; search?: string }>;
}) {
  const params = await searchParams;

  const status = params.status
    ?.split(',')
    .map((s) => s.trim())
    .filter((s): s is JobStatus => jobStatusSchema.safeParse(s).success);

  const initialQuery: JobQuery = {
    status: status?.length ? status : undefined,
    source: SOURCES.includes(params.source as JobSource) ? (params.source as JobSource) : undefined,
    search: params.search?.trim() || undefined,
    limit: 200,
    offset: 0,
  };

  return (
    <RouteGuard permission="jobs.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <JobsView initialQuery={initialQuery} />
      </div>
    </RouteGuard>
  );
}
