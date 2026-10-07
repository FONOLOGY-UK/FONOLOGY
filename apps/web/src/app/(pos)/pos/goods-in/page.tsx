import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { GoodsInView } from '@/components/pos/goods-in-view';

export const metadata: Metadata = { title: 'Goods in' };

/** Booking a supplier delivery in at the till (0103, Log A). Anyone who can manage stock. */
export default function PosGoodsInPage() {
  return (
    <RouteGuard permission="inventory.manage">
      <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6">
        <GoodsInView />
      </div>
    </RouteGuard>
  );
}
