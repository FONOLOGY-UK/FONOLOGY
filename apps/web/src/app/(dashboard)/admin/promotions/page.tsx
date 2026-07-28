import type { Metadata } from 'next';
import { PromotionsView } from '@/components/admin/promotions/promotions-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Promotions' };

/** Promotions — in-store tiered bulk pricing (item 7). */
export default function AdminPromotionsPage() {
  return (
    <RouteGuard permission="promotions.manage">
      <PromotionsView />
    </RouteGuard>
  );
}
