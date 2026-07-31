import type { Metadata } from 'next';
import { InventoryView } from '@/components/admin/inventory/inventory-view';

export const metadata: Metadata = { title: 'Inventory' };

/**
 * Inventory — stock truth + product CRUD (item 7).
 *
 * The `?filter=low` param is read HERE, on the server, and handed down. It
 * used to be read inside InventoryView with `useSearchParams()`, which
 * suspends the component out of prerendering — and on this route the subtree
 * never resumed, so a direct load or refresh sat on skeletons and never even
 * requested its data. No `useSearchParams()` means nothing suspends, so the
 * Suspense boundary that used to wrap this is gone too. See the note in
 * inventory-view.tsx.
 */
export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  return <InventoryView initialFilter={filter === 'low' ? 'low' : 'all'} />;
}
