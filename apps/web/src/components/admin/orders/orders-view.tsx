'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Package, Store, Truck } from 'lucide-react';
import { useOrders, useUpdateOrderStatus } from '@/lib/data/hooks';
import type { Order, OrderStatus } from '@/lib/data/types';
import { formatGBP, nextOrderStatuses, orderStatusLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

/**
 * Online orders — the incoming web queue, separate from counter sales.
 *
 * The dashboard's Overview answers "how is the business doing"; this page
 * answers the only question that matters on a weekday morning: *what do I
 * have to pack and send today*. So it opens on the orders that need hands
 * (paid / awaiting payment), sorts oldest-first inside that, and puts the
 * next fulfilment step one click away on every row.
 *
 * Counter sales live in the Payments ledger — they never appear here.
 */

const STATUS_TONE: Record<OrderStatus, 'success' | 'warning' | 'accent' | 'neutral'> = {
  pending: 'warning',
  paid: 'accent',
  ready: 'accent',
  shipped: 'success',
  collected: 'success',
  cancelled: 'neutral',
};

/** Orders that still need someone to do something. */
const OPEN_STATUSES: OrderStatus[] = ['pending', 'paid', 'ready'];

type Filter = 'todo' | 'all' | OrderStatus;

export function OrdersView() {
  const orders = useOrders();
  const updateStatus = useUpdateOrderStatus();
  const [filter, setFilter] = useState<Filter>('todo');

  const all = useMemo(() => orders.data ?? [], [orders.data]);

  const counts = useMemo(
    () => ({
      todo: all.filter((o) => OPEN_STATUSES.includes(o.status)).length,
      pending: all.filter((o) => o.status === 'pending').length,
      paid: all.filter((o) => o.status === 'paid').length,
      ready: all.filter((o) => o.status === 'ready').length,
    }),
    [all],
  );

  const rows = useMemo(() => {
    const list =
      filter === 'todo'
        ? all.filter((o) => OPEN_STATUSES.includes(o.status))
        : filter === 'all'
          ? all
          : all.filter((o) => o.status === filter);
    // Oldest first while there's work to do — the queue people waited in.
    // Everything else reads newest first, like a history.
    const openView = filter === 'todo' || OPEN_STATUSES.includes(filter as OrderStatus);
    return [...list].sort((a, b) =>
      openView ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt),
    );
  }, [all, filter]);

  const toFulfil = useMemo(
    () => all.filter((o) => o.status === 'paid' || o.status === 'ready'),
    [all],
  );
  const owedValue = toFulfil.reduce((sum, o) => sum + o.total, 0);

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Placed',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: 'reference',
        header: 'Order',
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="tabular text-ink block font-bold">{row.original.reference}</span>
            <span className="text-muted block truncate text-xs">{row.original.name}</span>
          </div>
        ),
      },
      {
        id: 'items',
        header: 'Items',
        accessorFn: (o) => o.lines.map((l) => l.name).join(' '),
        cell: ({ row }) => {
          const lines = row.original.lines;
          const units = lines.reduce((s, l) => s + l.quantity, 0);
          return (
            <div className="min-w-0">
              <span
                className="block max-w-[240px] truncate text-[13px]"
                title={lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}
              >
                {lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}
              </span>
              <span className="text-muted text-xs">
                {units} item{units === 1 ? '' : 's'}
              </span>
            </div>
          );
        },
      },
      {
        id: 'delivery',
        header: 'Going',
        accessorFn: (o) => o.delivery,
        cell: ({ row }) => {
          const o = row.original;
          const collect = o.delivery === 'collect';
          return (
            <div className="flex items-start gap-1.5">
              {collect ? (
                <Store className="text-muted mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Truck className="text-muted mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <span className="block text-[13px] font-medium">
                  {collect ? 'Collection' : DELIVERY_LABEL[o.delivery]}
                </span>
                {o.postcode ? (
                  <span className="text-muted tabular block text-xs">{o.postcode}</span>
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'total',
        header: 'Total',
        cell: ({ getValue }) => (
          <span className="tabular text-ink font-bold">{formatGBP(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusChip tone={STATUS_TONE[row.original.status]}>
            {orderStatusLabel(row.original.status)}
          </StatusChip>
        ),
      },
      {
        id: 'actions',
        header: 'Next step',
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          const moves = nextOrderStatuses(order.status, order.delivery);
          if (moves.length === 0) {
            return <span className="text-muted text-xs">Done</span>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              {moves.map((next) => (
                <Button
                  key={next}
                  size="sm"
                  variant={next === 'cancelled' ? 'ghost' : 'secondary'}
                  className={cn('h-7 px-2 text-[11px]', next === 'cancelled' && 'text-muted')}
                  disabled={updateStatus.isPending}
                  onClick={() => updateStatus.mutate({ id: order.id, status: next })}
                >
                  {ACTION_LABEL[next]}
                </Button>
              ))}
            </div>
          );
        },
      },
    ],
    [updateStatus],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Online orders"
        description="Orders placed on the website. Counter sales are in Payments."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Needs packing or handover"
          value={`${toFulfil.length}`}
          sub={toFulfil.length > 0 ? `${formatGBP(owedValue)} of goods` : 'All caught up'}
          urgent={toFulfil.length > 0}
        />
        <SummaryCard
          label="Awaiting payment"
          value={`${counts.pending}`}
          sub="Not yet paid — don't dispatch"
        />
        <SummaryCard
          label="Orders today"
          value={`${all.filter((o) => isToday(o.createdAt)).length}`}
          sub="Placed since midnight"
        />
      </div>

      <DataTable
        data={orders.isPending ? undefined : rows}
        columns={columns}
        isLoading={orders.isPending}
        isError={orders.isError}
        errorMessage="The online orders didn’t load."
        onRetry={() => orders.refetch()}
        searchPlaceholder="Search reference, customer or item…"
        pageSize={12}
        empty={{
          title: filter === 'todo' ? 'Nothing to fulfil' : 'No orders here',
          description:
            filter === 'todo'
              ? 'Every paid order has been sent or handed over. Switch to “All” for history.'
              : 'No orders match this filter yet.',
        }}
        toolbar={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Order filter">
            <FilterChip active={filter === 'todo'} onClick={() => setFilter('todo')}>
              To fulfil{counts.todo > 0 ? ` (${counts.todo})` : ''}
            </FilterChip>
            <FilterChip active={filter === 'paid'} onClick={() => setFilter('paid')}>
              Paid{counts.paid > 0 ? ` (${counts.paid})` : ''}
            </FilterChip>
            <FilterChip active={filter === 'ready'} onClick={() => setFilter('ready')}>
              Ready{counts.ready > 0 ? ` (${counts.ready})` : ''}
            </FilterChip>
            <FilterChip active={filter === 'pending'} onClick={() => setFilter('pending')}>
              Unpaid{counts.pending > 0 ? ` (${counts.pending})` : ''}
            </FilterChip>
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterChip>
          </div>
        }
      />
    </div>
  );
}

/* ---- bits ------------------------------------------------------------------ */

const DELIVERY_LABEL: Record<string, string> = {
  collect: 'Collection',
  standard: 'Standard post',
  'next-day': 'Next day',
  remote: 'Remote area',
};

/** Buttons say what the person is about to DO, not the status name. */
const ACTION_LABEL: Record<OrderStatus, string> = {
  pending: 'Mark paid',
  paid: 'Mark paid',
  ready: 'Ready to collect',
  shipped: 'Mark shipped',
  collected: 'Mark collected',
  cancelled: 'Cancel',
};

function isToday(iso: string): boolean {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return new Date(iso).getTime() >= start.getTime();
}

function SummaryCard({
  label,
  value,
  sub,
  urgent,
}: {
  label: string;
  value: string;
  sub: string;
  urgent?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-line bg-card rounded-lg border p-4',
        urgent && 'border-red/30 bg-red-tint/30',
      )}
    >
      <p className="text-muted flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]">
        {urgent ? <Package className="text-red-deep size-3.5" aria-hidden="true" /> : null}
        {label}
      </p>
      <p className="font-display text-ink tabular mt-1 text-2xl font-extrabold">{value}</p>
      <p className="text-muted text-xs">{sub}</p>
    </div>
  );
}

function FilterChip({
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
