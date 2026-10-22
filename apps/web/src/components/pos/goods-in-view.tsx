'use client';

import { useMemo, useState } from 'react';
import { Link2, PackagePlus, Plus, ScanBarcode, Search, X } from 'lucide-react';
import {
  useAdminCategories,
  useAdminProducts,
  useCreateGoodsInProduct,
  useCreateStockIntake,
  useDismissToLinkBarcode,
  useLinkToLinkBarcode,
  useLookupBarcode,
  useProductVariants,
  useTillStockIntakes,
  useToLinkBarcodes,
} from '@/lib/data/hooks';
import type { AdminProduct, GoodsInLineInput, ToLinkBarcode } from '@/lib/data/types';
import { formatGBP, pounds } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { useBarcodeScan } from '@/lib/scanner/use-barcode-scan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';

/**
 * Goods in — booking a supplier delivery in at the till (0103, 0108, 0123).
 *
 * Client changes, Oct 2026 #8. Scan a barcode or search by name to add the products that arrived,
 * with how many and (optionally) what each cost; booking in adds them to stock. A barcode nothing
 * has yet can be put on a product we already have, on a new product made right here (name,
 * category, price), or saved to the "to link" list below — no stock moves for those until someone
 * links them to their product. Every barcode registered this way is in the admin panel's barcode
 * register. One optional price for the whole delivery and the supplier details are as before.
 *
 * Costs can be typed by anyone booking a delivery in; nobody without costs.view reads one back.
 */

type Line =
  | {
      key: string;
      kind: 'product';
      product: AdminProduct;
      variantId: string | null;
      qty: string;
      cost: string;
      /** A barcode scanned that nothing had, to be registered on this product. */
      registerBarcode?: string;
    }
  | { key: string; kind: 'barcode'; barcode: string; name: string; qty: string; cost: string };

let seq = 0;
const nextKey = () => `l${(seq += 1)}`;

const WHOLE = /^[0-9]+$/;
const MONEY = /^[0-9]+([.][0-9]{1,2})?$/;

/** A scan types into whatever box has focus; take the code back out of it. */
const stripScan = (value: string, code: string) =>
  value.endsWith(code) ? value.slice(0, -code.length) : value;

/** Products the search box finds: name, short line, or any barcode they scan as. */
function matches(products: AdminProduct[] | undefined, text: string): AdminProduct[] {
  const q = text.trim().toLowerCase();
  if (!q || !products) return [];
  return products
    .filter((p) => p.isActive !== false)
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sub.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q) ||
        (p.variationBarcodes ?? []).some((b) => b.includes(q)) ||
        (p.extraBarcodes ?? []).some((b) => b.barcode.includes(q)),
    )
    .slice(0, 8);
}

export function GoodsInView() {
  const create = useCreateStockIntake();
  const recent = useTillStockIntakes();
  const products = useAdminProducts();
  const lookup = useLookupBarcode();

  const [lines, setLines] = useState<Line[]>([]);
  const [find, setFind] = useState('');
  /** A barcode that nothing in the shop has: what is it? */
  const [unknown, setUnknown] = useState<string | null>(null);
  const [unknownMode, setUnknownMode] = useState<'ask' | 'existing' | 'new'>('ask');
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [findNote, setFindNote] = useState<string | null>(null);

  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const addProduct = (
    product: AdminProduct,
    variantId: string | null,
    registerBarcode?: string,
  ) => {
    setLines((current) => {
      // The same thing scanned again: one more on its line, rather than a second line.
      const same = current.find(
        (l) =>
          l.kind === 'product' &&
          l.product.id === product.id &&
          l.variantId === variantId &&
          !registerBarcode &&
          !l.registerBarcode,
      );
      // Only when the line is complete: a variation product picked by name still needs its variation.
      const complete = product.hasVariants ? variantId !== null : true;
      if (same && complete) {
        return current.map((l) =>
          l.key === same.key && WHOLE.test(l.qty) ? { ...l, qty: String(Number(l.qty) + 1) } : l,
        );
      }
      return [
        ...current,
        {
          key: nextKey(),
          kind: 'product',
          product,
          variantId,
          qty: '1',
          cost: '',
          registerBarcode,
        },
      ];
    });
    setFind('');
    setFindNote(null);
  };

  const resolveCode = async (code: string) => {
    setFindNote(null);
    const found = await lookup.mutateAsync(code).catch(() => undefined);
    if (found === undefined) {
      setFindNote(`Couldn’t look up ${code}. Check the connection.`);
      return;
    }
    if (found) {
      addProduct(found, found.matchedVariant?.id ?? null);
      return;
    }
    setUnknown(code);
    setUnknownMode('ask');
    setFind('');
  };

  useBarcodeScan((code) => {
    // The scan's characters reached whatever box had focus; take them back out.
    setFind((v) => stripScan(v, code));
    setLines((current) =>
      current.map((l) => ({
        ...l,
        qty: stripScan(l.qty, code),
        cost: stripScan(l.cost, code),
        ...(l.kind === 'barcode' ? { name: stripScan(l.name, code) } : {}),
      })),
    );
    setSupplierName((v) => stripScan(v, code));
    setSupplierRef((v) => stripScan(v, code));
    setNotes((v) => stripScan(v, code));
    setPrice((v) => stripScan(v, code));
    void resolveCode(code);
  });

  const found = useMemo(() => matches(products.data, find), [products.data, find]);

  const update = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((l) => (l.key === key ? ({ ...l, ...patch } as Line) : l)));
  const remove = (key: string) => setLines((current) => current.filter((l) => l.key !== key));

  const units = lines.reduce((n, l) => n + (WHOLE.test(l.qty.trim()) ? Number(l.qty) : 0), 0);

  const submit = () => {
    const next: Record<string, string> = {};
    for (const l of lines) {
      const q = l.qty.trim();
      if (!WHOLE.test(q) || Number(q) <= 0) next[`${l.key}:qty`] = 'A positive number';
      if (l.cost.trim() && !MONEY.test(l.cost.trim())) next[`${l.key}:cost`] = 'Pounds, e.g. 2.50';
      if (l.kind === 'product' && l.product.hasVariants && !l.variantId) {
        next[`${l.key}:variant`] = 'Choose which variation arrived';
      }
    }
    const p = price.trim();
    if (p && !MONEY.test(p)) next.price = 'Pounds, e.g. 125.50, or leave it blank';
    setErrors(next);
    if (lines.length === 0) {
      setFormError('Scan or search for at least one item.');
      return;
    }
    setFormError(Object.keys(next).length ? 'Check the highlighted fields.' : null);
    if (Object.keys(next).length) return;

    const cost = (v: string) => (v.trim() ? pounds(Number(v.trim())) : null);
    const payload: GoodsInLineInput[] = lines.map((l) =>
      l.kind === 'product'
        ? {
            type: 'product',
            productId: l.product.id,
            variantId: l.variantId,
            qty: Number(l.qty.trim()),
            unitCost: cost(l.cost),
            ...(l.registerBarcode ? { registerBarcode: l.registerBarcode } : {}),
          }
        : {
            type: 'barcode',
            barcode: l.barcode,
            ...(l.name.trim() ? { name: l.name.trim() } : {}),
            qty: Number(l.qty.trim()),
            unitCost: cost(l.cost),
          },
    );

    create.mutate(
      {
        supplierName: supplierName.trim() || undefined,
        supplierRef: supplierRef.trim() || null,
        notes: notes.trim() || undefined,
        lines: payload,
        price: p ? pounds(Number(p)) : null,
      },
      {
        onSuccess: () => {
          setLines([]);
          setSupplierRef('');
          setNotes('');
          setPrice('');
          setErrors({});
          setFormError(null);
        },
        onError: (error) => setFormError(error.message),
      },
    );
  };

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-ink text-xl font-extrabold uppercase">Goods in</h1>
        <p className="text-muted text-sm">
          Scan or search for what arrived, say how many, and book it in. It goes straight into
          stock.
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
          <Field
            label="Reference No. (optional)"
            htmlFor="gi-ref"
            hint="Invoice or delivery note number"
          >
            <Input
              id="gi-ref"
              value={supplierRef}
              onChange={(e) => setSupplierRef(e.target.value)}
            />
          </Field>
        </div>

        {/* Find: scan, or type a name or a barcode. */}
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <ScanBarcode
                className="text-muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                autoFocus
                value={find}
                onChange={(e) => {
                  setFind(e.target.value);
                  setFindNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const text = find.trim();
                  if (found.length === 1) addProduct(found[0]!, null);
                  else if (text && !text.includes(' ')) void resolveCode(text);
                }}
                placeholder="Scan a barcode, or search by name or barcode"
                aria-label="Find a product"
                className="pl-9"
              />
            </div>
            <Button type="button" variant="outline" onClick={() => setNewProductOpen(true)}>
              <Plus aria-hidden="true" /> New product
            </Button>
          </div>
          {findNote ? <p className="text-red-deep text-xs font-medium">{findNote}</p> : null}
          {find.trim() && found.length > 0 ? (
            <ul className="border-line grid max-h-64 overflow-y-auto rounded-md border">
              {found.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addProduct(p, null)}
                    className="hover:bg-paper-2 flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm"
                  >
                    <span className="text-ink font-semibold">
                      {p.name}
                      {p.hasVariants ? (
                        <span className="text-muted font-normal">
                          {' '}
                          · {p.variationCount} variations
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted tabular text-xs">{p.barcode ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : find.trim() && products.data ? (
            <p className="text-muted text-xs">
              Nothing matches. Press Enter to look it up as a barcode, or add a New product.
            </p>
          ) : null}
        </div>

        {unknown ? (
          <UnknownBarcode
            barcode={unknown}
            mode={unknownMode}
            onMode={setUnknownMode}
            products={products.data}
            onPickProduct={(p) => {
              addProduct(p, null, unknown);
              setUnknown(null);
            }}
            onCreated={(p) => {
              addProduct(p, null, p.barcode ?? unknown);
              setUnknown(null);
            }}
            onLater={() => {
              setLines((current) => [
                ...current,
                { key: nextKey(), kind: 'barcode', barcode: unknown, name: '', qty: '1', cost: '' },
              ]);
              setUnknown(null);
            }}
            onCancel={() => setUnknown(null)}
          />
        ) : null}

        {newProductOpen ? (
          <NewProductForm
            onCreated={(p) => {
              addProduct(p, null, p.barcode ?? undefined);
              setNewProductOpen(false);
            }}
            onCancel={() => setNewProductOpen(false)}
          />
        ) : null}

        <div className="grid gap-2">
          <span className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]">
            In this delivery
          </span>
          {lines.length === 0 ? (
            <p className="text-muted text-sm">Nothing yet. Scan the first item.</p>
          ) : (
            lines.map((l) => (
              <LineRow
                key={l.key}
                line={l}
                errors={errors}
                onChange={(patch) => update(l.key, patch)}
                onRemove={() => remove(l.key)}
              />
            ))
          )}
        </div>

        <Field label="Notes" htmlFor="gi-notes">
          <Input
            id="gi-notes"
            value={notes}
            placeholder="Anything worth knowing about this delivery (optional)"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <Field
          label="Price (£)"
          htmlFor="gi-price"
          error={errors.price}
          hint="What the whole delivery cost (optional)"
        >
          <Input
            id="gi-price"
            className="tabular max-w-[200px]"
            inputMode="decimal"
            value={price}
            placeholder="0.00"
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>

        {formError ? (
          <p role="alert" className="text-red-deep text-sm font-medium">
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted tabular text-sm">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'} · {units}{' '}
            {units === 1 ? 'unit' : 'units'}
          </span>
          <Button onClick={submit} disabled={create.isPending}>
            <PackagePlus aria-hidden="true" />
            {create.isPending ? 'Booking in…' : 'Book in'}
          </Button>
        </div>
      </section>

      <ToLinkList products={products.data} />

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
                {i.notes ? <div className="text-muted mt-1 text-xs">Note: {i.notes}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---- one line of the delivery ---------------------------------------------- */

function LineRow({
  line,
  errors,
  onChange,
  onRemove,
}: {
  line: Line;
  errors: Record<string, string>;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const isProduct = line.kind === 'product';
  const variants = useProductVariants(
    isProduct ? line.product.id : '',
    isProduct && line.product.hasVariants,
  );

  return (
    <div className="border-line grid gap-2 rounded-md border p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {isProduct ? (
            <p className="text-ink text-sm font-semibold">{line.product.name}</p>
          ) : (
            <p className="text-ink text-sm font-semibold">
              Barcode <span className="tabular">{line.barcode}</span>{' '}
              <span className="text-warning text-xs font-semibold">· to link later</span>
            </p>
          )}
          {isProduct && line.registerBarcode ? (
            <p className="text-muted text-xs">
              New barcode <span className="tabular">{line.registerBarcode}</span> goes on this
              product
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 p-0"
          aria-label="Remove this line"
          onClick={onRemove}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {isProduct && line.product.hasVariants ? (
          <div className="min-w-[200px] flex-1">
            <Select
              aria-label="Which variation"
              value={line.variantId ?? ''}
              onChange={(e) => onChange({ variantId: e.target.value || null })}
            >
              <option value="">Which variation?</option>
              {(variants.data ?? [])
                .filter((v) => v.isActive)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
            </Select>
            {errors[`${line.key}:variant`] ? (
              <p className="text-red-deep mt-1 text-xs font-medium">
                {errors[`${line.key}:variant`]}
              </p>
            ) : null}
          </div>
        ) : null}
        {line.kind === 'barcode' ? (
          <div className="min-w-[200px] flex-1">
            <Input
              aria-label="What is it"
              value={line.name}
              placeholder="What is it? (optional)"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
        ) : null}
        <div className="w-24">
          <Input
            aria-label="Quantity"
            className="tabular"
            inputMode="numeric"
            value={line.qty}
            placeholder="Qty"
            onChange={(e) => onChange({ qty: e.target.value })}
          />
          {errors[`${line.key}:qty`] ? (
            <p className="text-red-deep mt-1 text-xs font-medium">{errors[`${line.key}:qty`]}</p>
          ) : null}
        </div>
        <div className="w-32">
          <Input
            aria-label="Cost each in pounds"
            className="tabular"
            inputMode="decimal"
            value={line.cost}
            placeholder="Cost each £"
            onChange={(e) => onChange({ cost: e.target.value })}
          />
          {errors[`${line.key}:cost`] ? (
            <p className="text-red-deep mt-1 text-xs font-medium">{errors[`${line.key}:cost`]}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---- a barcode nothing has ------------------------------------------------- */

function UnknownBarcode({
  barcode,
  mode,
  onMode,
  products,
  onPickProduct,
  onCreated,
  onLater,
  onCancel,
}: {
  barcode: string;
  mode: 'ask' | 'existing' | 'new';
  onMode: (mode: 'ask' | 'existing' | 'new') => void;
  products: AdminProduct[] | undefined;
  onPickProduct: (p: AdminProduct) => void;
  onCreated: (p: AdminProduct) => void;
  onLater: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border-warning bg-warning/10 grid gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-ink text-sm font-semibold">
          Nothing has barcode <span className="tabular">{barcode}</span> yet. What is it?
        </p>
        <button type="button" onClick={onCancel} className="text-muted hover:text-ink text-xs">
          Cancel
        </button>
      </div>
      {mode === 'ask' ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => onMode('existing')}>
            <Search aria-hidden="true" /> A product we have
          </Button>
          <Button type="button" variant="outline" onClick={() => onMode('new')}>
            <Plus aria-hidden="true" /> A new product
          </Button>
          <Button type="button" variant="ghost" onClick={onLater}>
            <Link2 aria-hidden="true" /> Don’t know yet: link it later
          </Button>
        </div>
      ) : mode === 'existing' ? (
        <ProductPicker
          products={products}
          onPick={onPickProduct}
          hint="The barcode will be added to the product you pick."
        />
      ) : (
        <NewProductForm barcode={barcode} onCreated={onCreated} onCancel={() => onMode('ask')} />
      )}
    </div>
  );
}

/** Search the shop's products by name or barcode and pick one. */
function ProductPicker({
  products,
  onPick,
  hint,
}: {
  products: AdminProduct[] | undefined;
  onPick: (p: AdminProduct) => void;
  hint?: string;
}) {
  const [text, setText] = useState('');
  const list = useMemo(() => matches(products, text), [products, text]);
  return (
    <div className="grid gap-2">
      <Input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search by name or barcode"
        aria-label="Search for the product"
      />
      {hint ? <p className="text-muted text-xs">{hint}</p> : null}
      {list.length > 0 ? (
        <ul className="border-line bg-card grid max-h-56 overflow-y-auto rounded-md border">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="hover:bg-paper-2 flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm"
              >
                <span className="text-ink font-semibold">{p.name}</span>
                <span className="text-muted tabular text-xs">{p.barcode ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---- the quick "new product" form ------------------------------------------- */

function NewProductForm({
  barcode,
  onCreated,
  onCancel,
}: {
  /** The barcode just scanned, when there is one. */
  barcode?: string;
  onCreated: (p: AdminProduct) => void;
  onCancel: () => void;
}) {
  const categories = useAdminCategories();
  const create = useCreateGoodsInProduct();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [code, setCode] = useState(barcode ?? '');
  const [error, setError] = useState<string | null>(null);

  const labelOf = useMemo(() => {
    const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));
    return (id: string) => {
      const c = byId.get(id);
      if (!c) return '';
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      return parent ? `${parent.label} › ${c.label}` : c.label;
    };
  }, [categories.data]);

  const save = () => {
    if (name.trim().length < 2) return setError('Give it a name.');
    if (!categoryId) return setError('Choose a category.');
    if (!MONEY.test(sellPrice.trim())) return setError('Selling price in pounds, e.g. 9.99');
    setError(null);
    create.mutate(
      {
        name: name.trim(),
        categoryId,
        price: pounds(Number(sellPrice.trim())),
        ...(code.trim() ? { barcode: code.trim() } : { generateBarcode: true }),
      },
      {
        onSuccess: onCreated,
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not create it.'),
      },
    );
  };

  return (
    <div className="border-line bg-card grid gap-3 rounded-md border p-3">
      <p className="text-ink text-sm font-semibold">New product</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="np-name">
          <Input id="np-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="np-category">
          <Select
            id="np-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Choose…</option>
            {(categories.data ?? [])
              .map((c) => ({ id: c.id, label: labelOf(c.id) }))
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Selling price (£)" htmlFor="np-price">
          <Input
            id="np-price"
            className="tabular"
            inputMode="decimal"
            value={sellPrice}
            placeholder="0.00"
            onChange={(e) => setSellPrice(e.target.value)}
          />
        </Field>
        <Field
          label="Barcode"
          htmlFor="np-barcode"
          hint={code.trim() ? undefined : 'Left blank, the shop makes one for it.'}
        >
          <Input
            id="np-barcode"
            className="tabular"
            value={code}
            placeholder="Scan the box, or leave blank"
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      </div>
      <p className="text-muted text-xs">
        It’s added as a till-only product with no stock; the quantity comes with this delivery.
        Photos, a description and putting it online are done later in Inventory.
      </p>
      {error ? (
        <p role="alert" className="text-red-deep text-xs font-medium">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create and add'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ---- the "to link" list ------------------------------------------------------ */

function ToLinkList({ products }: { products: AdminProduct[] | undefined }) {
  const waiting = useToLinkBarcodes();
  const [open, setOpen] = useState<string | null>(null);
  if (!waiting.data || waiting.data.length === 0) return null;
  return (
    <section>
      <h2 className="text-ink mb-1 text-sm font-bold uppercase tracking-[0.06em]">
        Waiting to be linked
      </h2>
      <p className="text-muted mb-2 text-xs">
        Barcodes from deliveries whose product wasn’t known. Their stock is added when you link
        them.
      </p>
      <ul className="grid gap-2">
        {waiting.data.map((w) => (
          <ToLinkRow
            key={w.id}
            item={w}
            products={products}
            open={open === w.id}
            onOpen={() => setOpen(open === w.id ? null : w.id)}
            onDone={() => setOpen(null)}
          />
        ))}
      </ul>
    </section>
  );
}

function ToLinkRow({
  item,
  products,
  open,
  onOpen,
  onDone,
}: {
  item: ToLinkBarcode;
  products: AdminProduct[] | undefined;
  open: boolean;
  onOpen: () => void;
  onDone: () => void;
}) {
  const link = useLinkToLinkBarcode();
  const dismiss = useDismissToLinkBarcode();
  const [picked, setPicked] = useState<AdminProduct | null>(null);
  const [variantId, setVariantId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const variants = useProductVariants(picked?.id ?? '', !!picked?.hasVariants);

  const doLink = () => {
    if (!picked) return;
    if (picked.hasVariants && !variantId) return setError('Choose which variation it is.');
    setError(null);
    link.mutate(
      { id: item.id, productId: picked.id, variantId: variantId || null },
      {
        onSuccess: onDone,
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not link it.'),
      },
    );
  };

  return (
    <li className="border-line bg-card grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-ink font-semibold">
          <span className="tabular">{item.barcode}</span>
          {item.name ? <span className="text-muted font-normal"> · {item.name}</span> : null}
          <span className="text-muted font-normal"> · {item.qty} waiting</span>
        </span>
        <span className="text-muted text-xs">
          {item.intakeReference ?? ''} · {formatDateTime(item.createdAt)} · {item.staffName}
        </span>
      </div>
      {open ? (
        <div className="grid gap-2">
          {picked ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink font-semibold">{picked.name}</span>
              {picked.hasVariants ? (
                <Select
                  aria-label="Which variation"
                  value={variantId}
                  onChange={(e) => setVariantId(e.target.value)}
                  className="max-w-xs"
                >
                  <option value="">Which variation?</option>
                  {(variants.data ?? [])
                    .filter((v) => v.isActive)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                </Select>
              ) : null}
              <Button type="button" onClick={doLink} disabled={link.isPending}>
                {link.isPending ? 'Linking…' : `Link and add ${item.qty} to stock`}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPicked(null)}>
                Pick another
              </Button>
            </div>
          ) : (
            <ProductPicker products={products} onPick={setPicked} />
          )}
          {error ? (
            <p role="alert" className="text-red-deep text-xs font-medium">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onOpen}>
          <Link2 aria-hidden="true" /> {open ? 'Close' : 'Link to a product'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate(item.id)}
        >
          Scanned by mistake
        </Button>
      </div>
    </li>
  );
}
