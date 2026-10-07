import type { Metadata } from 'next';
import { DeliveryView } from '@/components/admin/delivery/delivery-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Delivery' };

/** Delivery prices, remote postcodes and the free-delivery threshold (0102). Managers can look;
 * the API lets only the owner change them. */
export default function AdminDeliveryPage() {
  return (
    <RouteGuard permission="settings.manage">
      <DeliveryView />
    </RouteGuard>
  );
}
