import type { Metadata } from 'next';
import { CategoriesView } from '@/components/admin/inventory/categories-view';

export const metadata: Metadata = { title: 'Categories' };

/** Category management (FEATURE-05) — create/rename/delete, gated on inventory.manage server-side. */
export default function AdminCategoriesPage() {
  return <CategoriesView />;
}
