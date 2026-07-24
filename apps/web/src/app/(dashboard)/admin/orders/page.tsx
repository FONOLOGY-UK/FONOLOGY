import type { Metadata } from 'next';
import { OrdersView } from '@/components/admin/orders/orders-view';

export const metadata: Metadata = { title: 'Online orders' };

/** The incoming web order queue — pack, hand over, dispatch. */
export default function AdminOrdersPage() {
  return <OrdersView />;
}
