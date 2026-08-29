'use client';

import { useState } from 'react';
import { Loader2, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  useProductVariants,
  useCreateProductVariant,
  useUpdateProductVariant,
  useDeleteProductVariant,
  useAdjustVariantStock,
} from '@/lib/data/hooks';
import type { ProductVariant } from '@/lib/data/types';
import { formatGBP, pounds, variantOptionsLabel } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Round 5 Phase 4 #16 (trimmed v1) — a has_variants product's variant list,
 * reusing the Device Models admin page's own list/add/edit/soft-delete
 * pattern (Round 4), one level down. Only ever rendered once the parent
 * product is saved (a variant needs a real product_id to attach to).
 *
 * `options` has no dedicated per-axis picker in this trimmed v1 — it's a
 * flat set of (name, value) rows the admin types freely ("colour" / "Black",
 * "storage" / "128GB"), matching product_variants.options being a plain
 * jsonb map with no normalised option-values table (see 0060's header).
 */
export function VariantsPanel({ productId }: { productId: string }) {
  const { data: variants, isPending } = useProductVariants(productId);
  const createVariant = useCreateProductVariant(productId);
  const updateVariant = useUpdateProductVariant(productId);
  const deleteVariant = useDeleteProductVariant(productId);
  const adjustStock = useAdjustVariantStock(productId);

  const [editing, setEditing] = useState<ProductVariant | 'new' | null>(null);

  if (isPending) return <p className="text-muted text-xs">Loading variants…</p>;

  const list = variants ?? [];
  const active = list.filter((v) => v.isActive);
  const retired = list.filter((v) => !v.isActive);

  return (
    <div className="grid gap-3">
      {active.length === 0 ? (
        <p className="text-muted text-xs">No variants yet.</p>
      ) : (
        <div className="grid gap-2">
          {active.map((v) => (
            <VariantRow
              key={v.id}
              variant={v}
              onEdit={() => setEditing(v)}
              onDelete={() => {
                if (confirm(`Remove the "${variantOptionsLabel(v.options)}" variant?`)) {
                  deleteVariant.mutate(v.id);
                }
              }}
              onAdjustStock={(delta) => adjustStock.mutate({ variantId: v.id, delta })}
            />
          ))}
        </div>
      )}

      {retired.length > 0 ? (
        <details className="text-xs">
          <summary className="text-muted cursor-pointer select-none">
            {retired.length} retired variant{retired.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 grid gap-2">
            {retired.map((v) => (
              <div
                key={v.id}
                className="border-line rounded-ui text-muted flex items-center justify-between border px-3 py-2 opacity-70"
              >
                <span>{variantOptionsLabel(v.options)}</span>
                <span>Retired</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {editing ? (
        <VariantForm
          variant={editing === 'new' ? null : editing}
          pending={createVariant.isPending || updateVariant.isPending}
          onCancel={() => setEditing(null)}
          onSubmit={(input) => {
            if (editing === 'new') {
              createVariant.mutate(input, { onSuccess: () => setEditing(null) });
            } else {
              updateVariant.mutate(
                { variantId: editing.id, input },
                { onSuccess: () => setEditing(null) },
              );
            }
          }}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setEditing('new')}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add variant
        </Button>
      )}
    </div>
  );
}

function VariantRow({
  variant,
  onEdit,
  onDelete,
  onAdjustStock,
}: {
  variant: ProductVariant;
  onEdit: () => void;
  onDelete: () => void;
  onAdjustStock: (delta: number) => void;
}) {
  return (
    <div className="border-line rounded-ui flex flex-wrap items-center justify-between gap-3 border px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="font-semibold">{variantOptionsLabel(variant.options)}</p>
        <p className="text-muted text-xs">
          {variant.sku}
          {variant.barcode ? ` · ${variant.barcode}` : ''} ·{' '}
          {variant.priceAdjustment === 0
            ? 'no price change'
            : `${variant.priceAdjustment > 0 ? '+' : ''}${formatGBP(variant.priceAdjustment)}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="hover:bg-paper-2 rounded-ui border-line flex size-7 items-center justify-center border"
            onClick={() => onAdjustStock(-1)}
            disabled={variant.stockQty <= 0}
            aria-label="Decrease stock by 1"
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </button>
          <span className="tabular w-8 text-center text-xs font-medium">{variant.stockQty}</span>
          <button
            type="button"
            className="hover:bg-paper-2 rounded-ui border-line flex size-7 items-center justify-center border"
            onClick={() => onAdjustStock(1)}
            aria-label="Increase stock by 1"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="hover:bg-paper-2 rounded-ui border-line flex size-7 items-center justify-center border"
          onClick={onEdit}
          aria-label="Edit variant"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="hover:bg-paper-2 rounded-ui border-line flex size-7 items-center justify-center border"
          onClick={onDelete}
          aria-label="Remove variant"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function VariantForm({
  variant,
  pending,
  onCancel,
  onSubmit,
}: {
  variant: ProductVariant | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    options: Record<string, string>;
    sku: string;
    barcode?: string;
    priceAdjustment: number;
    costPrice: number;
    stockQty: number;
    lowStockAlert: boolean;
    lowStockThreshold: number;
    isActive: boolean;
  }) => void;
}) {
  const [options, setOptions] = useState<{ key: string; value: string }[]>(
    variant
      ? Object.entries(variant.options).map(([key, value]) => ({ key, value }))
      : [{ key: 'colour', value: '' }],
  );
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [barcode, setBarcode] = useState(variant?.barcode ?? '');
  const [priceAdjustmentPounds, setPriceAdjustmentPounds] = useState(
    variant ? (variant.priceAdjustment / 100).toFixed(2) : '0.00',
  );
  // Client decision #15 (post-launch): unlocked on edit too, same as the
  // parent product's own form — type a total directly, and whatever cost
  // is on the form applies to the whole stock volume (no more averaging).
  const [costPounds, setCostPounds] = useState(
    variant ? (variant.costPrice / 100).toFixed(2) : '0.00',
  );
  const [stockQty, setStockQty] = useState(variant ? `${variant.stockQty}` : '0');
  const [lowStockAlert, setLowStockAlert] = useState(variant?.lowStockAlert ?? false);
  const [lowStockThreshold, setLowStockThreshold] = useState(`${variant?.lowStockThreshold ?? 5}`);
  const [isActive, setIsActive] = useState(variant?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="border-line rounded-ui grid gap-3 border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const optionsMap = Object.fromEntries(
          options
            .map(({ key, value }) => [key.trim(), value.trim()] as const)
            .filter(([key, value]) => key.length > 0 && value.length > 0),
        );
        if (Object.keys(optionsMap).length === 0) {
          setError('Add at least one option (e.g. colour)');
          return;
        }
        if (!sku.trim()) {
          setError('Enter a SKU');
          return;
        }
        setError(null);
        onSubmit({
          options: optionsMap,
          sku: sku.trim(),
          barcode: barcode.trim() || undefined,
          priceAdjustment: Math.round((Number(priceAdjustmentPounds) || 0) * 100),
          costPrice: pounds(Number(costPounds) || 0),
          stockQty: Math.max(0, Math.round(Number(stockQty) || 0)),
          lowStockAlert,
          lowStockThreshold: Math.max(1, Math.round(Number(lowStockThreshold) || 5)),
          isActive,
        });
      }}
    >
      <div className="grid gap-2">
        <span className="text-xs font-semibold">Options</span>
        {options.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="colour"
              value={row.key}
              className="h-9 flex-1"
              onChange={(e) =>
                setOptions((cur) =>
                  cur.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                )
              }
            />
            <Input
              placeholder="Black"
              value={row.value}
              className="h-9 flex-1"
              onChange={(e) =>
                setOptions((cur) =>
                  cur.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                )
              }
            />
            <button
              type="button"
              className="hover:bg-paper-2 rounded-ui border-line flex size-9 shrink-0 items-center justify-center border"
              onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))}
              disabled={options.length <= 1}
              aria-label="Remove option"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setOptions((cur) => [...cur, { key: '', value: '' }])}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add option
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">
          SKU
          <Input value={sku} className="h-9" onChange={(e) => setSku(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Barcode (optional)
          <Input value={barcode} className="h-9" onChange={(e) => setBarcode(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Price adjustment (£, can be negative)
          <Input
            type="number"
            step="0.01"
            value={priceAdjustmentPounds}
            className="tabular h-9"
            onChange={(e) => setPriceAdjustmentPounds(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          {variant ? 'Cost (£/unit)' : 'Starting cost (£/unit)'}
          <Input
            type="number"
            step="0.01"
            min="0"
            value={costPounds}
            className="tabular h-9"
            onChange={(e) => setCostPounds(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          {variant ? 'Stock count' : 'Starting stock'}
          <Input
            type="number"
            step="1"
            min="0"
            value={stockQty}
            className="tabular h-9"
            onChange={(e) => setStockQty(e.target.value)}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold">
        <input
          type="checkbox"
          className="accent-[var(--red)]"
          checked={lowStockAlert}
          onChange={(e) => setLowStockAlert(e.target.checked)}
        />
        Warn when this variant runs low
      </label>
      {lowStockAlert ? (
        <label className="flex items-center gap-2 text-xs">
          Warn at or below
          <Input
            type="number"
            min="1"
            value={lowStockThreshold}
            className="tabular h-8 w-20"
            onChange={(e) => setLowStockThreshold(e.target.value)}
          />
          in stock
        </label>
      ) : null}

      {variant ? (
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            className="accent-[var(--red)]"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (untick to retire this variant)
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="text-red-deep text-xs font-medium">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          {variant ? 'Save variant' : 'Add variant'}
        </Button>
      </div>
    </form>
  );
}
