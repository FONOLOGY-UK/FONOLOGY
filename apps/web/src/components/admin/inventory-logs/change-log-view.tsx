'use client';

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileDown } from 'lucide-react';
import { useDownloadInventoryLogPdf, useInventoryChangesPage } from '@/lib/data/hooks';
import type { InventoryChange, InventoryChangeType } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { useShopSelection } from '@/lib/stores/shop.store';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

/**
 * Log B — the change log (0104): every change to a product or option, written by the database
 * itself — prices, costs, names and other details, stock moving for any reason, products added,
 * retired and restored — with who did it. Nobody can edit or delete a row. Its own page and its
 * own PDF; goods in is a separate page and the two are never combined.
 */
const PAGE_SIZE = 50;

const TYPES: { id: InventoryChangeType | 'all'; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'stock', label: 'Stock' },
  { id: 'field', label: 'Prices & details' },
  { id: 'product', label: 'Added & retired' },
];

export function ChangeLogView() {
  const range = useAnalyticsRange();
  const allShops = useShopSelection((s) => s.selected) === 'all';
  const [type, setType] = useState<InventoryChangeType | 'all'>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [pageIndex, setPageIndex] = useState(0);
  const query = {
    from: range.query.from,
    to: range.query.to,
    search: deferredSearch || undefined,
    type: type === 'all' ? undefined : type,
  };
  const changes = useInventoryChangesPage({
    ...query,
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  });
  useEffect(() => setPageIndex(0), [range.query.from, range.query.to, deferredSearch, type]);
  const pdf = useDownloadInventoryLogPdf();

  const columns = useMemo<ColumnDef<InventoryChange>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'When',
        cell: ({ getValue }) => (
          <span className="text-muted tabular whitespace-nowrap">
            {formatDateTime(getValue<string>())}
          </span>
        ),
      },
      ...(allShops
        ? [{ accessorKey: 'shopName', header: 'Shop' } satisfies ColumnDef<InventoryChange>]
        : []),
      {
        id: 'product',
        header: 'Product',
        cell: ({ row }) => (
          <span className="text-ink block min-w-[160px] font-semibold">
            {row.original.productName}
            {row.original.variantLabel ? (
              <span className="text-muted font-normal"> ({row.original.variantLabel})</span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'what',
        header: 'Change',
        cell: ({ row }) => (
          <StatusChip tone={changeTone(row.original.change)}>{row.original.what}</StatusChip>
        ),
      },
      {
        id: 'beforeAfter',
        header: 'Before → after',
        cell: ({ row }) =>
          row.original.before === null && row.original.after === null ? (
            <span className="text-muted">—</span>
          ) : (
            <span className="tabular block max-w-[280px]">
              <span className="text-muted line-clamp-2">{row.original.before ?? '—'}</span>
              <span className="text-ink line-clamp-2 font-semibold">
                → {row.original.after ?? '—'}
              </span>
            </span>
          ),
      },
      {
        id: 'why',
        header: 'Why',
        cell: ({ row }) => (
          <span className="text-muted block max-w-[220px] text-xs">
            {[row.original.cause, row.original.note].filter(Boolean).join(' — ') || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'actorName',
        header: 'By',
        cell: ({ getValue }) =>
          getValue<string | null>() ?? <span className="text-muted">System</span>,
      },
    ],
    [allShops],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Logs"
        description="Every change to every product, recorded automatically and impossible to edit: prices, costs, details, stock and who changed them. Deliveries booked in are under Goods in."
        actionsAlign="start"
        actions={
          <div className="grid gap-2">
            <RangePicker {...range} />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={pdf.isPending}
              onClick={() =>
                pdf.mutate({
                  log: 'changes',
                  query,
                  filename: `inventory-log-${query.from}-to-${query.to}.pdf`,
                })
              }
            >
              <FileDown aria-hidden="true" />
              {pdf.isPending ? 'Making PDF…' : 'Download PDF'}
            </Button>
          </div>
        }
      />
      <DataTable
        data={changes.data?.items}
        server={{ total: changes.data?.total ?? 0, pageIndex, onPageChange: setPageIndex }}
        search={search}
        onSearchChange={setSearch}
        columns={columns}
        isLoading={changes.isPending}
        isError={changes.isError}
        errorMessage="The change log didn’t load."
        onRetry={() => changes.refetch()}
        searchPlaceholder="Search product or person…"
        pageSize={PAGE_SIZE}
        empty={{
          title: 'No changes in this range',
          description: 'Widen the dates, or pick “Everything”.',
        }}
        toolbar={
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Change type"
          >
            {TYPES.map((t) => (
              <TypeChip key={t.id} active={type === t.id} onClick={() => setType(t.id)}>
                {t.label}
              </TypeChip>
            ))}
            {changes.data ? (
              <span className="text-muted tabular ml-2 text-xs">{changes.data.total} changes</span>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

function changeTone(change: InventoryChange['change']) {
  if (change === 'stock') return 'neutral' as const;
  if (change === 'retired') return 'danger' as const;
  if (change === 'created' || change === 'restored') return 'success' as const;
  return 'accent' as const;
}

function TypeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
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
