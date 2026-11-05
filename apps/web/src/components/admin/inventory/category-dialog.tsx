'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAdminCategories, useCreateCategory, useUpdateCategory } from '@/lib/data/hooks';
import type { AdminCategory } from '@/lib/data/types';
import { branchIds, flattenTree, indentedLabel, isUnderSlug } from '@/lib/category-tree';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/admin/field';

/**
 * Category create/edit (FEATURE-05). One dialog, both modes — same shape as
 * ProductDialog. A label, an optional parent at any depth (0125), and Show on Website: `slug` is server-
 * derived on create and never re-derived on rename (it's the storefront's
 * URL/filter contract — see the API's categoryInputBodySchema comment).
 */
export function CategoryDialog({
  open,
  onOpenChange,
  category,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  category: AdminCategory | null;
  onCreated?: (created: AdminCategory) => void;
}) {
  const { data: categories } = useAdminCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const pending = createCategory.isPending || updateCategory.isPending;

  const [label, setLabel] = useState('');
  const [parentId, setParentId] = useState('');
  const [showOnWebsite, setShowOnWebsite] = useState(true);

  useEffect(() => {
    if (open) {
      setLabel(category?.label ?? '');
      setParentId(category?.parentId ?? '');
      setShowOnWebsite(category?.showOnWebsite ?? true);
    }
  }, [open, category]);

  // Any category can hold others, except this one and what is already under it.
  const all = categories ?? [];
  const ownBranch = category ? branchIds(all, category.id) : new Set<string>();
  const parentOptions = flattenTree(all).filter(({ category: c }) => !ownBranch.has(c.id));
  // Vape can never be sold online, by law, whatever this box would say.
  const inVape = isUnderSlug(all, parentId || null, 'vape') || category?.slug === 'vape';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    const input = { label: trimmed, parentId: parentId || null, showOnWebsite };
    if (category) {
      updateCategory.mutate({ id: category.id, input }, { onSuccess: () => onOpenChange(false) });
    } else {
      createCategory.mutate(input, {
        onSuccess: (created) => {
          onCreated?.(created);
          onOpenChange(false);
        },
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{category ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogDescription>
            {category
              ? 'The shop link and every product filed under it are unaffected — only the name shown changes.'
              : 'Appears immediately in the shop filter and every category picker.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="cat-label">
            <Input
              id="cat-label"
              autoFocus
              placeholder="e.g. Screen protectors"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field
            label="Parent category (optional)"
            htmlFor="cat-parent"
            hint="Leave blank for a top-level category"
          >
            <Select id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— None (top-level) —</option>
              {parentOptions.map(({ category: c, depth }) => (
                <option key={c.id} value={c.id}>
                  {indentedLabel(c.label, depth)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--red)]"
              checked={showOnWebsite && !inVape}
              disabled={inVape}
              onChange={(e) => setShowOnWebsite(e.target.checked)}
            />
            <span>
              <span className="text-ink font-semibold">Show on Website</span>
              <span className="text-muted block text-xs">
                {inVape
                  ? 'Vape products are never shown online.'
                  : 'Off hides this category, everything under it and their products from the online shop. They still sell at the till.'}
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !label.trim()}>
              {pending ? 'Saving…' : category ? 'Save changes' : 'Add category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
