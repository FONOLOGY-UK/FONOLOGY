'use client';

import { useState } from 'react';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAdminCategories, useDeleteCategory } from '@/lib/data/hooks';
import type { AdminCategory } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { CategoryDialog } from './category-dialog';

/**
 * Category management (FEATURE-05, migration 0045): create, rename and
 * delete the categories every product picker and the shop's own filter draw
 * from. Real delete, unlike products/suppliers — a category has no sale
 * history of its own — but blocked server-side (ON DELETE RESTRICT) while
 * any product or subcategory still references it, surfaced here as a 409.
 */
export function CategoriesView() {
  const { data: categories, isPending, isError, refetch } = useAdminCategories();
  const deleteCategory = useDeleteCategory();

  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (c: AdminCategory) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const topLevel = (categories ?? []).filter((c) => c.parentId === null);
  const childrenOf = (id: string) => (categories ?? []).filter((c) => c.parentId === id);

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Categories"
        description="Drives the shop's filter and every category picker in Inventory and Sell In Requests. One level of subcategories."
        actions={
          <Button onClick={openNew}>
            <Plus aria-hidden="true" />
            New category
          </Button>
        }
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-2 text-sm font-semibold">Categories didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : topLevel.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Add the shop's first category to get started."
          className="border-line rounded-lg border border-dashed py-16"
        />
      ) : (
        <ul className="border-line bg-card divide-line grid divide-y rounded-lg border">
          {topLevel.map((c) => {
            const children = childrenOf(c.id);
            return (
              <li key={c.id}>
                <CategoryRow
                  category={c}
                  onEdit={() => openEdit(c)}
                  onDelete={() => setDeleting(c)}
                />
                {children.length > 0 ? (
                  <ul className="divide-line border-line bg-paper-2/40 grid divide-y border-t pl-6">
                    {children.map((child) => (
                      <li key={child.id}>
                        <CategoryRow
                          category={child}
                          onEdit={() => openEdit(child)}
                          onDelete={() => setDeleting(child)}
                          sub
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} category={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this category?"
        description={
          deleting
            ? `“${deleting.label}” is removed from the shop filter and every category picker. Blocked while any product or subcategory is still filed under it — move them first.`
            : undefined
        }
        confirmLabel="Delete category"
        destructive
        loading={deleteCategory.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteCategory.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

function CategoryRow({
  category,
  onEdit,
  onDelete,
  sub = false,
}: {
  category: AdminCategory;
  onEdit: () => void;
  onDelete: () => void;
  sub?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className={sub ? 'text-ink-2 text-sm font-semibold' : 'text-ink text-sm font-semibold'}>
          {category.label}
          {category.isProtected ? (
            <span className="text-muted ml-2 inline-flex items-center gap-1 align-middle text-xs font-normal">
              <Lock className="size-3" aria-hidden="true" />
              Permanent
            </span>
          ) : null}
        </p>
        <p className="text-muted text-xs">/{category.slug}</p>
      </div>
      <div className="flex items-center gap-1">
        {/* Client decision #14 (post-launch): a mandatory category can't be
            renamed or deleted — the server refuses either regardless
            (categories_protect_mandatory, 0064), so these controls are
            simply not offered rather than letting someone hit that error.
            Adding/removing SUBcategories underneath it is unaffected —
            "New category" (picking this one as parent) still works. */}
        {!category.isProtected ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Edit ${category.label}`}
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted hover:text-red-deep h-8 px-2"
              aria-label={`Delete ${category.label}`}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
