import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { InventoryView } from '@/components/admin/inventory/inventory-view';

export const metadata: Metadata = { title: 'Inventory' };

/**
 * Inventory on the counter — costs/margins hidden (permission `costs.view`).
 *
 * Same as the admin page: the filter comes from the server rather than from
 * `useSearchParams()`, so nothing suspends and a direct load works.
 */
export default async function PosInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  return (
    <RouteGuard permission="inventory.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <InventoryView hideCosts initialFilter={filter === 'low' ? 'low' : 'all'} />
      </div>
    </RouteGuard>
  );
}
