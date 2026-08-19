'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, PackagePlus, Search, Trash2 } from 'lucide-react';
import {
  useAdminProducts,
  useCreateRefund,
  useOrder,
  useRefunds,
  useSession,
  useSettings,
} from '@/lib/data/hooks';
import type { Refund, ReturnLine, ReturnSource, Tender } from '@/lib/data/types';
import { TENDERS, formatGBP, pounds, returnSourceLabel, tenderLabel } from '@/lib/data/types';
import { formatDateTime, formatDay } from '@/lib/dates';
import { PrintButton } from '@/components/shared/print-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

const SOURCES: ReturnSource[] = ['order', 'counter', 'no-receipt'];

/**
 * Returns & refunds (item 7, extended).
 *
 * A return is goods coming back, not only money going out — so this records
 * WHAT came back, whether it goes back on the shelf, who processed it, and
 * only then the refund. Three ways in:
 *   • an online order, looked up by reference (lines prefill)
 *   • a counter sale, by receipt reference (items added by hand — the till
 *     receipt is the paper record; line detail lands when the backend
 *     persists sales, see INTEGRATION.md)
 *   • no receipt at all — always an override, always on record
 */
export function ReturnsView() {
  const { data: settings } = useSettings();
  const { data: session } = useSession();
  const refunds = useRefunds();
  const createRefund = useCreateRefund();

  // The refund just created, kept so a receipt can be printed for it.
  const [lastRefund, setLastRefund] = useState<Refund | null>(null);
  const [source, setSource] = useState<ReturnSource>('order');
  const [refInput, setRefInput] = useState('');
  const [lookupRef, setLookupRef] = useState('');
  const order = useOrder(source === 'order' ? lookupRef : '');

  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [amountPounds, setAmountPounds] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [tender, setTender] = useState<Tender>('cash');
  const [restock, setRestock] = useState(true);
  const [override, setOverride] = useState(false);

  const windowDays = settings?.returnWindowDays ?? 30;
  const orderAgeDays = order.data
    ? Math.floor((Date.now() - new Date(order.data.createdAt).getTime()) / 86400000)
    : 0;

  /** No receipt is always an override; an aged order is one too. */
  const needsOverride =
    source === 'no-receipt' || (source === 'order' && !!order.data && orderAgeDays > windowDays);

  const linesTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  // The basket drives the amount until someone types their own figure.
  const amount = amountTouched ? pounds(Number(amountPounds) || 0) : linesTotal;

  const resetForm = () => {
    setLines([]);
    setAmountPounds('');
    setAmountTouched(false);
    setReason('');
    setRestock(true);
    setOverride(false);
  };

  const switchSource = (next: ReturnSource) => {
    setSource(next);
    setRefInput('');
    setLookupRef('');
    resetForm();
    createRefund.reset();
  };

  const findOrder = (e: React.FormEvent) => {
    e.preventDefault();
    createRefund.reset();
    resetForm();
    setLookupRef(refInput.trim().toUpperCase());
  };

  const addLine = (line: ReturnLine) => {
    setLines((current) => {
      const existing = current.find((l) => l.productId === line.productId);
      return existing
        ? current.map((l) =>
            l.productId === line.productId ? { ...l, quantity: l.quantity + line.quantity } : l,
          )
        : [...current, line];
    });
  };

  const setLineQty = (index: number, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((_, i) => i !== index)
        : current.map((l, i) => (i === index ? { ...l, quantity } : l)),
    );
  };

  const reference = source === 'no-receipt' ? null : lookupRef || refInput.trim().toUpperCase();
  const canSubmit =
    amount > 0 &&
    reason.trim().length >= 3 &&
    (source === 'no-receipt' || (reference?.length ?? 0) > 0) &&
    (!needsOverride || override) &&
    !createRefund.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    createRefund.mutate(
      {
        source,
        reference,
        lines,
        amount,
        reason: reason.trim(),
        tender,
        restock,
        override: needsOverride ? override : false,
      },
      {
        onSuccess: (refund) => {
          // Hold on to the refund we just created. The form clears itself, so
          // without this there is nothing left on screen to print from — and
          // a refund receipt is the one the customer is most likely to ask
          // for, because they are standing there waiting for their money.
          setLastRefund(refund);
          setRefInput('');
          setLookupRef('');
          resetForm();
        },
      },
    );
  };

  const columns = useMemo<ColumnDef<Refund>[]>(
    () => [
      {
        accessorKey: 'at',
        header: 'When',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        id: 'reference',
        header: 'Sale',
        accessorFn: (r) => r.reference ?? 'No receipt',
        cell: ({ row }) => (
          <div>
            <span className="tabular font-bold">{row.original.reference ?? '—'}</span>
            <span className="text-muted block text-xs">
              {returnSourceLabel(row.original.source)}
            </span>
          </div>
        ),
      },
      {
        id: 'items',
        header: 'Items back',
        accessorFn: (r) => r.lines.map((l) => l.name).join(' '),
        cell: ({ row }) =>
          row.original.lines.length === 0 ? (
            <span className="text-muted text-xs">Money only</span>
          ) : (
            <span
              className="block max-w-[220px] truncate text-[13px]"
              title={row.original.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}
            >
              {row.original.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}
            </span>
          ),
      },
      {
        accessorKey: 'amount',
        header: 'Refunded',
        cell: ({ getValue }) => (
          <span className="tabular text-red-deep font-bold">−{formatGBP(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: 'tender',
        header: 'To',
        cell: ({ row }) => <span className="text-muted">{tenderLabel(row.original.tender)}</span>,
      },
      {
        id: 'restock',
        header: 'Stock',
        accessorFn: (r) => (r.restock ? 'restocked' : 'written off'),
        cell: ({ row }) =>
          row.original.lines.length === 0 ? (
            <span className="text-muted text-xs">—</span>
          ) : row.original.restock ? (
            <StatusChip tone="success">Restocked</StatusChip>
          ) : (
            <StatusChip tone="warning">Written off</StatusChip>
          ),
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        cell: ({ getValue }) => (
          <span className="block max-w-[220px] truncate" title={getValue<string>()}>
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: 'by',
        header: 'By',
        // Resolved server-side from the session-stamped staff id.
        accessorFn: (r) => r.staffName ?? '',
        cell: ({ row }) => (
          <div>
            <span className="text-muted">{row.original.staffName ?? '—'}</span>
            {row.original.outsideWindow ? (
              <StatusChip tone="warning" className="mt-1 block w-fit">
                Override
              </StatusChip>
            ) : null}
          </div>
        ),
      },
    ],
    [],
  );

  /** The order lookup has to succeed before the rest of the form is useful. */
  const orderBlocked = source === 'order' && !order.data;

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Returns"
        description={`Record goods coming back and refund them. The window is ${windowDays} days — configurable in Settings.`}
      />

      <section className="border-line bg-card mb-6 rounded-lg border p-4">
        {/* Where the return came from — this is the first decision, so it's
            the first control, not a field buried in the form. */}
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Return source">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => switchSource(s)}
              aria-pressed={source === s}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-bold transition-colors duration-150',
                source === s ? 'bg-ink text-bone' : 'bg-paper-2 text-muted hover:text-ink',
              )}
            >
              {returnSourceLabel(s)}
            </button>
          ))}
        </div>

        {/* ---- reference lookup ------------------------------------------- */}
        {source === 'order' ? (
          <>
            <form onSubmit={findOrder} className="flex flex-wrap items-end gap-2">
              <Field
                label="Order reference"
                htmlFor="ret-ref"
                className="min-w-[200px] flex-1 sm:max-w-xs"
              >
                <Input
                  id="ret-ref"
                  placeholder="e.g. FNL-1001"
                  className="tabular uppercase placeholder:normal-case"
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="secondary" disabled={refInput.trim().length === 0}>
                <Search aria-hidden="true" />
                Find order
              </Button>
            </form>

            {lookupRef ? (
              order.isPending ? (
                <Skeleton className="mt-4 h-[120px] w-full" />
              ) : order.isError ? (
                <p className="text-red-deep mt-4 text-sm font-semibold">
                  The lookup failed — try again.
                </p>
              ) : !order.data ? (
                <p className="text-ink mt-4 text-sm">
                  No order found for <strong className="tabular">{lookupRef}</strong>. Check the
                  reference — it’s on the confirmation email and the receipt. If they bought it at
                  the counter, use <strong>Counter sale</strong>.
                </p>
              ) : (
                <div className="border-line mt-4 border-t pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-ink font-bold">{order.data.reference}</span>
                    <span className="text-muted text-xs">
                      {order.data.name} · {formatDay(order.data.createdAt)} ({orderAgeDays}d ago) ·
                      total {formatGBP(order.data.total)}
                    </span>
                    {orderAgeDays <= windowDays ? (
                      <StatusChip tone="success">In window</StatusChip>
                    ) : (
                      <StatusChip tone="warning">Outside {windowDays}-day window</StatusChip>
                    )}
                  </div>

                  <p className="text-muted mt-3 text-xs font-semibold uppercase tracking-[0.08em]">
                    What came back?
                  </p>
                  <ul className="mt-1.5 grid gap-1.5">
                    {order.data.lines.map((line) => {
                      const picked = lines.find((l) => l.productId === line.productId);
                      const qty = picked?.quantity ?? 0;
                      return (
                        <li
                          key={line.productId}
                          className={cn(
                            'flex flex-wrap items-center gap-2 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150',
                            qty > 0 ? 'bg-red-tint/60' : 'bg-paper-2/60',
                          )}
                        >
                          <span className="text-ink-2 min-w-0 flex-1 truncate">
                            {line.name}
                            <span className="text-muted"> · bought {line.quantity}</span>
                          </span>
                          <span className="tabular text-muted text-xs">
                            {formatGBP(line.unitPrice)} each
                          </span>
                          <QtyStepper
                            value={qty}
                            max={line.quantity}
                            label={`Quantity of ${line.name} returned`}
                            onChange={(next) => {
                              const index = lines.findIndex((l) => l.productId === line.productId);
                              if (index >= 0) setLineQty(index, next);
                              else if (next > 0)
                                addLine({
                                  productId: line.productId,
                                  name: line.name,
                                  quantity: next,
                                  unitPrice: line.unitPrice,
                                });
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )
            ) : (
              <p className="text-muted mt-3 text-xs">
                Try <span className="tabular font-semibold">FNL-1001</span> — a recent click &amp;
                collect order.
              </p>
            )}
          </>
        ) : source === 'counter' ? (
          <>
            <Field
              label="Receipt reference"
              htmlFor="ret-receipt"
              className="max-w-xs"
              hint="Printed on the till receipt. The amount is checked against that sale."
            >
              <Input
                id="ret-receipt"
                placeholder="e.g. FNL-1042"
                className="tabular uppercase placeholder:normal-case"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
              />
            </Field>
            <LineBuilder lines={lines} onAdd={addLine} onSetQty={setLineQty} />
          </>
        ) : (
          <>
            <div className="border-warning/40 bg-warning/10 rounded-ui mb-3 flex items-start gap-2.5 border px-3 py-2.5 text-sm">
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                <strong>No receipt.</strong> There’s nothing to check the refund against, so this
                always needs an override and the reason stays on record.
              </p>
            </div>
            <LineBuilder lines={lines} onAdd={addLine} onSetQty={setLineQty} />
          </>
        )}

        {/* ---- the refund ------------------------------------------------- */}
        {!orderBlocked ? (
          <form
            onSubmit={submit}
            className="border-line mt-4 grid gap-3 border-t pt-4 lg:grid-cols-2"
          >
            <Field
              label="Refund amount (£)"
              htmlFor="ret-amount"
              hint={
                lines.length > 0 && !amountTouched
                  ? `From the items above — edit to refund a different amount`
                  : undefined
              }
            >
              <Input
                id="ret-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                value={amountTouched ? amountPounds : (linesTotal / 100).toFixed(2)}
                // The pre-filled "0.00"/basket total sits in the field as real text,
                // so a first keystroke without this inserts at the caret instead of
                // replacing — typing "72" became "0.0072". Selecting the whole value
                // on focus means any typed character replaces it, with no change to
                // how the amount is computed, stored, or sent.
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setAmountTouched(true);
                  setAmountPounds(e.target.value);
                }}
                required
              />
            </Field>
            <Field label="Refund to" htmlFor="ret-tender">
              <Select
                id="ret-tender"
                value={tender}
                onChange={(e) => setTender(e.target.value as Tender)}
              >
                {TENDERS.map((t) => (
                  <option key={t} value={t}>
                    {tenderLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Reason (kept on record)" htmlFor="ret-reason">
              <Input
                id="ret-reason"
                placeholder="e.g. Faulty on arrival"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
              />
            </Field>
            {/*
              No "processed by" field: the API stamps the refund with the
              signed-in staff member from the session and ignores anything the
              body says, so a free-text name could only ever disagree with the
              record.
            */}
            <p className="text-muted self-end text-xs">
              Processed as <span className="text-ink font-medium">{session?.name ?? 'you'}</span>.
            </p>

            {/* Where the goods go is a real decision with a stock consequence. */}
            {lines.length > 0 ? (
              <div
                className="border-line rounded-ui bg-paper-2/40 flex flex-wrap gap-x-4 gap-y-2 border p-3 lg:col-span-2"
                role="radiogroup"
                aria-label="What happens to the returned items"
              >
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    name="ret-restock"
                    className="accent-[var(--red)]"
                    checked={restock}
                    onChange={() => setRestock(true)}
                  />
                  Back on the shelf
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    name="ret-restock"
                    className="accent-[var(--red)]"
                    checked={!restock}
                    onChange={() => setRestock(false)}
                  />
                  Faulty — write off
                </label>
                <p className="text-muted basis-full text-xs">
                  {restock
                    ? `Adds ${lines.reduce((s, l) => s + l.quantity, 0)} item(s) back into stock.`
                    : 'Stock is not increased — the items are out of circulation.'}
                </p>
              </div>
            ) : null}

            {needsOverride ? (
              <label className="border-warning/40 bg-warning/10 rounded-ui flex items-start gap-2.5 border px-3 py-2.5 text-sm lg:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--warning)]"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                />
                <span>
                  <strong>Admin override.</strong>{' '}
                  {source === 'no-receipt'
                    ? 'There is no receipt for this return — process it anyway, with the reason on record.'
                    : `This order is outside the ${windowDays}-day window — refund it anyway, with the reason on record.`}
                </span>
              </label>
            ) : null}

            {createRefund.isError ? (
              <p
                className="text-red-deep flex items-start gap-1.5 text-sm font-semibold lg:col-span-2"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {createRefund.error.message}
              </p>
            ) : null}

            {/*
              The refund is done and the form has cleared. This is the only
              moment the customer is still at the counter, so the receipt offer
              belongs here rather than buried in the history table below.

              `refundReference` is the refund's OWN number (0035, REF- series),
              not the sale's. Two partial refunds against one sale used to
              print the same reference, which is exactly why that migration
              exists.
            */}
            {lastRefund && !createRefund.isPending ? (
              <div className="border-line bg-card grid gap-2 rounded-lg border p-3 lg:col-span-2">
                <p className="text-sm">
                  <strong className="text-ink">Return recorded.</strong>{' '}
                  <span className="tabular text-muted">
                    {lastRefund.refundReference ?? lastRefund.reference ?? ''} ·{' '}
                    {formatGBP(lastRefund.amount)}
                  </span>
                </p>
                <div className="flex items-start gap-3">
                  <PrintButton
                    kind="refund_receipt"
                    entityId={lastRefund.id}
                    dedupeKey={`refund-receipt-${lastRefund.id}`}
                    label="Print refund receipt"
                    size="sm"
                  />
                  <Button variant="ghost" size="sm" onClick={() => setLastRefund(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3 lg:col-span-2">
              <span className="text-muted text-sm">
                Refunding <strong className="tabular text-ink">{formatGBP(amount)}</strong>
                {lines.length > 0
                  ? ` · ${lines.reduce((s, l) => s + l.quantity, 0)} item(s) back`
                  : ''}
              </span>
              <Button type="submit" variant="destructive" disabled={!canSubmit}>
                {createRefund.isPending ? 'Processing…' : 'Record return'}
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      <h2 className="font-display text-ink mb-2 text-sm font-extrabold uppercase tracking-[0.06em]">
        Return history
      </h2>
      <DataTable
        data={refunds.data}
        columns={columns}
        isLoading={refunds.isPending}
        isError={refunds.isError}
        errorMessage="The return history didn’t load."
        onRetry={() => refunds.refetch()}
        searchPlaceholder="Search reference, item or reason…"
        empty={{
          title: 'No returns',
          description: 'Processed returns appear here with their items and reasons.',
        }}
      />
    </div>
  );
}

/* ---- pieces ---------------------------------------------------------------- */

function QtyStepper({
  value,
  max,
  label,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label="One fewer"
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
      >
        −
      </Button>
      <span className="tabular w-6 text-center text-sm font-bold">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        aria-label="One more"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </Button>
    </div>
  );
}

/**
 * Add returned items by hand — used when there is no order to prefill from
 * (counter sales and no-receipt returns). Prices default to the catalogue
 * price and stay editable, because what they paid is what goes back.
 */
function LineBuilder({
  lines,
  onAdd,
  onSetQty,
}: {
  lines: ReturnLine[];
  onAdd: (line: ReturnLine) => void;
  onSetQty: (index: number, quantity: number) => void;
}) {
  const { data: products } = useAdminProducts();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !products) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q))
      .slice(0, 6);
  }, [products, query]);

  return (
    <div className="mt-3">
      <p className="text-muted mb-1.5 text-xs font-semibold uppercase tracking-[0.08em]">
        What came back?
      </p>

      <div className="relative max-w-md">
        <Search
          className="text-muted pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the catalogue or scan a barcode…"
          aria-label="Find the returned item"
          className="pl-9"
        />
        {matches.length > 0 ? (
          <ul className="border-line bg-card absolute z-10 mt-1 w-full overflow-hidden rounded-lg border shadow-md">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd({ productId: p.id, name: p.name, quantity: 1, unitPrice: p.price });
                    setQuery('');
                  }}
                  className="hover:bg-paper-2/60 flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150"
                >
                  <PackagePlus className="text-muted size-4 shrink-0" aria-hidden="true" />
                  <span className="text-ink min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="tabular text-muted text-xs">{formatGBP(p.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <ul className="mt-2 grid gap-1.5">
          {lines.map((line, i) => (
            <li
              key={line.productId ?? line.name}
              className="bg-red-tint/60 flex flex-wrap items-center gap-2 rounded-md px-2.5 py-2 text-[13px]"
            >
              <span className="text-ink-2 min-w-0 flex-1 truncate">{line.name}</span>
              <span className="tabular text-muted text-xs">{formatGBP(line.unitPrice)} each</span>
              <QtyStepper
                value={line.quantity}
                max={99}
                label={`Quantity of ${line.name} returned`}
                onChange={(next) => onSetQty(i, next)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted hover:text-red-deep h-7 w-7 p-0"
                aria-label={`Remove ${line.name}`}
                onClick={() => onSetQty(i, 0)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted mt-2 text-xs">
          Add the items coming back, or leave this empty to refund money only.
        </p>
      )}
    </div>
  );
}
