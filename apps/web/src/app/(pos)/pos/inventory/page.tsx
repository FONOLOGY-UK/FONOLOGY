import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RouteGuard } from '@/components/pos/route-guard';
import { InventoryView } from '@/components/admin/inventory/inventory-view';

export const metadata: Metadata = { title: 'Inventory' };

/** Inventory on the counter — costs/margins hidden (permission `costs.view`). */
export default function PosInventoryPage() {
  return (
    <RouteGuard permission="inventory.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <Suspense>
          <InventoryView hideCosts />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
