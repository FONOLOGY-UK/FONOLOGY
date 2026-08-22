'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useStaff, useTransactions } from '@/lib/data/hooks';
import type { Tender, Transaction } from '@/lib/data/types';
import { TENDERS, formatGBP, tenderLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';
import { cn } from '@/lib/utils';

/**
 * Counter Sales (FEATURE-13) — in-person POS sales specifically, not the full
 * mixed ledger Payments shows.
 *
 * "Counter sale" = a `shop`-stream transaction with a staff id attached.
 * `transactions` (0013) gives every `orders` row `staff_id: null` — nobody
 * rang it up, it arrived unattended online — while every `sales` row always
 * carries whoever ran the till. A refund a staff member processes against
 * either one also carries their id, and stays visible here (negative amount,
 * "Refund" in the description) rather than being filtered out, because it's
 * still something that happened at the counter.
 *
 * Staff and payment-type filtering both go to the server (`GET
 * /reports/transactions`'s staffId/tender params) rather than being computed
 * client-side over the full ledger like Payments' tender filter does — a
 * split-tender till sale has no single `tender` to match client-side (see
 * Payments, which currently loses those rows on any tender filter); the
 * server checks the real `sale_payments` legs instead.
 */
export function SalesView() {
  const range = useAnalyticsRange();
  const { data: staff } = useStaff();

  const [staffFilter, setStaffFilter] = useState<string | 'all'>('all');
  const [tenderFilter, setTenderFilter] = useState<Tender | 'all'>('all');

  const transactions = useTransactions({
    ...range.query,
    staffId: staffFilter === 'all' ? undefined : staffFilter,
    // The query type also allows 'stripe' (a checkout-facing concept elsewhere
    // in this codebase), but it can never appear in a till transaction's
    // tender — narrowed here so the request only ever asks for a real one.
    tender: tenderFilter === 'all' || tenderFilter === 'stripe' ? undefined : tenderFilter,
  });

  const counterSales = useMemo(
    () => (transactions.data ?? []).filter((t) => t.stream === 'shop' && t.staffId != null),
    [transactions.data],
  );

  const staffOptions = staff?.filter((s) => s.active) ?? [];

  const columns = useMemo<ColumnDef<Transaction>[]>(
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
        accessorKey: 'description',
        header: 'Description',
        cell: ({ getValue }) => (
          <span className="block max-w-[220px] truncate">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'staffName',
        header: 'Staff',
        cell: ({ row }) => <span className="text-ink-2">{row.original.staffName ?? '—'}</span>,
      },
      {
        accessorKey: 'tender',
        header: 'Method',
        cell: ({ row }) => {
          const { tender, tenders } = row.original;
          if (tender) return <span className="text-muted">{tenderLabel(tender)}</span>;
          // Split-tender sale — tenders (0037/FEATURE-13) lists what it was
          // actually paid across; show that instead of the "Mixed" fallback.
          if (tenders && tenders.length > 0) {
            return (
              <span className="text-muted" title="Split payment">
                {tenders.map((t) => tenderLabel(t)).join(' + ')}
              </span>
            );
          }
          return <span className="text-muted">{tenderLabel(null)}</span>;
        },
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ getValue }) => {
          const amount = getValue<number>();
          return (
            <span className={cn('tabular font-bold', amount < 0 ? 'text-red-deep' : 'text-ink')}>
              {amount < 0 ? '−' : ''}
              {formatGBP(Math.abs(amount))}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Counter Sales"
        description="In-person POS sales — rung up at the till, by whoever rang them up."
        actions={<RangePicker {...range} />}
      />

      <DataTable
        data={transactions.isPending ? undefined : counterSales}
        columns={columns}
        isLoading={transactions.isPending}
        isError={transactions.isError}
        errorMessage="The sales ledger didn’t load."
        onRetry={() => transactions.refetch()}
        searchPlaceholder="Search ref or description…"
        pageSize={12}
        empty={{
          title: 'No counter sales in this range',
          description: 'Widen the date range, or a different filter.',
        }}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Payment method filter">
              <TenderChip active={tenderFilter === 'all'} onClick={() => setTenderFilter('all')}>
                All methods
              </TenderChip>
              {TENDERS.filter((t) => t !== 'stripe').map((tender) => (
                <TenderChip
                  key={tender}
                  active={tenderFilter === tender}
                  onClick={() => setTenderFilter(tender)}
                >
                  {tenderLabel(tender)}
                </TenderChip>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold">
              <span className="text-muted">Staff</span>
              <select
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                className="border-input rounded-ui bg-card h-8 border px-2 text-xs"
              >
                <option value="all">Everyone</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      />
    </div>
  );
}

function TenderChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors duration-150',
        active ? 'bg-ink text-bone' : 'bg-paper-2 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
