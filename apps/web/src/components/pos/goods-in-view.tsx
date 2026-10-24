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
import type {
  AdminProduct,
  GoodsInCreatedProduct,
  GoodsInLineInput,
  ToLinkBarcode,
} from '@/lib/data/types';
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
 * Client bug report, 24 Oct 2026: every box on a line has a label that stays put (2.1); a product
 * line takes any number of extra barcodes, scanned or typed, all registered on it when booked in
 * (2.2, 0124); a new mobile phone asks for one IMEI per handset and becomes one variation each (3).
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
      /** Barcodes nothing had yet, scanned or typed, to be registered on this product (0124). */
      barcodes: string[];
      /** What is typed in the line's "add a barcode" box. */
      newBarcode: string;
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
    barcodes: string[] = [],
    qty = '1',
  ) => {
    setLines((current) => {
      const same = current.find(
        (l) => l.kind === 'product' && l.product.id === product.id && l.variantId === variantId,
      );
      // A new barcode for something already on the delivery goes on its line.
      if (same && barcodes.length > 0) {
        return current.map((l) =>
          l.key === same.key && l.kind === 'product'
            ? { ...l, barcodes: [...new Set([...l.barcodes, ...barcodes])] }
            : l,
        );
      }
      // The same thing scanned again: one more on its line, rather than a second line. Only when
      // the line is complete: a variation product picked by name still needs its variation.
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
          qty,
          cost: '',
          barcodes,
          newBarcode: '',
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

  /**
   * A box that takes a scan as its own text is focused (a line's "add a barcode" box, or the new
   * product form with its barcode and IMEI boxes): the page-wide scan lookup stands aside, so the
   * code simply lands in that box and Enter there decides what happens.
   */
  const [scanIntoBox, setScanIntoBox] = useState(false);
  const boxFocus = {
    onFocus: () => setScanIntoBox(true),
    onBlur: () => setScanIntoBox(false),
  };

  useBarcodeScan(
    (code) => {
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
    },
    { enabled: !scanIntoBox },
  );

  /** Every barcode already named somewhere on this delivery. */
  const onDelivery = (code: string) =>
    lines.some((l) => (l.kind === 'product' ? l.barcodes.includes(code) : l.barcode === code));

  /** A line's "add a barcode" box: check the code is free, then put it on the line. */
  const addBarcode = async (key: string) => {
    const line = lines.find((l) => l.key === key);
    if (!line || line.kind !== 'product') return;
    const code = line.newBarcode.trim();
    const fail = (message: string) => setErrors((e) => ({ ...e, [`${key}:barcode`]: message }));
    setErrors((e) => {
      const next = { ...e };
      delete next[`${key}:barcode`];
      return next;
    });
    if (!code) return;
    if (onDelivery(code)) return fail(`${code} is already on this delivery.`);
    const owner = await lookup.mutateAsync(code).catch(() => undefined);
    if (owner === undefined) return fail(`Couldn’t check ${code}. Check the connection.`);
    if (owner) {
      return fail(
        owner.id === line.product.id
          ? `${code} already finds ${owner.name}.`
          : `${code} is already on ${owner.name}.`,
      );
    }
    update(key, { barcodes: [...line.barcodes, code], newBarcode: '' });
  };

  /** What the quick form made goes on the delivery: a new phone as one line per handset. */
  const addCreated = (p: GoodsInCreatedProduct, code?: string) => {
    if (p.handsets.length > 0) {
      p.handsets.forEach((h, i) => addProduct(p, h.variantId, i === 0 && code ? [code] : []));
    } else {
      addProduct(p, null, code ? [code] : []);
    }
  };

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
            ...(l.barcodes.length ? { registerBarcodes: l.barcodes } : {}),
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
            boxFocus={boxFocus}
            onPickProduct={(p) => {
              addProduct(p, null, [unknown]);
              setUnknown(null);
            }}
            onCreated={(p) => {
              addCreated(p, unknown);
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
            boxFocus={boxFocus}
            onCreated={(p) => {
              addCreated(p, p.barcode ?? undefined);
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
                boxFocus={boxFocus}
                onChange={(patch) => update(l.key, patch)}
                onAddBarcode={() => void addBarcode(l.key)}
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

/** Focus handlers that make the page-wide scan lookup stand aside (see GoodsInView). */
type BoxFocus = { onFocus: () => void; onBlur: () => void };

function LineRow({
  line,
  errors,
  boxFocus,
  onChange,
  onAddBarcode,
  onRemove,
}: {
  line: Line;
  errors: Record<string, string>;
  boxFocus: BoxFocus;
  onChange: (patch: Partial<Line>) => void;
  onAddBarcode: () => void;
  onRemove: () => void;
}) {
  const isProduct = line.kind === 'product';
  const variants = useProductVariants(
    isProduct ? line.product.id : '',
    isProduct && line.product.hasVariants,
  );
  const id = (field: string) => `gi-${line.key}-${field}`;

  return (
    <div className="border-line grid gap-3 rounded-md border p-2.5">
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
      {/* Every box keeps its label above it, so a typed number never loses its meaning (2.1). */}
      <div className="flex flex-wrap items-start gap-3">
        {isProduct && line.product.hasVariants ? (
          <Field
            label="Variation"
            htmlFor={id('variant')}
            error={errors[`${line.key}:variant`]}
            className="min-w-[200px] flex-1"
          >
            <Select
              id={id('variant')}
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
          </Field>
        ) : null}
        {line.kind === 'barcode' ? (
          <Field
            label="What is it? (optional)"
            htmlFor={id('name')}
            className="min-w-[200px] flex-1"
          >
            <Input
              id={id('name')}
              value={line.name}
              placeholder="e.g. Blue USB-C cable"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>
        ) : null}
        <Field
          label="Quantity"
          htmlFor={id('qty')}
          error={errors[`${line.key}:qty`]}
          className="w-28"
        >
          <Input
            id={id('qty')}
            className="tabular"
            inputMode="numeric"
            value={line.qty}
            onChange={(e) => onChange({ qty: e.target.value })}
          />
        </Field>
        <Field
          label="Cost each (£)"
          htmlFor={id('cost')}
          error={errors[`${line.key}:cost`]}
          className="w-36"
        >
          <Input
            id={id('cost')}
            className="tabular"
            inputMode="decimal"
            value={line.cost}
            placeholder="Optional"
            onChange={(e) => onChange({ cost: e.target.value })}
          />
        </Field>
      </div>
      {isProduct ? (
        <Field
          label="New barcodes for this product"
          htmlFor={id('barcode')}
          error={errors[`${line.key}:barcode`]}
          hint="Scan or type each barcode that should find it, then Enter. They’re saved when you book in."
        >
          {line.barcodes.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {line.barcodes.map((b) => (
                <li
                  key={b}
                  className="border-line bg-paper-2 tabular inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs"
                >
                  {b}
                  <button
                    type="button"
                    aria-label={`Take ${b} off`}
                    onClick={() => onChange({ barcodes: line.barcodes.filter((x) => x !== b) })}
                    className="text-muted hover:text-ink grid size-5 place-items-center rounded-full"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex max-w-md gap-2">
            <Input
              id={id('barcode')}
              className="tabular"
              value={line.newBarcode}
              placeholder="Scan or type a barcode"
              {...boxFocus}
              onChange={(e) => onChange({ newBarcode: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                onAddBarcode();
              }}
            />
            <Button type="button" variant="outline" onClick={onAddBarcode}>
              <Plus aria-hidden="true" /> Add
            </Button>
          </div>
        </Field>
      ) : null}
    </div>
  );
}

/* ---- a barcode nothing has ------------------------------------------------- */

function UnknownBarcode({
  barcode,
  mode,
  onMode,
  products,
  boxFocus,
  onPickProduct,
  onCreated,
  onLater,
  onCancel,
}: {
  barcode: string;
  boxFocus: BoxFocus;
  mode: 'ask' | 'existing' | 'new';
  onMode: (mode: 'ask' | 'existing' | 'new') => void;
  products: AdminProduct[] | undefined;
  onPickProduct: (p: AdminProduct) => void;
  onCreated: (p: GoodsInCreatedProduct) => void;
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
        <NewProductForm
          barcode={barcode}
          boxFocus={boxFocus}
          onCreated={onCreated}
          onCancel={() => onMode('ask')}
        />
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

const IMEI = /^[0-9]{15}$/;
const MAX_HANDSETS = 50;

function NewProductForm({
  barcode,
  boxFocus,
  onCreated,
  onCancel,
}: {
  /** The barcode just scanned, when there is one. */
  barcode?: string;
  boxFocus: BoxFocus;
  onCreated: (p: GoodsInCreatedProduct) => void;
  onCancel: () => void;
}) {
  const categories = useAdminCategories();
  const create = useCreateGoodsInProduct();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [code, setCode] = useState(barcode ?? '');
  // A mobile phone: how many arrived, and one IMEI box per handset (client bug report item 3).
  const [phoneQty, setPhoneQty] = useState('1');
  const [imeis, setImeis] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );
  const labelOf = (id: string) => {
    const c = byId.get(id);
    if (!c) return '';
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return parent ? `${parent.label} › ${c.label}` : c.label;
  };
  // The Mobiles category or one under it, the same test the server makes (0117).
  const isPhone = (() => {
    const c = byId.get(categoryId);
    if (!c) return false;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return c.slug === 'mobiles' || parent?.slug === 'mobiles';
  })();
  const handsets = WHOLE.test(phoneQty.trim())
    ? Math.min(Number(phoneQty.trim()), MAX_HANDSETS)
    : 0;
  const imeiAt = (i: number) => imeis[i] ?? '';

  const save = () => {
    if (name.trim().length < 2) return setError('Give it a name.');
    if (!categoryId) return setError('Choose a category.');
    if (!MONEY.test(sellPrice.trim())) return setError('Selling price in pounds, e.g. 9.99');
    let phoneImeis: string[] = [];
    if (isPhone) {
      if (handsets < 1) return setError('How many phones arrived? At least 1.');
      phoneImeis = Array.from({ length: handsets }, (_, i) => imeiAt(i).trim());
      const missing = phoneImeis.findIndex((v) => !IMEI.test(v));
      if (missing >= 0) return setError(`Phone ${missing + 1} needs its 15-digit IMEI.`);
      if (new Set(phoneImeis).size !== phoneImeis.length) {
        return setError('The same IMEI is typed twice.');
      }
    }
    setError(null);
    create.mutate(
      {
        name: name.trim(),
        categoryId,
        price: pounds(Number(sellPrice.trim())),
        // A phone is told apart by its IMEIs, so it gets no made-up shop barcode.
        ...(code.trim() ? { barcode: code.trim() } : isPhone ? {} : { generateBarcode: true }),
        ...(isPhone ? { imeis: phoneImeis } : {}),
      },
      {
        onSuccess: onCreated,
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not create it.'),
      },
    );
  };

  return (
    <div className="border-line bg-card grid gap-3 rounded-md border p-3" {...boxFocus}>
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
          hint={
            code.trim()
              ? undefined
              : isPhone
                ? 'Optional for a phone: each one is found by its IMEI.'
                : 'Left blank, the shop makes one for it.'
          }
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
      {isPhone ? (
        <div className="grid gap-3">
          <Field
            label="How many phones arrived"
            htmlFor="np-phones"
            hint="One IMEI box per phone. Each phone becomes its own variation, named by its IMEI."
            className="max-w-[220px]"
          >
            <Input
              id="np-phones"
              className="tabular"
              inputMode="numeric"
              value={phoneQty}
              onChange={(e) => setPhoneQty(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: handsets }, (_, i) => (
              <Field key={i} label={`IMEI, phone ${i + 1}`} htmlFor={`np-imei-${i}`}>
                <Input
                  id={`np-imei-${i}`}
                  className="tabular"
                  inputMode="numeric"
                  maxLength={15}
                  value={imeiAt(i)}
                  placeholder="15 digits"
                  onChange={(e) =>
                    setImeis((current) => {
                      const next = [...current];
                      next[i] = e.target.value.replace(/[^0-9]/g, '');
                      return next;
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </div>
      ) : null}
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
