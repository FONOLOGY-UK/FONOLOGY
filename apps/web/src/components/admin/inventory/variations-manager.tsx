'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Loader2, Pencil, Printer, Star, Trash2 } from 'lucide-react';
import {
  useAddVariationRows,
  useBulkUpdateVariations,
  useEnqueuePrintJob,
  useGenerateBarcode,
  useGenerateVariationBarcodes,
  usePrintVariationLabels,
  useProductVariations,
  useRemoveVariation,
  useRenameVariation,
  useSetDefaultVariation,
  useUpdateVariation,
} from '@/lib/data/hooks';
import type {
  AdminProduct,
  ProductVariant,
  ProductVariations,
  VariationEdit,
} from '@/lib/data/types';
import { pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { linesToPrint, newRowDraft, readRows, VariationRowsEditor } from './variation-rows-editor';
import type { VariationRowDraft } from './variation-rows-editor';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import { RichTextEditor, sanitizeHtml } from '@/components/admin/rich-text';
import { toast } from '@/lib/stores/toast.store';
import { cn } from '@/lib/utils';
import { VariationImagesInput } from './variation-images-input';
import { ExtraBarcodes } from './extra-barcodes';

/**
 * Variations of a saved product (0107, entered line by line since client changes v2, 2.6): adding
 * lines, and the list of variations with inline name, barcode, stock and prices, a label button,
 * on/off, default, bulk edit, and each variation's own details.
 *
 * Everything here saves as it is done, separately from the product form's Save: each action is
 * its own transaction on the server and either lands whole or says why not.
 */

const toPounds = (p: number) => (p / 100).toFixed(2);
/** "12.50" -> 1250; '' or nonsense -> null. */
function parsePounds(text: string): number | null {
  const t = text.trim();
  if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return pounds(Number(t));
}
function parseCount(text: string): number | null {
  const t = text.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  return Number(t);
}

export function VariationsManager({
  product,
  canSeeCosts,
}: {
  product: AdminProduct;
  canSeeCosts: boolean;
}) {
  const { data, isPending, isError, refetch } = useProductVariations(product.id);
  if (isPending) {
    return (
      <p className="text-muted flex items-center gap-2 text-xs">
        <Loader2 className="size-3 animate-spin" /> Loading variations…
      </p>
    );
  }
  if (isError || !data) {
    return (
      <div className="text-sm">
        Couldn’t load the variations.{' '}
        <Button type="button" variant="link" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-5">
      {data.types.length > 1 ? (
        <p className="text-muted text-xs">
          This product was set up with several options, so lines can’t be added one by one.
        </p>
      ) : (
        <AddLines product={product} data={data} canSeeCosts={canSeeCosts} />
      )}
      <VariationList product={product} data={data} canSeeCosts={canSeeCosts} />
    </div>
  );
}

/* ---- Adding lines ------------------------------------------------------------------------------ */

function AddLines({
  product,
  data,
  canSeeCosts,
}: {
  product: AdminProduct;
  data: ProductVariations;
  canSeeCosts: boolean;
}) {
  const add = useAddVariationRows(product.id);
  const printLabels = usePrintVariationLabels();
  const [rows, setRows] = useState<VariationRowDraft[]>([newRowDraft()]);
  const [error, setError] = useState<string | null>(null);

  // New lines follow the product: its default variation's price and cost, or the plain product's.
  const base = data.variants.find((v) => v.isDefault);
  const defaults = {
    price: toPounds(base?.price ?? product.price),
    cost: toPounds(base?.costPrice ?? product.costPrice),
  };

  const save = () => {
    const read = readRows(rows, defaults, { requiresImei: data.requiresImei, canSeeCosts });
    setError(read.error);
    if (read.error !== null) return;
    const names = linesToPrint(rows);
    add.mutate(read.rows, {
      onSuccess: () => {
        setRows([newRowDraft()]);
        if (names.length > 0) printLabels.mutate({ productId: product.id, names });
      },
    });
  };

  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-semibold">Add variations</h3>
        <p className="text-muted text-xs">
          One line each. Leave price or cost blank to use the product’s.
        </p>
      </div>
      {data.variants.length === 0 && product.stockQty > 0 ? (
        <p className="border-line rounded-ui border p-3 text-xs">
          This product’s own stock ({product.stockQty}) is written off when the first line is added:
          from then on stock is counted per variation. Enter it on a line if it’s still on the
          shelf.
        </p>
      ) : null}
      <VariationRowsEditor
        rows={rows}
        onChange={setRows}
        defaults={defaults}
        canSeeCosts={canSeeCosts}
        requiresImei={data.requiresImei}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={add.isPending} onClick={save}>
          {add.isPending ? <Loader2 className="animate-spin" /> : null}
          Save {rows.length === 1 ? 'line' : `${rows.length} lines`}
        </Button>
        {error ? (
          <span role="alert" className="text-red-deep text-xs font-semibold">
            {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/* ---- The list ---------------------------------------------------------------------------------- */

type Filter = 'all' | 'enabled' | 'disabled';

function VariationList({
  product,
  data,
  canSeeCosts,
}: {
  product: AdminProduct;
  data: ProductVariations;
  canSeeCosts: boolean;
}) {
  const update = useUpdateVariation(product.id);
  const rename = useRenameVariation(product.id);
  const remove = useRemoveVariation(product.id);
  const [removing, setRemoving] = useState<ProductVariant | null>(null);
  const flat = data.types.length <= 1;
  const setDefault = useSetDefaultVariation(product.id);
  const generateBarcodes = useGenerateVariationBarcodes(product.id);
  const enqueuePrint = useEnqueuePrintJob();
  const mintBarcode = useGenerateBarcode();
  // A label needs a barcode to scan, so a variation without one gets one first.
  const printLabel = async (v: ProductVariant) => {
    if (!v.barcode) {
      const code = await mintBarcode.mutateAsync().catch(() => null);
      if (!code) return;
      const saved = await update
        .mutateAsync({ variantId: v.id, edit: { barcode: code } })
        .catch(() => null);
      if (!saved) return;
    }
    enqueuePrint.mutate({
      kind: 'shelf_label',
      entityId: v.id,
      dedupeKey: `shelf-label-${v.id}-${Date.now()}`,
    });
  };
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ProductVariant | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const shown = data.variants.filter((v) =>
    filter === 'all' ? true : filter === 'enabled' ? v.isActive : !v.isActive,
  );
  // Selection only ever holds variations that still exist.
  const live = new Set(data.variants.map((v) => v.id));
  const chosen = [...selected].filter((id) => live.has(id));
  const allShownSelected = shown.length > 0 && shown.every((v) => selected.has(v.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const counts = {
    all: data.variants.length,
    enabled: data.variants.filter((v) => v.isActive).length,
    disabled: data.variants.filter((v) => !v.isActive).length,
  };
  // Each variation is its own item at the till, so each needs its own barcode.
  const missingBarcodes = data.variants.filter((v) => !v.barcode).length;
  const missingImeis = data.requiresImei ? data.variants.filter((v) => !v.imei).length : 0;

  if (data.variants.length === 0) {
    return <p className="text-muted text-xs">No variations yet. Add the first line above.</p>;
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-2 text-sm font-semibold">Variations</h3>
        {(['all', 'enabled', 'disabled'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              'border-line rounded-full border px-3 py-1 text-xs font-semibold capitalize',
              filter === f && 'border-ink bg-ink text-paper',
            )}
          >
            {f} ({counts[f]})
          </button>
        ))}
        {missingImeis > 0 ? (
          <span className="text-red-deep text-xs font-semibold">
            {missingImeis} without an IMEI — open each one and add it
          </span>
        ) : null}
        {missingBarcodes > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-red-deep text-xs font-semibold">
              {missingBarcodes} without a barcode
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={generateBarcodes.isPending}
              onClick={() => generateBarcodes.mutate()}
            >
              {generateBarcodes.isPending ? <Loader2 className="animate-spin" /> : null}
              Generate missing barcodes
            </Button>
          </div>
        ) : null}
      </div>

      {chosen.length > 0 ? (
        <div className="bg-ink text-paper rounded-ui flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <strong>{chosen.length} selected</strong>
          <Button type="button" size="sm" variant="secondary" onClick={() => setBulkOpen(true)}>
            Edit selected
          </Button>
          <button
            type="button"
            className="text-paper/80 hover:text-paper ml-auto text-xs underline"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="border-line rounded-ui overflow-x-auto border">
        <table className="w-full min-w-[830px] table-fixed text-sm">
          <thead className="bg-paper-2/60 text-muted text-left text-[11px] uppercase tracking-[0.06em]">
            <tr>
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allShownSelected}
                  onChange={() =>
                    setSelected(allShownSelected ? new Set() : new Set(shown.map((v) => v.id)))
                  }
                  className="accent-[var(--red)]"
                />
              </th>
              <th className="px-1.5 py-2">Variation</th>
              <th className="w-36 px-1.5 py-2">Barcode</th>
              <th className="w-[68px] px-1.5 py-2">Stock</th>
              <th className="w-[76px] px-1.5 py-2">Price £</th>
              {canSeeCosts ? <th className="w-[76px] px-1.5 py-2">Cost £</th> : null}
              <th className="w-[122px] px-1.5 py-2">Label</th>
              <th className="w-[60px] px-1.5 py-2">On</th>
              <th className="w-[124px] px-1.5 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => {
              const custom =
                [v.name, v.description, v.tag, v.compatibility, v.supplier].some(
                  (x) => x !== null,
                ) || v.images.length > 0;
              return (
                <tr
                  key={v.id}
                  className={cn('border-line border-t', !v.isActive && 'bg-paper-2/40 text-muted')}
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${v.label}`}
                      checked={selected.has(v.id)}
                      onChange={() => toggle(v.id)}
                      className="accent-[var(--red)]"
                    />
                  </td>
                  <td className="px-1.5 py-2">
                    <div className="grid gap-1">
                      <div className="min-w-0">
                        {flat ? (
                          <InlineName
                            label={`Name of ${v.label}`}
                            value={v.label}
                            onCommit={(name) => rename.mutateAsync({ variantId: v.id, name })}
                          />
                        ) : (
                          <div className="font-semibold">{v.label}</div>
                        )}
                        <div className="flex flex-wrap gap-1 text-[10px] font-semibold uppercase tracking-[0.06em]">
                          {v.isDefault ? (
                            <span className="bg-red rounded px-1.5 py-0.5 text-white">Default</span>
                          ) : null}
                          {!v.isActive ? (
                            <span className="bg-ink/70 text-paper rounded px-1.5 py-0.5">
                              Disabled
                            </span>
                          ) : null}
                          {custom ? (
                            <span className="border-line rounded border px-1.5 py-0.5">
                              Own details
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-1.5 py-2">
                    <InlineBarcode
                      label={`Barcode for ${v.label}`}
                      value={v.barcode ?? ''}
                      onCommit={(barcode) =>
                        update.mutateAsync({ variantId: v.id, edit: { barcode } })
                      }
                    />
                  </td>
                  <td className="px-1.5 py-2">
                    <InlineNumber
                      label={`Stock for ${v.label}`}
                      value={String(v.stockQty)}
                      parse={parseCount}
                      emptyMessage="Stock can’t be blank (0 is fine)"
                      onCommit={(n) =>
                        update.mutateAsync({ variantId: v.id, edit: { stockQty: n } })
                      }
                    />
                  </td>
                  <td className="px-1.5 py-2">
                    <InlineNumber
                      label={`Price for ${v.label}`}
                      value={toPounds(v.price)}
                      parse={(t) => {
                        const p = parsePounds(t);
                        return p && p > 0 ? p : null;
                      }}
                      emptyMessage="Enter a selling price"
                      onCommit={(p) => update.mutateAsync({ variantId: v.id, edit: { price: p } })}
                    />
                  </td>
                  {canSeeCosts ? (
                    <td className="px-1.5 py-2">
                      <InlineNumber
                        label={`Cost for ${v.label}`}
                        value={toPounds(v.costPrice)}
                        parse={parsePounds}
                        emptyMessage="Enter a cost price"
                        onCommit={(c) =>
                          update.mutateAsync({ variantId: v.id, edit: { costPrice: c } })
                        }
                      />
                    </td>
                  ) : null}
                  <td className="px-1.5 py-2">
                    {/* The label prints this variation's own name, price and barcode
                        (buildShelfLabel takes a variation id). */}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1 px-2"
                      disabled={enqueuePrint.isPending || mintBarcode.isPending}
                      aria-label={`Print label for ${v.label}`}
                      title={v.barcode ? 'Print shelf label' : 'Generates a barcode, then prints'}
                      onClick={() => void printLabel(v)}
                    >
                      <Printer /> Print Label
                    </Button>
                  </td>
                  <td className="px-1.5 py-2">
                    <Toggle
                      label={`${v.label} on sale`}
                      on={v.isActive}
                      disabled={v.isDefault && v.isActive}
                      title={
                        v.isDefault && v.isActive
                          ? 'The default can’t be disabled — set another default first'
                          : undefined
                      }
                      onChange={(on) => update.mutate({ variantId: v.id, edit: { isActive: on } })}
                    />
                  </td>
                  <td className="px-1.5 py-2">
                    <div className="ml-auto flex w-max justify-end gap-0.5 [&>button]:size-9 [&>button]:shrink-0 [&>button]:p-0">
                      {!v.isDefault ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!v.isActive || setDefault.isPending}
                          aria-label={`Set ${v.label} as default`}
                          title={v.isActive ? 'Set as default' : 'Enable it first'}
                          onClick={() => setDefault.mutate(v.id)}
                        >
                          <Star />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(v)}
                        aria-label={`Edit ${v.label}`}
                        title="Edit this variation"
                      >
                        <Pencil />
                      </Button>
                      {flat ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-6 justify-self-start px-1 text-xs"
                          variant="ghost"
                          aria-label={`Delete ${v.label}`}
                          title="Delete this variation"
                          onClick={() => setRemoving(v)}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        destructive
        title={`Delete ${removing?.label ?? 'this variation'}?`}
        description="Its stock, prices and pictures go with it. Past sales keep their records."
        confirmLabel="Delete variation"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id, { onSuccess: () => setRemoving(null) });
        }}
      />
      {editing ? (
        <VariationEditDialog
          product={product}
          variant={data.variants.find((v) => v.id === editing.id) ?? editing}
          canSeeCosts={canSeeCosts}
          requiresImei={data.requiresImei}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {bulkOpen ? (
        <BulkEditDialog
          product={product}
          variants={data.variants.filter((v) => chosen.includes(v.id))}
          canSeeCosts={canSeeCosts}
          onClose={(done) => {
            setBulkOpen(false);
            if (done) setSelected(new Set());
          }}
        />
      ) : null}
    </section>
  );
}

/** A hand-entered variation's name, edited in place. */
function InlineName({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (name: string) => Promise<unknown>;
}) {
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(value), [value]);

  const commit = async () => {
    const next = text.trim();
    if (!next || next === value) return setText(value);
    setSaving(true);
    try {
      await onCommit(next);
    } catch {
      setText(value); // the hook already said why
    } finally {
      setSaving(false);
    }
  };

  return (
    <Input
      aria-label={label}
      value={text}
      disabled={saving}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        }
        if (e.key === 'Escape') setText(value);
      }}
      className="h-8 w-full min-w-0 px-2 font-semibold"
    />
  );
}

/** A number edited in place: saved on Enter or leaving the box; blank is refused, not saved. */
function InlineNumber({
  label,
  value,
  parse,
  emptyMessage,
  onCommit,
}: {
  label: string;
  value: string;
  parse: (text: string) => number | null;
  emptyMessage: string;
  onCommit: (n: number) => Promise<unknown>;
}) {
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(value), [value]);

  const commit = async () => {
    if (text === value) return setError(null);
    const n = parse(text);
    if (n === null) {
      setError(emptyMessage);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onCommit(n);
    } catch {
      setText(value); // the hook already said why
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        inputMode="decimal"
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          }
          if (e.key === 'Escape') {
            setText(value);
            setError(null);
          }
        }}
        className={cn('tabular h-8 w-full min-w-0 px-1.5', error && 'border-red-deep')}
      />
      {error ? <p className="text-red-deep mt-1 text-[11px] font-medium">{error}</p> : null}
    </div>
  );
}

/**
 * A variation's barcode edited in place: scanned or typed, saved on Enter or leaving the box.
 * Blank clears it. With none yet, Generate mints a fresh one (lib/barcodes.ts) and saves it.
 */
function InlineBarcode({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (barcode: string | null) => Promise<unknown>;
}) {
  const generate = useGenerateBarcode();
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(value), [value]);

  const save = async (next: string) => {
    const trimmed = next.trim();
    if (trimmed === value) return setText(value);
    setSaving(true);
    try {
      await onCommit(trimmed || null);
    } catch {
      setText(value); // the hook already said why (a barcode already in use names its owner)
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || generate.isPending;
  return (
    <div className="grid gap-0.5">
      <Input
        aria-label={label}
        placeholder="Scan or type"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void save(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save(text);
          }
          if (e.key === 'Escape') setText(value);
        }}
        className="tabular h-8 w-full min-w-0 px-2"
      />
      {text.trim() ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            const code = await generate.mutateAsync().catch(() => null);
            if (!code) return;
            setText(code);
            await save(code);
          }}
        >
          Generate
        </Button>
      )}
    </div>
  );
}

function Toggle({
  label,
  on,
  disabled,
  title,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
        on ? 'bg-red' : 'bg-ink/25',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/* ---- One variation ---------------------------------------------------------------------------- */

type Detail = 'name' | 'description' | 'tag' | 'compatibility' | 'supplier';
const DETAILS: { key: Detail; label: string }[] = [
  { key: 'name', label: 'Title' },
  { key: 'tag', label: 'Badge' },
  { key: 'compatibility', label: 'Compatibility' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'description', label: 'Description' },
];

/** The parent's value of an optional detail — what an inheriting variation shows. */
function parentDetail(product: AdminProduct, key: Detail): string {
  if (key === 'supplier') return product.supplier ?? '';
  if (key === 'tag') return product.tag ?? '';
  if (key === 'compatibility') return product.compatibility ?? '';
  if (key === 'description') return product.description ?? '';
  return product.name;
}

function VariationEditDialog({
  product,
  variant,
  canSeeCosts,
  requiresImei,
  onClose,
}: {
  product: AdminProduct;
  variant: ProductVariant;
  canSeeCosts: boolean;
  /** A mobile phone: this variation needs its own 15-digit IMEI. */
  requiresImei: boolean;
  onClose: () => void;
}) {
  const update = useUpdateVariation(product.id);
  const generateBarcode = useGenerateBarcode();
  const [stock, setStock] = useState(String(variant.stockQty));
  const [price, setPrice] = useState(toPounds(variant.price));
  const [cost, setCost] = useState(toPounds(variant.costPrice));
  const [barcode, setBarcode] = useState(variant.barcode ?? '');
  const [imei, setImei] = useState(variant.imei ?? '');
  const [lowAlert, setLowAlert] = useState(variant.lowStockAlert);
  const [lowAt, setLowAt] = useState(String(variant.lowStockThreshold));
  // Each optional detail: null = inherited from the parent, a string = this variation's own.
  const [details, setDetails] = useState<Record<Detail, string | null>>({
    name: variant.name,
    description: variant.description,
    tag: variant.tag,
    compatibility: variant.compatibility,
    supplier: variant.supplier,
  });
  const [ownImages, setOwnImages] = useState<string[] | null>(
    variant.images.length > 0 ? variant.images : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () => {
    const next: Record<string, string> = {};
    const s = parseCount(stock);
    const p = parsePounds(price);
    const c = canSeeCosts ? parsePounds(cost) : variant.costPrice;
    const t = parseCount(lowAt);
    if (s === null) next.stock = 'Stock is required (0 is fine)';
    if (p === null || p <= 0) next.price = 'Selling price is required';
    if (c === null) next.cost = 'Cost price is required';
    if (lowAlert && (t === null || t < 1)) next.lowAt = 'Enter 1 or more';
    if (requiresImei && !imei.trim()) next.imei = 'The IMEI is required for a phone';
    else if (imei.trim() && !/^\d{15}$/.test(imei.trim())) next.imei = 'An IMEI is 15 digits';
    for (const d of DETAILS) {
      const val = details[d.key];
      if (val !== null && !(d.key === 'description' ? val.replace(/<[^>]*>/g, '') : val).trim()) {
        next[d.key] = `Enter the ${d.label.toLowerCase()}, or use the parent’s`;
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const edit: VariationEdit = {
      stockQty: s!,
      price: p!,
      ...(canSeeCosts ? { costPrice: c! } : {}),
      barcode: barcode.trim() || null,
      ...(requiresImei || variant.imei ? { imei: imei.trim() || null } : {}),
      lowStockAlert: lowAlert,
      ...(lowAlert ? { lowStockThreshold: t! } : {}),
      name: details.name?.trim() ?? null,
      tag: details.tag?.trim() ?? null,
      compatibility: details.compatibility?.trim() ?? null,
      supplier: details.supplier?.trim() ?? null,
      description: details.description === null ? null : sanitizeHtml(details.description),
      images: ownImages ? { mode: 'replace', urls: ownImages } : { mode: 'inherit', urls: [] },
    };
    update.mutate(
      { variantId: variant.id, edit },
      {
        onSuccess: () => {
          toast(`${variant.label} saved`);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !update.isPending ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{variant.label}</DialogTitle>
          <DialogDescription>
            Stock, selling price and cost price are required. Everything else follows {product.name}{' '}
            unless you give this variation its own.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Stock" htmlFor="ve-stock" error={errors.stock}>
              <Input
                id="ve-stock"
                inputMode="numeric"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="tabular"
              />
            </Field>
            <Field label="Selling price (£)" htmlFor="ve-price" error={errors.price}>
              <Input
                id="ve-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="tabular"
              />
            </Field>
            {canSeeCosts ? (
              <Field label="Cost price (£)" htmlFor="ve-cost" error={errors.cost}>
                <Input
                  id="ve-cost"
                  inputMode="decimal"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className="tabular"
                />
              </Field>
            ) : null}
          </div>

          {requiresImei ? (
            <Field
              label="IMEI"
              htmlFor="ve-imei"
              error={errors.imei}
              hint="Required for a phone — 15 digits, and this handset's own."
            >
              <Input
                id="ve-imei"
                inputMode="numeric"
                maxLength={15}
                value={imei}
                onChange={(e) => setImei(e.target.value.replace(/\D/g, ''))}
                className="tabular"
                placeholder="15-digit IMEI"
              />
            </Field>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Barcode"
              htmlFor="ve-barcode"
              hint="Optional, and this variation’s own — never copied from the parent."
            >
              <div className="flex gap-2">
                <Input
                  id="ve-barcode"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  className="tabular min-w-0 flex-1"
                  placeholder="EAN / UPC"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={generateBarcode.isPending}
                  onClick={async () => {
                    const code = await generateBarcode.mutateAsync().catch(() => null);
                    if (code) setBarcode(code);
                  }}
                >
                  Generate
                </Button>
              </div>
            </Field>
            <Field label="Low-stock warning" htmlFor="ve-low" error={errors.lowAt}>
              <div className="flex h-11 items-center gap-2 text-sm">
                <input
                  id="ve-low"
                  type="checkbox"
                  checked={lowAlert}
                  onChange={(e) => setLowAlert(e.target.checked)}
                  className="accent-[var(--red)]"
                />
                <label htmlFor="ve-low">Warn at or below</label>
                <Input
                  aria-label="Low-stock level"
                  inputMode="numeric"
                  value={lowAt}
                  disabled={!lowAlert}
                  onChange={(e) => setLowAt(e.target.value)}
                  className="tabular h-9 w-16"
                />
              </div>
            </Field>
          </div>

          {/* Client changes, Oct 2026 #8: more barcodes on this variation (0122). Saved at once. */}
          <ExtraBarcodes
            productId={product.id}
            variantId={variant.id}
            barcodes={variant.extraBarcodes ?? []}
          />

          <div className="border-line grid gap-3 border-t pt-4">
            {DETAILS.map((d) => (
              <InheritedField
                key={d.key}
                label={d.label}
                parentValue={parentDetail(product, d.key)}
                value={details[d.key]}
                error={errors[d.key]}
                rich={d.key === 'description'}
                onChange={(v) => setDetails((cur) => ({ ...cur, [d.key]: v }))}
              />
            ))}

            <div className="grid gap-2">
              <InheritHeader
                label="Pictures"
                custom={ownImages !== null}
                onCustomise={() => setOwnImages([])}
                onInherit={() => setOwnImages(null)}
              />
              {ownImages !== null ? (
                <VariationImagesInput urls={ownImages} onChange={setOwnImages} />
              ) : (
                <div className="flex flex-wrap gap-2 opacity-60">
                  {product.images.length === 0 ? (
                    <span className="text-muted text-xs">The parent has no pictures yet.</span>
                  ) : (
                    product.images.map((url) => (
                      <div
                        key={url}
                        className="border-line relative size-16 overflow-hidden rounded-md border bg-white"
                      >
                        <Image src={url} alt="" fill sizes="64px" className="object-cover" />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="animate-spin" /> : null}
            Save variation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InheritHeader({
  label,
  custom,
  onCustomise,
  onInherit,
}: {
  label: string;
  custom: boolean;
  onCustomise: () => void;
  onInherit: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]">
        {label}
      </span>
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
          custom ? 'bg-red text-white' : 'bg-paper-2 text-muted',
        )}
      >
        {custom ? 'Custom' : 'Inherited from parent'}
      </span>
      <button
        type="button"
        onClick={custom ? onInherit : onCustomise}
        className="text-muted hover:text-ink ml-auto text-xs underline underline-offset-2"
      >
        {custom ? 'Use the parent’s' : 'Give it its own'}
      </button>
    </div>
  );
}

function InheritedField({
  label,
  parentValue,
  value,
  error,
  rich,
  onChange,
}: {
  label: string;
  parentValue: string;
  value: string | null;
  error?: string;
  rich?: boolean;
  onChange: (value: string | null) => void;
}) {
  const custom = value !== null;
  return (
    <div className="grid gap-1.5">
      <InheritHeader
        label={label}
        custom={custom}
        onCustomise={() => onChange(parentValue)}
        onInherit={() => onChange(null)}
      />
      {custom ? (
        rich ? (
          <RichTextEditor value={value} onChange={(html) => onChange(html)} />
        ) : (
          <Input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        )
      ) : rich ? (
        <div
          className="border-line text-muted rounded-ui max-h-24 overflow-hidden border px-3 py-2 text-sm"
          dangerouslySetInnerHTML={{ __html: parentValue || '<em>Nothing yet</em>' }}
        />
      ) : (
        <Input value={parentValue} disabled aria-label={`${label} (from the parent)`} />
      )}
      {error ? <p className="text-red-deep text-xs font-medium">{error}</p> : null}
    </div>
  );
}

/* ---- Many variations at once ------------------------------------------------------------------ */

/**
 * Apply the same values to every selected variation (spec §6.3). Only what is filled in changes.
 * Barcode is not offered: every variation needs its own.
 */
function BulkEditDialog({
  product,
  variants,
  canSeeCosts,
  onClose,
}: {
  product: AdminProduct;
  variants: ProductVariant[];
  canSeeCosts: boolean;
  onClose: (done: boolean) => void;
}) {
  const bulk = useBulkUpdateVariations(product.id);
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [active, setActive] = useState<'' | 'on' | 'off'>('');
  const [text, setText] = useState<Record<Detail, string>>({
    name: '',
    description: '',
    tag: '',
    compatibility: '',
    supplier: '',
  });
  const [reset, setReset] = useState<Set<Detail>>(new Set());
  const [images, setImages] = useState<string[]>([]);
  const [imageMode, setImageMode] = useState<'add' | 'replace' | 'inherit' | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<VariationEdit | null>(null);

  const includesDefault = variants.some((v) => v.isDefault);

  const build = (): VariationEdit | null => {
    const edit: VariationEdit = {};
    if (price.trim()) {
      const p = parsePounds(price);
      if (p === null || p <= 0) return (setError('That selling price isn’t a price.'), null);
      edit.price = p;
    }
    if (canSeeCosts && cost.trim()) {
      const c = parsePounds(cost);
      if (c === null) return (setError('That cost price isn’t a price.'), null);
      edit.costPrice = c;
    }
    if (stock.trim()) {
      const s = parseCount(stock);
      if (s === null) return (setError('Stock is a whole number (0 is fine).'), null);
      edit.stockQty = s;
    }
    if (active === 'on') edit.isActive = true;
    if (active === 'off') {
      if (includesDefault) {
        return (setError('The default variation is selected — it can’t be disabled.'), null);
      }
      edit.isActive = false;
    }
    for (const d of DETAILS) {
      if (reset.has(d.key)) edit[d.key] = null;
      else {
        const v =
          d.key === 'description' ? text[d.key].replace(/<[^>]*>/g, '').trim() : text[d.key].trim();
        if (v)
          edit[d.key] = d.key === 'description' ? sanitizeHtml(text[d.key]) : text[d.key].trim();
      }
    }
    if (imageMode === 'inherit') edit.images = { mode: 'inherit', urls: [] };
    else if (imageMode && images.length > 0) edit.images = { mode: imageMode, urls: images };
    else if (imageMode && images.length === 0) {
      return (setError('Upload the pictures to apply, or choose “Use the parent’s”.'), null);
    }
    if (Object.keys(edit).length === 0)
      return (setError('Fill in at least one thing to change.'), null);
    setError(null);
    return edit;
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => (!open && !bulk.isPending ? onClose(false) : undefined)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Edit {variants.length} variation{variants.length === 1 ? '' : 's'}
            </DialogTitle>
            <DialogDescription>
              Only what you fill in changes — everything else stays as it is on each variation.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <p className="text-muted text-xs">
              {variants
                .slice(0, 8)
                .map((v) => v.label)
                .join(' · ')}
              {variants.length > 8 ? ` · and ${variants.length - 8} more` : ''}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Selling price (£)" htmlFor="b-price">
                <Input
                  id="b-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Leave as is"
                  className="tabular"
                />
              </Field>
              {canSeeCosts ? (
                <Field label="Cost price (£)" htmlFor="b-cost">
                  <Input
                    id="b-cost"
                    inputMode="decimal"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="Leave as is"
                    className="tabular"
                  />
                </Field>
              ) : null}
              <Field label="Stock" htmlFor="b-stock">
                <Input
                  id="b-stock"
                  inputMode="numeric"
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                  placeholder="Leave as is"
                  className="tabular"
                />
              </Field>
            </div>

            <Field label="On sale">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['', 'Leave as is'],
                    ['on', 'Enable'],
                    ['off', 'Disable'],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setActive(k)}
                    aria-pressed={active === k}
                    className={cn(
                      'border-line rounded-full border px-3 py-1.5 text-xs font-semibold',
                      active === k && 'border-ink bg-ink text-paper',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>

            {DETAILS.map((d) => (
              <div key={d.key} className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]">
                    {d.label}
                  </span>
                  <label className="text-muted ml-auto flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={reset.has(d.key)}
                      onChange={(e) =>
                        setReset((r) => {
                          const next = new Set(r);
                          if (e.target.checked) next.add(d.key);
                          else next.delete(d.key);
                          return next;
                        })
                      }
                      className="accent-[var(--red)]"
                    />
                    Use the parent’s
                  </label>
                </div>
                {reset.has(d.key) ? null : d.key === 'description' ? (
                  <RichTextEditor
                    value={text.description}
                    onChange={(html) => setText((t) => ({ ...t, description: html }))}
                    placeholder="Leave as is"
                  />
                ) : (
                  <Input
                    aria-label={d.label}
                    value={text[d.key]}
                    onChange={(e) => setText((t) => ({ ...t, [d.key]: e.target.value }))}
                    placeholder="Leave as is"
                  />
                )}
              </div>
            ))}

            <Field label="Pictures">
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['', 'Leave as is'],
                      ['add', 'Add to their pictures'],
                      ['replace', 'Replace their pictures'],
                      ['inherit', 'Use the parent’s'],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setImageMode(k)}
                      aria-pressed={imageMode === k}
                      className={cn(
                        'border-line rounded-full border px-3 py-1.5 text-xs font-semibold',
                        imageMode === k && 'border-ink bg-ink text-paper',
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {imageMode === 'add' || imageMode === 'replace' ? (
                  <VariationImagesInput urls={images} onChange={setImages} />
                ) : null}
              </div>
            </Field>

            {error ? (
              <p role="alert" className="text-red-deep text-xs font-semibold">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onClose(false)}
              disabled={bulk.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const edit = build();
                if (edit) setConfirming(edit);
              }}
              disabled={bulk.isPending}
            >
              Apply to {variants.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => (!open ? setConfirming(null) : undefined)}
        title={`This will update ${variants.length} variation${variants.length === 1 ? '' : 's'}`}
        description="Only the things you filled in change."
        confirmLabel="Update them"
        loading={bulk.isPending}
        onConfirm={() =>
          confirming &&
          bulk.mutate(
            { variantIds: variants.map((v) => v.id), edit: confirming },
            {
              onSuccess: () => {
                toast(`${variants.length} variation${variants.length === 1 ? '' : 's'} updated`);
                setConfirming(null);
                onClose(true);
              },
            },
          )
        }
      />
    </>
  );
}
