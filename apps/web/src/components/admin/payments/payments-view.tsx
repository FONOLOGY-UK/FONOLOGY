'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileDown, Printer } from 'lucide-react';
import { useAnalytics, useTransactions } from '@/lib/data/hooks';
import type { Tender, Transaction } from '@/lib/data/types';
import { TENDERS, formatGBP, revenueStreamLabel, tenderLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { downloadCsv } from '@/lib/export';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HBarList } from '@/components/admin/charts/hbar-list';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

/**
 * Payments (item 7): the settled ledger, tagged by tender (Cash / POS 1 /
 * POS 2 / Online transfer / Stripe), plus the Payment Methods Report for a
 * date range. CSV export is a real client-side download; PDF goes through
 * the print dialog (browser Save as PDF).
 */
export function PaymentsView() {
  const range = useAnalyticsRange();
  const transactions = useTransactions(range.query);
  const analytics = useAnalytics(range.query);

  const [tenderFilter, setTenderFilter] = useState<Tender | 'all'>('all');

  const filtered = useMemo(() => {
    if (!transactions.data) return undefined;
    if (tenderFilter === 'all') return transactions.data;
    return transactions.data.filter((t) => t.tender === tenderFilter);
  }, [transactions.data, tenderFilter]);

  const byTender = analytics.data?.byTender ?? [];

  const exportCsv = () => {
    downloadCsv(
      `fonology-payment-methods-${range.query.from}-to-${range.query.to}.csv`,
      ['Payment method', 'Payments', 'Total (GBP)'],
      byTender.map((t) => [tenderLabel(t.tender), t.count, (t.total / 100).toFixed(2)]),
    );
  };

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
          <span className="block max-w-[240px] truncate">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'stream',
        header: 'Stream',
        cell: ({ row }) => (
          <StatusChip tone={row.original.stream === 'repair' ? 'accent' : 'neutral'}>
            {revenueStreamLabel(row.original.stream)}
          </StatusChip>
        ),
      },
      {
        accessorKey: 'tender',
        header: 'Method',
        cell: ({ row }) => <span className="text-muted">{tenderLabel(row.original.tender)}</span>,
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
      <PageHeader eyebrow="Money" title="Payments" actions={<RangePicker {...range} />} />

      {/* Payment methods report */}
      <section className="print-area border-line bg-card mb-4 rounded-lg border p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-ink text-sm font-extrabold uppercase tracking-[0.06em]">
              Payment methods report
            </h2>
            <p className="text-muted tabular text-xs">
              {range.query.from} → {range.query.to}
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={byTender.length === 0}
            >
              <FileDown aria-hidden="true" />
              CSV for Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Print / PDF
            </Button>
          </div>
        </div>
        {analytics.isPending ? (
          <Skeleton className="h-[160px] w-full" />
        ) : (
          <HBarList
            items={byTender
              .filter((t) => t.count > 0)
              .map((t) => ({
                key: t.tender,
                label: tenderLabel(t.tender),
                sub: `${t.count} payments`,
                value: t.total,
              }))}
            formatValue={(v) => formatGBP(v)}
          />
        )}
      </section>

      <DataTable
        data={filtered}
        columns={columns}
        isLoading={transactions.isPending}
        isError={transactions.isError}
        errorMessage="The payments ledger didn’t load."
        onRetry={() => transactions.refetch()}
        searchPlaceholder="Search ref or description…"
        pageSize={12}
        empty={{
          title: 'No payments in this range',
          description: 'Widen the date range, or take some money.',
        }}
        toolbar={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Payment method filter">
            <TenderChip active={tenderFilter === 'all'} onClick={() => setTenderFilter('all')}>
              All
            </TenderChip>
            {TENDERS.map((tender) => (
              <TenderChip
                key={tender}
                active={tenderFilter === tender}
                onClick={() => setTenderFilter(tender)}
              >
                {tenderLabel(tender)}
              </TenderChip>
            ))}
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
