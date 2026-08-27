import type { Metadata } from 'next';
import { ReviewsView } from '@/components/admin/reviews/reviews-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Reviews' };

/** Homepage testimonials (Round 3 follow-up #4) — owner-tier, same as
 * Staff/Settings, not given to employees by default (see permissions.config.ts). */
export default function AdminReviewsPage() {
  return (
    <RouteGuard permission="reviews.manage">
      <ReviewsView />
    </RouteGuard>
  );
}
