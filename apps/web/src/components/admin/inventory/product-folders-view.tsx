'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAdminProducts, useDeleteProductFolder, useProductFolders } from '@/lib/data/hooks';
import type { ProductFolder } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { ProductFolderDialog } from './product-folder-dialog';

/**
 * Favourite folder management (batch 3): create, rename, organize and
 * delete the shop-wide groupings the till grid shows every staff member —
 * "Mobile panels" is the client's own example. Deliberately independent of
 * categories (see migration 0080's own comment); a real delete, same as
 * categories, since a folder carries no sale history of its own — its
 * items go with it (product_folder_items cascades).
 */
export function ProductFoldersView() {
  const { data: folders, isPending, isError, refetch } = useProductFolders();
  // Only for resolving a product id to a name in the folder list below —
  // the picker inside the dialog fetches its own copy.
  const { data: products } = useAdminProducts();
  const deleteFolder = useDeleteProductFolder();

  const [editing, setEditing] = useState<ProductFolder | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProductFolder | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (f: ProductFolder) => {
    setEditing(f);
    setDialogOpen(true);
  };

  const nameFor = (id: string) => products?.find((p) => p.id === id)?.name ?? 'Unknown product';

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Favourite Folders"
        description="Shop-wide groupings for the till grid — every staff member sees the same folders, including a new starter. Personal favourites (the star on each product) are unaffected."
        actions={
          <Button onClick={openNew}>
            <Plus aria-hidden="true" />
            New folder
          </Button>
        }
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-2 text-sm font-semibold">Folders didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (folders ?? []).length === 0 ? (
        <EmptyState
          title="No folders yet"
          description="Group products like mobile panels so staff can find them fast at the till."
          className="border-line rounded-lg border border-dashed py-16"
        />
      ) : (
        <ul className="border-line bg-card divide-line grid divide-y rounded-lg border">
          {(folders ?? []).map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-ink text-sm font-semibold">{f.label}</p>
                <p className="text-muted truncate text-xs">
                  {f.productIds.length === 0
                    ? 'No products yet'
                    : f.productIds.map(nameFor).join(', ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  aria-label={`Edit ${f.label}`}
                  onClick={() => openEdit(f)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted hover:text-red-deep h-8 px-2"
                  aria-label={`Delete ${f.label}`}
                  onClick={() => setDeleting(f)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ProductFolderDialog open={dialogOpen} onOpenChange={setDialogOpen} folder={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this folder?"
        description={
          deleting
            ? `“${deleting.label}” disappears from the till grid immediately. The products in it aren't affected — only the grouping is removed.`
            : undefined
        }
        confirmLabel="Delete folder"
        destructive
        loading={deleteFolder.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteFolder.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}
