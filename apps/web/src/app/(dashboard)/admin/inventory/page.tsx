import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InventoryView } from '@/components/admin/inventory/inventory-view';

export const metadata: Metadata = { title: 'Inventory' };

/** Inventory — stock truth + product CRUD (item 7). */
export default function AdminInventoryPage() {
  return (
    <Suspense>
      <InventoryView />
    </Suspense>
  );
}
