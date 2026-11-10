import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { OrdersView } from '@/components/admin/orders/orders-view';

export const metadata: Metadata = { title: 'Online orders' };

/**
 * The website's orders on the counter: the same screen and API as Admin → Online orders. Only the hub
 * shop's till shows it (online orders are all the hub's). Packing, handing over and posting are open to
 * any till user; refunds still need returns.manage, checked by the API.
 */
export default function PosOrdersPage() {
  return (
    <RouteGuard permission="pos.operate" shops="hub">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <OrdersView />
      </div>
    </RouteGuard>
  );
}
