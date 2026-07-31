import type { Metadata } from 'next';
import { JobsView } from '@/components/admin/jobs/jobs-view';
import { RouteGuard } from '@/components/pos/route-guard';
import { jobStatusSchema, type JobQuery, type JobSource, type JobStatus } from '@/lib/data/types';

export const metadata: Metadata = { title: 'Jobs' };

const SOURCES: JobSource[] = ['walk_in', 'mail_in', 'online'];

/**
 * Jobs — the bench board (item 7).
 *
 * Params are read HERE, on the server, and handed down. `useSearchParams()`
 * inside the view would suspend the component that owns the board's data
 * query, and on these routes the subtree never resumes — a direct load or a
 * hard refresh sits on skeletons and never issues the request at all. Same
 * reason the inventory screen reads its filter here.
 *
 * Anything unrecognised in the URL is dropped rather than passed through: the
 * API would reject it, and a board that shows an error because someone
 * mistyped a query string is worse than one that ignores it.
 */
export default async function AdminJobsPage({
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
      <JobsView initialQuery={initialQuery} />
    </RouteGuard>
  );
}
