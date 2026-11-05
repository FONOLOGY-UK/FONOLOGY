import type { Metadata } from 'next';
import { RouteGuard } from '@/components/pos/route-guard';
import { CategoriesView } from '@/components/admin/inventory/categories-view';

export const metadata: Metadata = { title: 'Categories' };

/** On the counter, the same module as admin. */
export default function PosCategoriesPage() {
  return (
    <RouteGuard permission="inventory.manage">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
        <CategoriesView />
      </div>
    </RouteGuard>
  );
}
