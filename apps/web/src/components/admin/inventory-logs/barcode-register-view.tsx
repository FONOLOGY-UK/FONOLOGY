'use client';

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileDown } from 'lucide-react';
import { useDownloadBarcodeRegisterPdf, useRegisteredBarcodesPage } from '@/lib/data/hooks';
import type { BarcodeRegisterFilter, RegisteredBarcode } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { useShopSelection } from '@/lib/stores/shop.store';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

/**
 * The Goods in barcode register (client changes, Oct 2026 #8; 0123): every barcode registered while
 * booking a delivery in — put on an existing product, on a product made there and then, or saved
 * to link later — with the product it went to (or "Not linked yet") and the quantity added. Its
 * own page and PDF, beside Goods in (Log A) and the change log (Log B).
 */
const PAGE_SIZE = 25;

const STATUSES: { id: BarcodeRegisterFilter | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'linked', label: 'Linked' },
  { id: 'to_link', label: 'Waiting to be linked' },
];

export function BarcodeRegisterView() {
  const range = useAnalyticsRange();
  const allShops = useShopSelection((s) => s.selected) === 'all';
  const [status, setStatus] = useState<BarcodeRegisterFilter | 'all'>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [pageIndex, setPageIndex] = useState(0);
  const query = {
    from: range.query.from,
    to: range.query.to,
    search: deferredSearch || undefined,
    status: status === 'all' ? undefined : status,
  };
  const rows = useRegisteredBarcodesPage({
    ...query,
    limit: PAGE_SIZE,
    offset: pageIndex * PAGE_SIZE,
  });
  useEffect(() => setPageIndex(0), [range.query.from, range.query.to, deferredSearch, status]);
  const pdf = useDownloadBarcodeRegisterPdf();

  const columns = useMemo<ColumnDef<RegisteredBarcode>[]>(
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
        ? [{ accessorKey: 'shopName', header: 'Shop' } satisfies ColumnDef<RegisteredBarcode>]
        : []),
      {
        accessorKey: 'barcode',
        header: 'Barcode',
        cell: ({ getValue }) => <span className="tabular font-semibold">{getValue<string>()}</span>,
      },
      {
        id: 'product',
        header: 'Product',
        cell: ({ row }) =>
          row.original.productName ? (
            <span className="text-ink block min-w-[160px] font-semibold">
              {row.original.productName}
              {row.original.variantLabel ? (
                <span className="text-muted font-normal"> ({row.original.variantLabel})</span>
              ) : null}
            </span>
          ) : (
            <span className="block min-w-[160px]">
              <StatusChip tone="warning">Not linked yet</StatusChip>
              {row.original.itemName ? (
                <span className="text-muted mt-1 block text-xs">{row.original.itemName}</span>
              ) : null}
            </span>
          ),
      },
      {
        accessorKey: 'qty',
        header: 'Qty',
        cell: ({ row }) => (
          <span className="tabular">
            {row.original.qty}
            {row.original.status === 'to_link' ? (
              <span className="text-muted text-xs"> waiting</span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'intakeReference',
        header: 'Delivery',
        cell: ({ getValue }) => <span className="tabular text-xs">{getValue<string>()}</span>,
      },
      {
        id: 'by',
        header: 'By',
        cell: ({ row }) => (
          <span className="text-xs">
            {row.original.staffName}
            {row.original.linkedByName &&
            row.original.linkedAt &&
            row.original.linkedByName !== row.original.staffName ? (
              <span className="text-muted block">
                linked by {row.original.linkedByName}, {formatDateTime(row.original.linkedAt)}
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [allShops],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Barcode register"
        description="Every barcode registered while booking a delivery in on a till: the product it went to, or that it is still waiting to be linked, and how many arrived. Stock for a waiting barcode is added when someone links it on the till's Goods in screen."
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
                  query,
                  filename: `goods-in-barcodes-${query.from}-to-${query.to}.pdf`,
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
        data={rows.data?.items}
        server={{ total: rows.data?.total ?? 0, pageIndex, onPageChange: setPageIndex }}
        search={search}
        onSearchChange={setSearch}
        columns={columns}
        isLoading={rows.isPending}
        isError={rows.isError}
        errorMessage="The barcode register didn’t load."
        onRetry={() => rows.refetch()}
        searchPlaceholder="Search barcode or product…"
        pageSize={PAGE_SIZE}
        empty={{
          title: 'No barcodes registered in this range',
          description: 'They appear here when a delivery booked in on a till registers one.',
        }}
        toolbar={
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <Chip key={s.id} active={status === s.id} onClick={() => setStatus(s.id)}>
                {s.label}
              </Chip>
            ))}
            {rows.data ? (
              <span className="text-muted tabular ml-2 text-xs">{rows.data.total} barcodes</span>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

function Chip({
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
