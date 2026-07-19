import type { Metadata } from 'next';
import { JobsView } from '@/components/admin/jobs/jobs-view';

export const metadata: Metadata = { title: 'Jobs' };

/** Jobs — the bench pipeline (item 7). */
export default function AdminJobsPage() {
  return <JobsView />;
}
