'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, Search } from 'lucide-react';
import { useSellRequestPage } from '@/lib/data/hooks';
import type { SellRequest, SellStatus } from '@/lib/data/types';
import { SELL_STATUS_CLOSED, SELL_STATUS_FLOW, formatGBP, sellStatusLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip, type ChipTone } from '@/components/admin/status-chip';

const TONE: Record<SellStatus, ChipTone> = {
  submitted: 'warning',
  quoted: 'ink',
  accepted: 'success',
  declined: 'neutral',
  received: 'ink',
  paid: 'success',
  rejected: 'neutral',
};

const PAGE_SIZE = 25;

/**
 * The trade-in queue — devices customers have offered to sell us.
 *
 * Filters come in as PROPS, read from the URL by the server page. They are
 * deliberately not read here with `useSearchParams()`: that hook suspends the
 * component out of prerendering, and on a route like this the subtree never
 * resumed — the screen sat on skeletons and its data query never even
 * registered. See the note in inventory-view.tsx, which had exactly this bug.
 *
 * Everything below is gated on `tradein.manage`, enforced by the API on every
 * request; the page guard only decides what to render.
 */
export function TradeInQueueView({
  status,
  search,
  page,
}: {
  status?: SellStatus[];
  search?: string;
  page: number;
}) {
  const router = useRouter();
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isPending, isError, refetch } = useSellRequestPage({
    status,
    search,
    limit: PAGE_SIZE,
    offset,
  });

  /** Filters live in the URL so a queue view is shareable and survives reload. */
  const setParams = (next: { status?: SellStatus[]; search?: string; page?: number }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextSearch = next.search ?? search;
    if (nextStatus?.length) params.set('status', nextStatus.join(','));
    if (nextSearch) params.set('search', nextSearch);
    const nextPage = next.page ?? 1;
    if (nextPage > 1) params.set('page', String(nextPage));
    const qs = params.toString();
    router.push(`/admin/trade-ins${qs ? `?${qs}` : ''}`);
  };

  const activeStatus = status?.length === 1 ? status[0] : undefined;

  const columns = useMemo<ColumnDef<SellRequest>[]>(
    () => [
      {
        accessorKey: 'reference',
        header: 'Reference',
        cell: ({ row }) => (
          <Link
            href={`/admin/trade-ins/${row.original.id}`}
            className="text-ink font-semibold underline-offset-2 hover:underline"
          >
            {row.original.reference}
          </Link>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Customer',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="text-ink truncate font-medium">{row.original.name}</p>
            <p className="text-muted truncate text-xs">{row.original.email}</p>
          </div>
        ),
      },
      {
        id: 'device',
        header: 'Device',
        cell: ({ row }) => (
          <span className="text-muted">
            {row.original.deviceOther ?? row.original.deviceName ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusChip tone={TONE[row.original.status]}>
            {sellStatusLabel(row.original.status)}
          </StatusChip>
        ),
      },
      {
        accessorKey: 'quotedAmount',
        header: 'Our offer',
        cell: ({ row }) =>
          row.original.quotedAmount != null ? (
            <span className="tabular text-ink font-bold">
              {formatGBP(row.original.quotedAmount)}
            </span>
          ) : (
            // No figure at all until a person sets one — never a placeholder
            // that could read as a price.
            <span className="text-muted text-xs">Not quoted</span>
          ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Received',
        cell: ({ getValue }) => (
          <span className="text-muted tabular text-xs">{formatDateTime(getValue<string>())}</span>
        ),
      },
    ],
    [],
  );

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* Round 4 #FEAT-04: renamed from "Trade-ins", moved from Money to
          Operations — eyebrow now matches the group it actually lives in. */}
      <PageHeader
        eyebrow="Operations"
        title="Sell In Requests"
        description="Devices customers have offered us. Quotes are set by a person, never calculated."
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/trade-ins/payouts">Payout ledger</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant={activeStatus === undefined ? 'default' : 'outline'}
          size="sm"
          onClick={() => setParams({ status: [], page: 1 })}
        >
          All
        </Button>
        {[...SELL_STATUS_FLOW, ...SELL_STATUS_CLOSED].map((s) => (
          <Button
            key={s}
            variant={activeStatus === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setParams({ status: [s], page: 1 })}
          >
            {sellStatusLabel(s)}
          </Button>
        ))}
      </div>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get('search');
          setParams({ search: typeof value === 'string' ? value : '', page: 1 });
        }}
      >
        <Input
          name="search"
          defaultValue={search ?? ''}
          placeholder="Reference, name or email…"
          className="max-w-xs"
          aria-label="Search sell requests"
        />
        <Button type="submit" variant="outline" size="sm">
          <Search aria-hidden="true" />
          Search
        </Button>
      </form>

      <DataTable
        data={data?.items}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The trade-in queue didn’t load."
        onRetry={() => refetch()}
        pageSize={PAGE_SIZE}
        empty={{
          title: search || activeStatus ? 'Nothing matches that' : 'No sell requests yet',
          description:
            search || activeStatus
              ? 'Try a different status or search term.'
              : 'Requests from the website’s sell form arrive here.',
        }}
      />

      {total > PAGE_SIZE ? (
        <div className="text-muted mt-3 flex items-center justify-between text-sm">
          <span className="tabular">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setParams({ page: page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= lastPage}
              onClick={() => setParams({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-muted mt-6 flex items-center gap-2 text-xs">
        <ArrowDownLeft className="size-3.5 shrink-0" aria-hidden="true" />
        Payouts are money out — excluded from every revenue figure, and the cash ones are what the
        day-close subtracts.
      </p>
    </div>
  );
}
