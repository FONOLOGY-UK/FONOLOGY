'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowDownLeft, Plus } from 'lucide-react';
import { useCreateTradeInPayout, useSellRequests, useTradeInPayouts } from '@/lib/data/hooks';
import type { Tender, TradeInPayout } from '@/lib/data/types';
import { TENDERS, formatGBP, pounds, tenderLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/admin/field';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Trade-ins / buy-ins — recording money paid OUT for a device the shop bought.
 *
 * This is the entry point for the negative `trade-in` rows in the payments
 * ledger: without it the payouts existed in reports with no way to create one.
 * Employees can record a buy-in (it is a counter action, like petty cash);
 * they still never see margins or historical revenue.
 */
export function TradeInsView({ compact = false }: { compact?: boolean }) {
  const payouts = useTradeInPayouts();
  const { data: sellRequests } = useSellRequests();
  const create = useCreateTradeInPayout();

  const [open, setOpen] = useState(false);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [amountPounds, setAmountPounds] = useState('');
  const [tender, setTender] = useState<Tender>('cash');
  const [staffName, setStaffName] = useState('');
  const [notes, setNotes] = useState('');
  const [addToStock, setAddToStock] = useState(true);
  const [resalePounds, setResalePounds] = useState('');

  const reset = () => {
    setDeviceLabel('');
    setCustomerName('');
    setSourceReference('');
    setAmountPounds('');
    setStaffName('');
    setNotes('');
    setAddToStock(true);
    setResalePounds('');
  };

  /** Quoted-but-unpaid sell requests — the queue this form usually clears. */
  const awaiting = useMemo(
    () => (sellRequests ?? []).filter((r) => r.status === 'quoted' || r.status === 'accepted'),
    [sellRequests],
  );

  const paidThisMonth = useMemo(() => {
    if (!payouts.data) return null;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return payouts.data
      .filter((p) => new Date(p.at).getTime() >= start.getTime())
      .reduce((sum, p) => sum + p.amount, 0);
  }, [payouts.data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        deviceLabel: deviceLabel.trim(),
        customerName: customerName.trim(),
        sourceReference: sourceReference.trim() ? sourceReference.trim().toUpperCase() : null,
        amount: pounds(Number(amountPounds) || 0),
        tender,
        staffName: staffName.trim(),
        notes: notes.trim() || undefined,
        addToStock,
        resalePrice: resalePounds.trim() ? pounds(Number(resalePounds)) : null,
      },
      {
        onSuccess: () => {
          reset();
          setOpen(false);
        },
      },
    );
  };

  const columns = useMemo<ColumnDef<TradeInPayout>[]>(
    () => [
      {
        accessorKey: 'at',
        header: 'When',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: 'reference',
        header: 'Ref',
        cell: ({ getValue }) => <span className="tabular font-bold">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'deviceLabel',
        header: 'Device',
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="text-ink block truncate font-medium">{row.original.deviceLabel}</span>
            <span className="text-muted text-xs">
              {row.original.customerName}
              {row.original.sourceReference ? ` · ${row.original.sourceReference}` : ' · walk-in'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Paid out',
        cell: ({ getValue }) => (
          <span className="tabular text-red-deep font-bold">−{formatGBP(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: 'tender',
        header: 'Paid by',
        cell: ({ row }) => <span className="text-muted">{tenderLabel(row.original.tender)}</span>,
      },
      {
        id: 'stock',
        header: 'Resale',
        accessorFn: (p) => (p.addToStock ? 'stock' : 'no'),
        cell: ({ row }) =>
          row.original.addToStock ? (
            <StatusChip tone="success">
              {row.original.resalePrice ? formatGBP(row.original.resalePrice) : 'To price'}
            </StatusChip>
          ) : (
            <StatusChip tone="neutral">Not for resale</StatusChip>
          ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Trade-ins"
        description="Devices bought in from customers. Every payout is money out — it comes off revenue for the period."
        actions={
          <Button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Plus aria-hidden="true" />
            Record a buy-in
          </Button>
        }
      />

      {/* The one figure worth having in the eyeline before paying anyone. */}
      {!compact ? (
        <div className="mb-4">
          <div className="border-line bg-card rounded-lg border p-4 sm:max-w-xs">
            <p className="text-muted text-[11px] font-semibold uppercase tracking-[0.08em]">
              Paid out this month
            </p>
            <p className="font-display text-ink tabular mt-1 text-2xl font-extrabold">
              {paidThisMonth === null ? '—' : `−${formatGBP(paidThisMonth)}`}
            </p>
          </div>
        </div>
      ) : null}

      {open ? (
        <section className="border-line bg-card mb-6 rounded-lg border p-4">
          <h2 className="font-display text-ink mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.06em]">
            <ArrowDownLeft className="text-red size-4" aria-hidden="true" />
            Record a buy-in
          </h2>

          <form onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
            <Field label="Device bought" htmlFor="ti-device">
              <Input
                id="ti-device"
                autoFocus
                placeholder="e.g. iPhone 13 128GB — Midnight"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                required
                minLength={2}
              />
            </Field>
            <Field label="Bought from" htmlFor="ti-customer">
              <Input
                id="ti-customer"
                placeholder="Customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                minLength={2}
              />
            </Field>

            <Field
              label="Sell request (optional)"
              htmlFor="ti-source"
              hint={
                awaiting.length > 0
                  ? `Awaiting: ${awaiting.map((r) => r.reference).join(', ')}`
                  : 'Leave blank for a walk-in'
              }
            >
              <Input
                id="ti-source"
                placeholder="e.g. FNL-3001"
                className="tabular uppercase placeholder:normal-case"
                value={sourceReference}
                onChange={(e) => setSourceReference(e.target.value)}
              />
            </Field>
            <Field label="Paid to customer (£)" htmlFor="ti-amount">
              <Input
                id="ti-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                value={amountPounds}
                onChange={(e) => setAmountPounds(e.target.value)}
                required
              />
            </Field>

            <Field label="Paid by" htmlFor="ti-tender">
              <Select
                id="ti-tender"
                value={tender}
                onChange={(e) => setTender(e.target.value as Tender)}
              >
                {TENDERS.filter((t) => t !== 'stripe').map((t) => (
                  <option key={t} value={t}>
                    {tenderLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bought in by" htmlFor="ti-staff">
              <Input
                id="ti-staff"
                placeholder="Your name"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                required
              />
            </Field>

            <Field
              label="Notes (condition, battery health…)"
              htmlFor="ti-notes"
              className="lg:col-span-2"
            >
              <Input
                id="ti-notes"
                placeholder="Anything the bench should know"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
              />
            </Field>

            <div className="border-line rounded-ui bg-paper-2/40 grid gap-2.5 border p-3 lg:col-span-2">
              <label className="flex items-center gap-2.5 text-sm font-semibold">
                <input
                  type="checkbox"
                  className="accent-[var(--red)]"
                  checked={addToStock}
                  onChange={(e) => setAddToStock(e.target.checked)}
                />
                Add this device to inventory for resale
              </label>
              {addToStock ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label htmlFor="ti-resale" className="text-muted">
                    Asking price (£)
                  </label>
                  <Input
                    id="ti-resale"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="tabular h-9 w-28"
                    placeholder="Later"
                    value={resalePounds}
                    onChange={(e) => setResalePounds(e.target.value)}
                  />
                  <span className="text-muted text-xs">
                    Leave blank to price it once the bench has checked it.
                  </span>
                </div>
              ) : null}
              <p className="text-muted text-xs">
                The listing itself is created by the backend — this records the intent and the price
                so nothing is lost at the counter.
              </p>
            </div>

            {create.isError ? (
              <p
                className="text-red-deep flex items-start gap-1.5 text-sm font-semibold lg:col-span-2"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {create.error.message}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 lg:col-span-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending
                  ? 'Recording…'
                  : `Pay out${amountPounds ? ` ${formatGBP(pounds(Number(amountPounds) || 0))}` : ''}`}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <DataTable
        data={payouts.data}
        columns={columns}
        isLoading={payouts.isPending}
        isError={payouts.isError}
        errorMessage="The buy-in history didn’t load."
        onRetry={() => payouts.refetch()}
        searchPlaceholder="Search device, customer or ref…"
        empty={{
          title: 'No trade-ins yet',
          description: 'Devices bought in over the counter appear here, with what we paid.',
          action: <Button onClick={() => setOpen(true)}>Record a buy-in</Button>,
        }}
      />
    </div>
  );
}
