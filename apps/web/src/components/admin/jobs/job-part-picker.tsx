'use client';

import { useEffect, useState } from 'react';
import { useAdminProducts, useProductVariations } from '@/lib/data/hooks';
import type { JobPartInput } from '@/lib/data/types';
import { pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/admin/field';

/**
 * Choosing a part for a job: a product (and which variation), or a miscellaneous part. The same on
 * the job's panel and when the job is first booked in. `label` is what to show for it on a list.
 */
export function JobPartPicker({
  busy,
  actionLabel,
  onAdd,
}: {
  busy?: boolean;
  actionLabel: string;
  onAdd: (part: JobPartInput, label: string) => void;
}) {
  const { data: products } = useAdminProducts();
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [miscOpen, setMiscOpen] = useState(false);

  // A retired product has no business being fitted to a new job.
  const sellable = (products ?? []).filter((p) => p.isActive !== false);
  const product = sellable.find((p) => p.id === productId);
  const variations = useProductVariations(productId, Boolean(product?.hasVariants));
  const options = (variations.data?.variants ?? []).filter((v) => v.isActive);

  useEffect(() => setVariantId(''), [productId]);

  const needsVariant = Boolean(product?.hasVariants);
  const add = () => {
    const qty = Number(quantity);
    if (!product || !Number.isInteger(qty) || qty < 1 || (needsVariant && !variantId)) return;
    const variant = options.find((v) => v.id === variantId);
    onAdd(
      { productId: product.id, ...(variant ? { variantId: variant.id } : {}), quantity: qty },
      variant ? `${product.name} — ${variant.label}` : product.name,
    );
    setProductId('');
    setQuantity('1');
  };

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_72px_auto] sm:items-end">
        <Field label="Add a part" htmlFor="part-product">
          <Select
            id="part-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Choose…</option>
            {sellable.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.hasVariants && p.stockQty < 1}>
                {p.hasVariants ? p.name : `${p.name} — ${p.stockQty} in stock`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Qty" htmlFor="part-qty">
          <Input
            id="part-qty"
            type="number"
            min="1"
            step="1"
            className="tabular"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          onClick={add}
          disabled={!productId || (needsVariant && !variantId) || busy}
        >
          {busy ? 'Adding…' : actionLabel}
        </Button>
      </div>
      {needsVariant ? (
        <Field label="Which one?" htmlFor="part-variant">
          <Select
            id="part-variant"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
          >
            <option value="">Choose…</option>
            {options.map((v) => (
              <option key={v.id} value={v.id} disabled={v.stockQty < 1}>
                {v.label} — {v.stockQty} in stock
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-self-start"
        onClick={() => setMiscOpen(true)}
      >
        + Miscellaneous part
      </Button>
      <MiscPartDialog
        open={miscOpen}
        onOpenChange={setMiscOpen}
        onAdd={(part) => {
          onAdd(part, part.name);
          setMiscOpen(false);
        }}
      />
    </div>
  );
}

function MiscPartDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (part: { name: string; quantity: number; costPrice: number | null }) => void;
}) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setQuantity('1');
    setCost('');
    setError(null);
  }, [open]);

  const submit = () => {
    if (name.trim().length < 2) return setError('Give the part a name.');
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return setError('Quantity is 1 or more.');
    // Blank stays blank: "nobody knows yet", not a cost of £0.
    let costPrice: number | null = null;
    if (cost.trim()) {
      const n = Number(cost);
      if (!Number.isFinite(n) || n < 0) {
        return setError('That cost isn’t a number. Leave it blank if you don’t know it.');
      }
      costPrice = pounds(n);
    }
    onAdd({ name: name.trim(), quantity: qty, costPrice });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Miscellaneous part</DialogTitle>
          <DialogDescription>
            Something that isn’t in the system. It won’t touch stock.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="What is it?" htmlFor="misc-part-name">
            <Input
              id="misc-part-name"
              autoFocus
              placeholder="e.g. Adhesive strip"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Qty" htmlFor="misc-part-qty">
            <Input
              id="misc-part-qty"
              type="number"
              min="1"
              step="1"
              className="tabular w-24"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field
            label="Cost to us each (£, optional)"
            htmlFor="misc-part-cost"
            hint="Leave blank if you don’t know: it goes on the Missing costs list to fill in later."
          >
            <Input
              id="misc-part-cost"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="tabular"
              placeholder="0.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-red-deep text-xs font-semibold">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit}>
              Add part
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
