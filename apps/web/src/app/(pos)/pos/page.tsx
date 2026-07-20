import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { PosView } from '@/components/pos/pos-view';

export const metadata: Metadata = { title: 'Checkout' };

/** POS checkout — the counter till (item 8). */
export default function PosCheckoutPage() {
  return (
    <RouteGuard permission="pos.operate">
      <PosView />
    </RouteGuard>
  );
}
