'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileDown } from 'lucide-react';
import { useDownloadInventoryLogPdf, useStockIntakesPage } from '@/lib/data/hooks';
import type { StockIntake } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { useShopSelection } from '@/lib/stores/shop.store';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';

/**
 * Log A — goods in (0103): every supplier delivery booked in on a till, for the shop in the
 * switcher or all shops. Its own page and its own PDF; the change log is a separate page and the
 * two are never shown or exported together. Costs only appear for people with costs.view (the API
 * sends null otherwise).
 */
const PAGE_SIZE = 25;

export function GoodsInLogView() {
  const range = useAnalyticsRange();
  const allShops = useShopSelection((s) => s.selected) === 'all';
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [pageIndex, setPageIndex] = useState(0);
  const query = {
    from: range.query.from,
    to: range.query.to,
    search: deferredSearch || undefined,
  };
  const intakes = useStockIntakesPage({
    ...query,
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  });
  useEffect(() => setPageIndex(0), [range.query.from, range.query.to, deferredSearch]);
  const pdf = useDownloadInventoryLogPdf();
  const showCosts = intakes.data?.items.some((i) => i.totalCost !== null) ?? false;

  const columns = useMemo<ColumnDef<StockIntake>[]>(
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
      {
        accessorKey: 'reference',
        header: 'Ref',
        cell: ({ getValue }) => <span className="tabular font-bold">{getValue<string>()}</span>,
      },
      ...(allShops
        ? [{ accessorKey: 'shopName', header: 'Shop' } satisfies ColumnDef<StockIntake>]
        : []),
      {
        id: 'supplier',
        header: 'Supplier',
        cell: ({ row }) => (
          <div className="min-w-[120px]">
            <div className="text-ink">{row.original.supplierName ?? '—'}</div>
            {row.original.supplierRef ? (
              <div className="text-muted text-xs">{row.original.supplierRef}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: 'items',
        header: 'Items',
        cell: ({ row }) => (
          <ul className="min-w-[220px] space-y-0.5">
            {row.original.lines.map((l, i) => (
              <li key={`${l.productId}-${l.variantId ?? ''}-${i}`}>
                <span className="tabular font-semibold">{l.qty} ×</span> {l.name}
                {l.variantLabel ? <span className="text-muted"> ({l.variantLabel})</span> : null}
                {l.unitCost !== null ? (
                  <span className="text-muted tabular"> @ {formatGBP(l.unitCost)}</span>
                ) : null}
              </li>
            ))}
            {row.original.notes ? (
              <li className="text-muted text-xs">Note: {row.original.notes}</li>
            ) : null}
          </ul>
        ),
      },
      {
        accessorKey: 'unitCount',
        header: 'Units',
        cell: ({ getValue }) => <span className="tabular font-bold">{getValue<number>()}</span>,
      },
      ...(showCosts
        ? [
            {
              accessorKey: 'totalCost',
              header: 'Cost',
              cell: ({ getValue }) => {
                const v = getValue<number | null>();
                return <span className="tabular">{v === null ? '—' : formatGBP(v)}</span>;
              },
            } satisfies ColumnDef<StockIntake>,
          ]
        : []),
      { accessorKey: 'staffName', header: 'Booked in by' },
    ],
    [allShops, showCosts],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Goods in"
        description="Every delivery booked in on a till — what arrived, from whom, and who booked it. Stock and price changes are on Logs."
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
                  log: 'goods-in',
                  query,
                  filename: `goods-in-${query.from}-to-${query.to}.pdf`,
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
        data={intakes.data?.items}
        server={{ total: intakes.data?.total ?? 0, pageIndex, onPageChange: setPageIndex }}
        search={search}
        onSearchChange={setSearch}
        columns={columns}
        isLoading={intakes.isPending}
        isError={intakes.isError}
        errorMessage="Goods in didn’t load."
        onRetry={() => intakes.refetch()}
        searchPlaceholder="Search ref, supplier or item…"
        pageSize={PAGE_SIZE}
        empty={{
          title: 'No deliveries in this range',
          description: 'Deliveries are booked in on the till, under Goods in.',
        }}
        toolbar={
          intakes.data ? (
            <span className="text-muted tabular text-xs">
              {intakes.data.total} {intakes.data.total === 1 ? 'delivery' : 'deliveries'}
            </span>
          ) : null
        }
      />
    </div>
  );
}
