import type { Metadata } from 'next';
import { ProductFoldersView } from '@/components/admin/inventory/product-folders-view';

export const metadata: Metadata = { title: 'Favourite Folders' };

/** Favourite folder management (batch 3) — create/rename/organize, gated on inventory.manage server-side. */
export default function AdminProductFoldersPage() {
  return <ProductFoldersView />;
}
