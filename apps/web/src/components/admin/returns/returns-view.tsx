'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Search } from 'lucide-react';
import { useCreateRefund, useOrder, useRefunds, useSettings } from '@/lib/data/hooks';
import type { Refund, Tender } from '@/lib/data/types';
import { TENDERS, formatGBP, tenderLabel } from '@/lib/data/types';
import { formatDateTime, formatDay } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Returns & refunds (item 7). Look an order up by reference, refund inside
 * the configurable window (Settings, default 30 days) — outside it, an
 * explicit admin override is required and the reason stays on record.
 */
export function ReturnsView() {
  const { data: settings } = useSettings();
  const refunds = useRefunds();
  const createRefund = useCreateRefund();

  const [refInput, setRefInput] = useState('');
  const [lookupRef, setLookupRef] = useState('');
  const order = useOrder(lookupRef);

  const [amountPounds, setAmountPounds] = useState('');
  const [reason, setReason] = useState('');
  const [tender, setTender] = useState<Tender>('cash');
  const [override, setOverride] = useState(false);

  const windowDays = settings?.returnWindowDays ?? 30;
  const orderAgeDays = order.data
    ? Math.floor((Date.now() - new Date(order.data.createdAt).getTime()) / 86400000)
    : 0;
  const withinWindow = order.data ? orderAgeDays <= windowDays : true;

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    createRefund.reset();
    setLookupRef(refInput.trim().toUpperCase());
    setAmountPounds('');
    setReason('');
    setOverride(false);
  };

  const submitRefund = (e: React.FormEvent) => {
    e.preventDefault();
    if (!order.data) return;
    createRefund.mutate(
      {
        orderReference: order.data.reference,
        amount: Math.round((Number(amountPounds) || 0) * 100),
        reason,
        tender,
        override,
      },
      {
        onSuccess: () => {
          setLookupRef('');
          setRefInput('');
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
        accessorKey: 'orderReference',
        header: 'Order',
        cell: ({ getValue }) => <span className="tabular font-bold">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ getValue }) => (
          <span className="tabular text-red-deep font-bold">−{formatGBP(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: 'tender',
        header: 'Refunded to',
        cell: ({ row }) => <span className="text-muted">{tenderLabel(row.original.tender)}</span>,
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        cell: ({ getValue }) => (
          <span className="block max-w-[260px] truncate" title={getValue<string>()}>
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: 'window',
        header: 'Window',
        accessorFn: (r) => (r.withinWindow ? 'within' : 'override'),
        cell: ({ row }) =>
          row.original.withinWindow ? (
            <StatusChip tone="success">In window</StatusChip>
          ) : (
            <StatusChip tone="warning">Override</StatusChip>
          ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Returns"
        description={`Refunds against orders. The window is ${windowDays} days — configurable in Settings.`}
      />

      {/* Lookup + refund form */}
      <section className="border-line bg-card mb-6 rounded-lg border p-4">
        <form onSubmit={search} className="flex flex-wrap items-end gap-2">
          <Field
            label="Order reference"
            htmlFor="ret-ref"
            className="min-w-[200px] flex-1 sm:max-w-xs"
          >
            <Input
              id="ret-ref"
              placeholder="e.g. FNL-1001"
              className="tabular uppercase"
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
              reference — it’s on the confirmation email and the receipt.
            </p>
          ) : (
            <div className="border-line mt-4 grid gap-4 border-t pt-4 lg:grid-cols-[1.2fr_1fr]">
              {/* The order */}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-ink font-bold">{order.data.reference}</span>
                  <span className="text-muted text-xs">
                    {order.data.name} · {formatDay(order.data.createdAt)} ({orderAgeDays}d ago)
                  </span>
                  {withinWindow ? (
                    <StatusChip tone="success">In window</StatusChip>
                  ) : (
                    <StatusChip tone="warning">Outside {windowDays}-day window</StatusChip>
                  )}
                </div>
                <ul className="mt-3 grid gap-1.5">
                  {order.data.lines.map((line) => (
                    <li
                      key={line.productId}
                      className="bg-paper-2/60 flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px]"
                    >
                      <span className="text-ink-2">
                        {line.name} {line.quantity > 1 ? `×${line.quantity}` : ''}
                      </span>
                      <span className="tabular font-semibold">
                        {formatGBP(line.unitPrice * line.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="tabular text-ink mt-2 text-right text-sm font-bold">
                  Order total {formatGBP(order.data.total)}
                </p>
              </div>

              {/* The refund */}
              <form onSubmit={submitRefund} className="grid content-start gap-3">
                <Field label="Refund amount (£)" htmlFor="ret-amount">
                  <Input
                    id="ret-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={(order.data.total / 100).toFixed(2)}
                    inputMode="decimal"
                    className="tabular"
                    value={amountPounds}
                    onChange={(e) => setAmountPounds(e.target.value)}
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
                {!withinWindow ? (
                  <label className="border-warning/40 bg-warning/10 rounded-ui flex items-start gap-2.5 border px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[var(--warning)]"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />
                    <span>
                      <strong>Admin override.</strong> This order is outside the {windowDays}-day
                      window — refund it anyway, with the reason on record.
                    </span>
                  </label>
                ) : null}
                {createRefund.isError ? (
                  <p
                    className="text-red-deep flex items-start gap-1.5 text-sm font-semibold"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {createRefund.error.message}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={createRefund.isPending || (!withinWindow && !override)}
                >
                  {createRefund.isPending ? 'Processing…' : 'Process refund'}
                </Button>
              </form>
            </div>
          )
        ) : (
          <p className="text-muted mt-3 text-xs">
            Try <span className="tabular font-semibold">FNL-1001</span> — a recent click &amp;
            collect order.
          </p>
        )}
      </section>

      <h2 className="font-display text-ink mb-2 text-sm font-extrabold uppercase tracking-[0.06em]">
        Refund history
      </h2>
      <DataTable
        data={refunds.data}
        columns={columns}
        isLoading={refunds.isPending}
        isError={refunds.isError}
        errorMessage="The refund history didn’t load."
        onRetry={() => refunds.refetch()}
        searchPlaceholder="Search order or reason…"
        empty={{
          title: 'No refunds',
          description: 'Processed refunds appear here with their reasons.',
        }}
      />
    </div>
  );
}
