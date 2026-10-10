'use client';

import { useState } from 'react';
import { PackagePlus, Plus, X } from 'lucide-react';
import { useCreateStockIntake, useTillStockIntakes } from '@/lib/data/hooks';
import { formatGBP, pounds } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';

/**
 * Goods in — booking a supplier delivery in at the till (0108).
 *
 * A record of what arrived: items typed by hand (a name and a quantity — not linked to the
 * product list, so booking in moves no stock; stock is counted on the product itself), one
 * optional price for the whole delivery, and the supplier, their reference (optional) and notes
 * as before. Every delivery booked here shows in the admin panel's Goods in for this shop.
 *
 * The price can be typed by anyone booking a delivery in; nobody without costs.view ever sees one
 * read back.
 */

interface ItemRow {
  key: string;
  name: string;
  /** As typed. */
  qty: string;
}

let seq = 0;
const newRow = (): ItemRow => ({ key: `i${(seq += 1)}`, name: '', qty: '1' });

export function GoodsInView() {
  const create = useCreateStockIntake();
  const recent = useTillStockIntakes();

  const [items, setItems] = useState<ItemRow[]>(() => [newRow()]);
  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const update = (key: string, patch: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) =>
    setItems((rows) => (rows.length === 1 ? [newRow()] : rows.filter((r) => r.key !== key)));

  // A row nobody has typed in (blank name, quantity still 1) is ignored, not an error.
  const filled = items.filter((r) => r.name.trim() || r.qty.trim() !== '1');
  const units = items.reduce((n, r) => n + (/^\d+$/.test(r.qty.trim()) ? Number(r.qty) : 0), 0);

  const submit = () => {
    const next: Record<string, string> = {};
    const rows = filled;
    for (const r of rows) {
      if (!r.name.trim()) next[`${r.key}:name`] = 'Name the item';
      const q = r.qty.trim();
      if (!/^\d+$/.test(q) || Number(q) <= 0) next[`${r.key}:qty`] = 'A positive number';
    }
    const p = price.trim();
    if (p && !/^\d+(\.\d{1,2})?$/.test(p)) next.price = 'Pounds, e.g. 125.50 — or leave it blank';
    setErrors(next);
    if (rows.length === 0) {
      setFormError('Add at least one item.');
      return;
    }
    setFormError(Object.keys(next).length ? 'Check the highlighted fields.' : null);
    if (Object.keys(next).length) return;

    create.mutate(
      {
        supplierName: supplierName.trim() || undefined,
        supplierRef: supplierRef.trim() || null,
        notes: notes.trim() || undefined,
        items: rows.map((r) => ({ name: r.name.trim(), qty: Number(r.qty.trim()) })),
        price: p ? pounds(Number(p)) : null,
      },
      {
        onSuccess: () => {
          setItems([newRow()]);
          setSupplierRef('');
          setNotes('');
          setPrice('');
          setErrors({});
        },
      },
    );
  };

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-display text-ink text-xl font-extrabold uppercase">Goods in</h1>
        <p className="text-muted text-sm">
          Book a delivery in: what arrived and how many, and what the delivery cost.
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

        <div className="grid gap-2">
          <span className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]">
            Items
          </span>
          {items.map((r, i) => (
            <div key={r.key} className="flex flex-wrap items-start gap-2">
              <div className="min-w-[200px] flex-1">
                <Input
                  aria-label={`Item ${i + 1} name`}
                  aria-invalid={errors[`${r.key}:name`] ? true : undefined}
                  value={r.name}
                  placeholder="Name, e.g. iPhone 13 screens"
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setItems((rows) => [...rows, newRow()]);
                    }
                  }}
                />
                {errors[`${r.key}:name`] ? (
                  <p className="text-red-deep mt-1 text-xs font-medium">
                    {errors[`${r.key}:name`]}
                  </p>
                ) : null}
              </div>
              <div className="w-28">
                <Input
                  aria-label={`Item ${i + 1} quantity`}
                  aria-invalid={errors[`${r.key}:qty`] ? true : undefined}
                  className="tabular"
                  inputMode="numeric"
                  value={r.qty}
                  placeholder="Qty"
                  onChange={(e) => update(r.key, { qty: e.target.value })}
                />
                {errors[`${r.key}:qty`] ? (
                  <p className="text-red-deep mt-1 text-xs font-medium">{errors[`${r.key}:qty`]}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 w-11 p-0"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => remove(r.key)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((rows) => [...rows, newRow()])}
            >
              <Plus /> Add an item
            </Button>
          </div>
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
            {items.filter((r) => r.name.trim()).length}{' '}
            {items.filter((r) => r.name.trim()).length === 1 ? 'item' : 'items'} · {units}{' '}
            {units === 1 ? 'unit' : 'units'}
          </span>
          <Button onClick={submit} disabled={create.isPending}>
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
                {i.notes ? <div className="text-muted mt-1 text-xs">Note: {i.notes}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
