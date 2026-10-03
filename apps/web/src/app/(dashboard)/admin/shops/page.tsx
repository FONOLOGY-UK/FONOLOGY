import type { Metadata } from 'next';
import { ShopsView } from '@/components/admin/shops/shops-view';
import { RouteGuard } from '@/components/pos/route-guard';

export const metadata: Metadata = { title: 'Shops' };

/** The shops (multi-shop). Owner only: the API refuses anyone else. */
export default function AdminShopsPage() {
  return (
    <RouteGuard permission="settings.manage">
      <ShopsView />
    </RouteGuard>
  );
}
