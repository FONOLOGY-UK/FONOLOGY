'use client';

import { useMemo, useState } from 'react';
import { Minus, PackagePlus, Plus, ScanLine, Search, X } from 'lucide-react';
import {
  useAdminProducts,
  useCreateStockIntake,
  useLookupBarcode,
  useProductVariants,
  useTillStockIntakes,
} from '@/lib/data/hooks';
import type { AdminProduct, ProductVariant } from '@/lib/data/types';
import { formatGBP, pounds } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { useBarcodeScan } from '@/lib/scanner/use-barcode-scan';
import { toast } from '@/lib/stores/toast.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/admin/field';

/**
 * Goods in (0103, Log A) — booking a supplier delivery in at the till. Scan or search each item,
 * set how many arrived, optionally what each cost, and book it in: stock goes up through the
 * normal receipt movement and the delivery is recorded with its supplier and reference.
 *
 * A cost is optional and can be typed by anyone booking stock in; left blank, the product keeps
 * the cost it has. Nobody without costs.view ever sees a cost read back.
 */

interface Line {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  qty: number;
  /** As typed, in pounds. Blank = keep the current cost. */
  unitCost: string;
}

const variantLabel = (v: ProductVariant) => Object.values(v.options).join(', ');

export function GoodsInView() {
  const products = useAdminProducts();
  const lookup = useLookupBarcode();
  const create = useCreateStockIntake();
  const recent = useTillStockIntakes();

  const [lines, setLines] = useState<Line[]>([]);
  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<AdminProduct | null>(null);
  const [costError, setCostError] = useState<string | null>(null);

  const active = useMemo(
    () => (products.data ?? []).filter((p) => p.isActive !== false),
    [products.data],
  );
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return active
      .filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          (p.barcode ?? '').toLowerCase().includes(term) ||
          (p.sub ?? '').toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [active, search]);

  const addLine = (product: { id: string; name: string }, variant: ProductVariant | null) => {
    const key = `${product.id}:${variant?.id ?? ''}`;
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...prev,
        {
          key,
          productId: product.id,
          variantId: variant?.id ?? null,
          name: product.name,
          variantLabel: variant ? variantLabel(variant) : null,
          qty: 1,
          unitCost: '',
        },
      ];
    });
  };

  const choose = (product: AdminProduct) => {
    setSearch('');
    if (product.hasVariants) setPicking(product);
    else addLine(product, null);
  };

  // A scan adds the product (or the exact option whose barcode it is) straight to the delivery.
  useBarcodeScan((code) => {
    lookup.mutate(code, {
      onSuccess: (product) => {
        if (!product) {
          toast(`No product has the barcode ${code}`);
          return;
        }
        if (product.isActive === false) {
          toast(`“${product.name}” is retired — restore it before booking stock in`);
          return;
        }
        if (product.matchedVariant) addLine(product, product.matchedVariant);
        else choose(product);
      },
      onError: () => toast('Could not look that barcode up — try again.'),
    });
  });

  const setQty = (key: string, qty: number) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(1, qty) } : l)));
  const setCost = (key: string, unitCost: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, unitCost } : l)));
  const remove = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const units = lines.reduce((n, l) => n + l.qty, 0);

  const submit = () => {
    const bad = lines.find(
      (l) => l.unitCost.trim() && (!Number.isFinite(Number(l.unitCost)) || Number(l.unitCost) < 0),
    );
    if (bad) {
      setCostError(`Check the cost for ${bad.name} — pounds, e.g. 4.50, or leave it blank.`);
      return;
    }
    setCostError(null);
    create.mutate(
      {
        supplierName: supplierName.trim() || undefined,
        supplierRef: supplierRef.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
          unitCost: l.unitCost.trim() ? pounds(Number(l.unitCost)) : null,
        })),
      },
      {
        onSuccess: () => {
          setLines([]);
          setSupplierRef('');
          setNotes('');
        },
      },
    );
  };

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-ink text-xl font-extrabold uppercase">Goods in</h1>
        <p className="text-muted text-sm">
          Book a delivery in: scan or search each item, set how many arrived, then book it in.
        </p>
      </header>

      <section className="border-line bg-card grid gap-4 rounded-lg border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier" htmlFor="gi-supplier">
            <Input
              id="gi-supplier"
              value={supplierName}
              placeholder="Who it came from"
              onChange={(e) => setSupplierName(e.target.value)}
            />
          </Field>
          <Field label="Their reference" htmlFor="gi-ref" hint="Invoice or delivery note number">
            <Input
              id="gi-ref"
              value={supplierRef}
              onChange={(e) => setSupplierRef(e.target.value)}
            />
          </Field>
        </div>

        <div className="relative">
          <Field label="Add an item" htmlFor="gi-search">
            <div className="relative">
              <Search className="text-muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                id="gi-search"
                className="pl-9"
                value={search}
                placeholder="Search by name or barcode — or just scan it"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </Field>
          {matches.length > 0 ? (
            <ul className="border-line bg-card absolute z-10 mt-1 w-full overflow-hidden rounded-md border shadow-lg">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="hover:bg-paper-2 flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                    onClick={() => choose(p)}
                  >
                    <span>
                      <span className="text-ink font-semibold">{p.name}</span>
                      {p.hasVariants ? <span className="text-muted"> · choose option</span> : null}
                    </span>
                    <span className="text-muted tabular text-xs">
                      {p.hasVariants ? '' : `${p.stockQty} in stock`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {lines.length === 0 ? (
          <div className="border-line text-muted flex items-center gap-2 rounded-md border border-dashed p-6 text-sm">
            <ScanLine className="size-4" aria-hidden="true" />
            Nothing added yet. Scan a barcode or search above.
          </div>
        ) : (
          <div className="grid gap-2">
            {lines.map((l) => (
              <div
                key={l.key}
                className="border-line flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-ink truncate text-sm font-semibold">{l.name}</div>
                  {l.variantLabel ? (
                    <div className="text-muted text-xs">{l.variantLabel}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="size-8 p-0"
                    aria-label={`One fewer ${l.name}`}
                    onClick={() => setQty(l.key, l.qty - 1)}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <Input
                    className="tabular h-8 w-16 text-center"
                    inputMode="numeric"
                    aria-label={`How many ${l.name}`}
                    value={l.qty}
                    onChange={(e) => setQty(l.key, Number(e.target.value.replace(/\D/g, '')) || 1)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="size-8 p-0"
                    aria-label={`One more ${l.name}`}
                    onClick={() => setQty(l.key, l.qty + 1)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <Input
                  className="tabular h-8 w-32"
                  inputMode="decimal"
                  placeholder="Cost each £"
                  aria-label={`Cost each for ${l.name}, optional`}
                  value={l.unitCost}
                  onChange={(e) => setCost(l.key, e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => remove(l.key)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <p className="text-muted text-xs">
              Leave a cost blank to keep what the item already costs.
            </p>
          </div>
        )}

        <Field label="Notes" htmlFor="gi-notes">
          <Input
            id="gi-notes"
            value={notes}
            placeholder="Anything worth knowing about this delivery (optional)"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {costError ? (
          <p role="alert" className="text-red-deep text-sm font-medium">
            {costError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted tabular text-sm">
            {lines.length} {lines.length === 1 ? 'item' : 'items'} · {units}{' '}
            {units === 1 ? 'unit' : 'units'}
          </span>
          <Button onClick={submit} disabled={lines.length === 0 || create.isPending}>
            <PackagePlus aria-hidden="true" />
            {create.isPending ? 'Booking in…' : 'Book in'}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="text-ink mb-2 text-sm font-bold uppercase tracking-[0.06em]">
          Recent deliveries
        </h2>
        {recent.isPending ? (
          <Skeleton className="h-24" />
        ) : (recent.data ?? []).length === 0 ? (
          <p className="text-muted text-sm">No deliveries booked in at this shop yet.</p>
        ) : (
          <ul className="grid gap-2">
            {recent.data!.map((i) => (
              <li key={i.id} className="border-line bg-card rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="tabular font-bold">{i.reference}</span>
                  <span className="text-muted tabular text-xs">{formatDateTime(i.createdAt)}</span>
                </div>
                <div className="text-muted text-xs">
                  {[i.supplierName, i.supplierRef].filter(Boolean).join(' · ') || 'No supplier'} ·{' '}
                  {i.unitCount} {i.unitCount === 1 ? 'unit' : 'units'} · {i.staffName}
                  {i.totalCost !== null ? ` · ${formatGBP(i.totalCost)}` : ''}
                </div>
                <div className="text-ink mt-1 text-xs">
                  {i.lines
                    .map(
                      (l) => `${l.qty} × ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''}`,
                    )
                    .join(', ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <VariantPicker
        product={picking}
        onClose={() => setPicking(null)}
        onPick={(variant) => {
          if (picking) addLine(picking, variant);
          setPicking(null);
        }}
      />
    </div>
  );
}

/** Which option of a product arrived. Every active option is offered — out of stock included. */
function VariantPicker({
  product,
  onClose,
  onPick,
}: {
  product: AdminProduct | null;
  onClose: () => void;
  onPick: (variant: ProductVariant) => void;
}) {
  const variants = useProductVariants(product?.id ?? '', product !== null);
  const options = (variants.data ?? []).filter((v) => v.isActive);
  return (
    <Dialog open={product !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product?.name}</DialogTitle>
          <DialogDescription>Which option arrived?</DialogDescription>
        </DialogHeader>
        {variants.isPending ? (
          <Skeleton className="h-24" />
        ) : options.length === 0 ? (
          <p className="text-muted text-sm">This product has no active options.</p>
        ) : (
          <ul className="grid gap-1.5">
            {options.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className="border-line hover:bg-paper-2 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm"
                  onClick={() => onPick(v)}
                >
                  <span className="text-ink font-semibold">{variantLabel(v)}</span>
                  <span className="text-muted tabular text-xs">{v.stockQty} in stock</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
