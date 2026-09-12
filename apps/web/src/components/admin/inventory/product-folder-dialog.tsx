'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useCreateProductFolder, useUpdateProductFolder } from '@/lib/data/hooks';
import type { ProductFolder } from '@/lib/data/types';
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
import { Field } from '@/components/admin/field';
import { ProductPicker } from '@/components/admin/product-picker';

/**
 * Folder create/edit (batch 3). One dialog, both modes — same shape as
 * CategoryDialog. `productIds` is a whole-set replace on save
 * (upsert_product_folder(), 0080), so this form always sends the complete
 * list, never a diff — reusing ProductPicker as-is (already built for
 * Promotions' own multi-select) rather than a second implementation.
 */
export function ProductFolderDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  folder: ProductFolder | null;
}) {
  const createFolder = useCreateProductFolder();
  const updateFolder = useUpdateProductFolder();
  const pending = createFolder.isPending || updateFolder.isPending;

  const [label, setLabel] = useState('');
  const [productIds, setProductIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setLabel(folder?.label ?? '');
      setProductIds(folder?.productIds ?? []);
    }
  }, [open, folder]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    const input = { label: trimmed, productIds };
    const done = { onSuccess: () => onOpenChange(false) };
    if (folder) updateFolder.mutate({ id: folder.id, input }, done);
    else createFolder.mutate(input, done);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{folder ? 'Edit folder' : 'New folder'}</DialogTitle>
          <DialogDescription>
            Shows up at the till for anyone on shift — a quick way to find things like mobile panels
            without typing a search.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="folder-label">
            <Input
              id="folder-label"
              autoFocus
              placeholder="e.g. Mobile panels"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>

          <ProductPicker value={productIds} onChange={setProductIds} />

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
              {pending ? 'Saving…' : folder ? 'Save changes' : 'Add folder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
