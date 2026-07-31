'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, Package, Plus } from 'lucide-react';
import { useCreateTradeInPayout, useTradeInPayoutPage } from '@/lib/data/hooks';
import type { PayoutMethod, TradeInPayout } from '@/lib/data/types';
import { formatGBP, payoutMethodLabel, pounds } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
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
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatTile } from '@/components/admin/stat-tile';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * The payout ledger — money the shop has paid OUT for devices it bought.
 *
 * Amounts are shown as stored: NEGATIVE. They are deliberately not flipped to a
 * friendly positive, because these figures sit alongside sales and a payout that
 * reads like income is exactly the confusion to avoid. Payouts carry their own
 * `BUY-` reference series, are excluded from every revenue figure, and the cash
 * ones are what the day-close subtracts from the drawer.
 *
 * Restocking is never automatic — it happens on the request's own page, because
 * someone decided to and set a price.
 *
 * This screen used to be mock-shaped: it read `sourceReference`, `tender`,
 * `staffName` and `addToStock`, none of which the real API returns, and it
 * offered a free-text "recorded by" that the server ignores entirely.
 */
export function TradeInsView({ compact = false }: { compact?: boolean } = {}) {
  const [filter, setFilter] = useState<'all' | 'awaiting' | 'restocked'>('all');
  const [recording, setRecording] = useState(false);

  const { data, isPending, isError, refetch } = useTradeInPayoutPage({
    restocked: filter === 'all' ? undefined : filter === 'restocked',
    limit: 100,
  });

  const payouts = data?.items;

  const totals = useMemo(() => {
    if (!payouts) return null;
    // Amounts are negative, so this sums to a negative figure — the real
    // direction of the money, not a tidied-up absolute.
    const out = payouts.reduce((sum, p) => sum + p.amount, 0);
    const awaiting = payouts.filter((p) => !p.restocked).length;
    return { out, awaiting, count: payouts.length };
  }, [payouts]);

  const columns = useMemo<ColumnDef<TradeInPayout>[]>(
    () => [
      {
        accessorKey: 'reference',
        header: 'Reference',
        cell: ({ row }) => <span className="text-ink font-semibold">{row.original.reference}</span>,
      },
      {
        accessorKey: 'deviceLabel',
        header: 'Device',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="text-ink truncate font-medium">{row.original.deviceLabel}</p>
            <p className="text-muted truncate text-xs">from {row.original.customerName}</p>
          </div>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Paid out',
        cell: ({ row }) => (
          <span className="text-red-deep tabular font-bold">
            {formatGBP(row.original.amount, { alwaysShowPennies: true })}
          </span>
        ),
      },
      {
        accessorKey: 'method',
        header: 'Method',
        cell: ({ row }) => (
          <span className="text-muted">{payoutMethodLabel(row.original.method)}</span>
        ),
      },
      {
        id: 'stock',
        header: 'Stock',
        cell: ({ row }) =>
          row.original.restocked ? (
            <StatusChip tone="success">
              On shelf
              {row.original.resalePrice != null ? ` · ${formatGBP(row.original.resalePrice)}` : ''}
            </StatusChip>
          ) : (
            <StatusChip tone="warning">Not restocked</StatusChip>
          ),
      },
      {
        id: 'by',
        header: 'By',
        cell: ({ row }) => <span className="text-muted">{row.original.staffName ?? '—'}</span>,
      },
      {
        id: 'source',
        header: 'Source',
        cell: ({ row }) =>
          row.original.sellRequestId ? (
            <Link
              href={`/admin/trade-ins/${row.original.sellRequestId}`}
              className="text-ink text-xs underline underline-offset-2"
            >
              Website request
            </Link>
          ) : (
            <span className="text-muted text-xs">Walk-in</span>
          ),
      },
      {
        accessorKey: 'createdAt',
        header: 'When',
        cell: ({ getValue }) => (
          <span className="text-muted tabular text-xs">{formatDateTime(getValue<string>())}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Trade-ins"
        title="Payouts"
        description="Devices bought in from customers — money out, never counted as revenue."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/trade-ins">Sell requests</Link>
            </Button>
            <Button onClick={() => setRecording(true)}>
              <Plus aria-hidden="true" />
              Walk-in buy-in
            </Button>
          </div>
        }
      />

      {!compact ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Paid out"
            value={totals ? formatGBP(totals.out, { alwaysShowPennies: true }) : '—'}
            sub={totals ? `${totals.count} buy-ins` : ''}
            isLoading={isPending}
          />
          <StatTile
            label="Awaiting restock"
            value={totals ? String(totals.awaiting) : '—'}
            sub="bought, not yet on the shelf"
            isLoading={isPending}
          />
          <StatTile
            label="Reference series"
            value="BUY-"
            sub="separate from sales, excluded from revenue"
            isLoading={false}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'awaiting', 'restocked'] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'awaiting' ? 'Awaiting restock' : 'On the shelf'}
          </Button>
        ))}
      </div>

      <DataTable
        data={payouts}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The payout ledger didn’t load."
        onRetry={() => refetch()}
        searchPlaceholder="Search device, customer or reference…"
        pageSize={15}
        empty={{
          title: 'No payouts yet',
          description: 'Devices bought from customers will appear here.',
        }}
      />

      <p className="text-muted mt-6 flex items-center gap-2 text-xs">
        <ArrowDownLeft className="size-3.5 shrink-0" aria-hidden="true" />
        Every figure here is negative because it left the till. Cash payouts are subtracted by the
        day-close; bank transfers never touch the drawer.
      </p>

      <WalkInDialog open={recording} onOpenChange={setRecording} />
    </div>
  );
}

/* ---- walk-in buy-in --------------------------------------------------------- */

/**
 * A buy-in with no prior website request — someone walks in with a phone.
 *
 * There is no "recorded by" field: the server stamps the staff member from the
 * session and ignores anything the body claims, so offering a choice would only
 * let the screen misrepresent who handled the money.
 */
function WalkInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateTradeInPayout();
  const [deviceLabel, setDeviceLabel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayoutMethod>('cash');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setDeviceLabel('');
    setCustomerName('');
    setAmount('');
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Walk-in buy-in</DialogTitle>
          <DialogDescription>
            A device bought over the counter, with no website request behind it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const paid = pounds(Number(amount) || 0);
            if (paid <= 0) return;
            create.mutate(
              {
                deviceLabel: deviceLabel.trim(),
                customerName: customerName.trim(),
                // Positive here; the server is the one place it goes negative.
                amount: paid,
                method,
                notes: notes.trim() || undefined,
              },
              {
                onSuccess: () => {
                  reset();
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <Field label="What did we buy?" htmlFor="walkin-device">
            <Input
              id="walkin-device"
              autoFocus
              placeholder="e.g. iPhone 12 64GB — Black"
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
            />
          </Field>
          <Field label="Who from?" htmlFor="walkin-customer">
            <Input
              id="walkin-customer"
              placeholder="Customer name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Paid (£)" htmlFor="walkin-amount">
              <Input
                id="walkin-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular w-28"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Method" htmlFor="walkin-method">
              <Select
                id="walkin-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PayoutMethod)}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
              </Select>
            </Field>
          </div>
          <Field label="Note (optional)" htmlFor="walkin-notes">
            <Input
              id="walkin-notes"
              placeholder="e.g. Small dent, screen clean"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <p className="text-muted flex items-start gap-1.5 text-xs">
            <Package className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            This records the payout only. To put the device on the shelf, restock it from the
            request afterwards and set a resale price — nothing becomes stock on its own.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !deviceLabel || !customerName || !amount}
            >
              {create.isPending ? 'Recording…' : 'Record payout'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
