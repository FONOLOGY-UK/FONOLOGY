import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { SubmissionsView } from '@/components/admin/submissions/submissions-view';

export const metadata: Metadata = { title: 'Repair Requests' };

/**
 * Round 5 Phase 2 #6 — the staff-panel equivalent of /admin/submissions.
 * Counter staff previously had no way to see incoming mail-in repair
 * bookings at all outside the "Add job" dialog's own picker. Same
 * `jobs.manage` gate the live Jobs board already uses on /pos, same view —
 * nothing here is admin-only (booking contact details, device/repair/tier
 * and the customer's problem description are exactly what staff need to
 * follow up on a repair request, same as the admin screen shows). `Href`
 * props keep its two cross-links (start a job, jump to Sell In Requests)
 * inside /pos.
 */
export default function PosSubmissionsPage() {
  return (
    <RouteGuard permission="jobs.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <SubmissionsView jobsHref="/pos/jobs" tradeInsHref="/pos/trade-ins" />
      </div>
    </RouteGuard>
  );
}
