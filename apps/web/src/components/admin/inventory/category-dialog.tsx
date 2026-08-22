'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAdminCategories, useCreateCategory, useUpdateCategory } from '@/lib/data/hooks';
import type { AdminCategory } from '@/lib/data/types';
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
 * ProductDialog. Just a label and an optional parent: `slug` is server-
 * derived on create and never re-derived on rename (it's the storefront's
 * URL/filter contract — see the API's categoryInputBodySchema comment).
 */
export function CategoryDialog({
  open,
  onOpenChange,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  category: AdminCategory | null;
}) {
  const { data: categories } = useAdminCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const pending = createCategory.isPending || updateCategory.isPending;

  const [label, setLabel] = useState('');
  const [parentId, setParentId] = useState('');

  useEffect(() => {
    if (open) {
      setLabel(category?.label ?? '');
      setParentId(category?.parentId ?? '');
    }
  }, [open, category]);

  // One level of subcategory is all that's asked for — the schema itself
  // doesn't stop a deeper tree (categories.parent_id, migration 0045), but
  // only offering a TOP-LEVEL category as a parent, and never the category
  // being edited itself, is what actually keeps it to one level here.
  const parentOptions = (categories ?? []).filter(
    (c) => c.parentId === null && c.id !== category?.id,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    const input = { label: trimmed, parentId: parentId || null };
    const done = { onSuccess: () => onOpenChange(false) };
    if (category) updateCategory.mutate({ id: category.id, input }, done);
    else createCategory.mutate(input, done);
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
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>

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
