import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { PromotionsView } from '@/components/admin/promotions/promotions-view';

export const metadata: Metadata = { title: 'Promotions' };

/** In-store bulk pricing on the counter — same module as admin. */
export default function PosPromotionsPage() {
  return (
    <RouteGuard permission="promotions.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <PromotionsView />
      </div>
    </RouteGuard>
  );
}
