'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Package, Store, Truck } from 'lucide-react';
import { useOrders, useUpdateOrderStatus } from '@/lib/data/hooks';
import type { Order, OrderStatus } from '@/lib/data/types';
import { formatGBP, nextOrderStatuses, orderStatusLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/admin/field';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

/**
 * Online orders — the incoming web queue, separate from counter sales.
 *
 * The dashboard's Overview answers "how is the business doing"; this page
 * answers the only question that matters on a weekday morning: *what do I
 * have to pack and send today*. So it opens on the orders that need hands,
 * sorts oldest-first inside that, and puts the next fulfilment step one
 * click away on every row.
 *
 * An order still `pending` (unpaid) never appears in the fulfilment queue
 * below — this page answers "what do I have to pack and send", and an
 * order nobody has paid for yet is nothing to fulfil. It still exists in
 * the database the moment it's placed (Stripe order-first, see
 * CLAUDE.md), so a payment that Stripe actually took but whose webhook
 * never reached the API (Round 3 #1.2 — a dev-only failure mode when
 * `stripe listen` isn't running, see ENV-SETUP-GUIDE.md) would otherwise
 * sit invisible forever. `StuckPaymentsNotice` below surfaces that case —
 * deliberately as a standalone, collapsed-by-default notice above the
 * table, not as a row or filter mixed into the fulfil queue, since these
 * aren't "waiting to be packed", they're "need a human to check Stripe".
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

/** Orders that still need someone to do something (pending is never in scope here — see above). */
const OPEN_STATUSES: OrderStatus[] = ['paid', 'ready'];

type Filter = 'todo' | 'all';

export function OrdersView() {
  const orders = useOrders();
  const updateStatus = useUpdateOrderStatus();
  const [filter, setFilter] = useState<Filter>('todo');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Shipping needs a courier + tracking number — set here rather than
  // firing the status move straight away, same as any other action that
  // needs more than one click's worth of information.
  const [shippingOrder, setShippingOrder] = useState<Order | null>(null);

  // Payment-incomplete orders never appear on this page, full stop — see the
  // header comment. Every count, filter and total below is computed from
  // this already-filtered list, not the raw fetch.
  const all = useMemo(
    () => (orders.data ?? []).filter((o) => o.status !== 'pending'),
    [orders.data],
  );

  const counts = useMemo(
    () => ({
      todo: all.filter((o) => OPEN_STATUSES.includes(o.status)).length,
    }),
    [all],
  );

  const dateFiltered = useMemo(() => {
    if (!dateFrom && !dateTo) return all;
    return all.filter((o) => {
      const day = o.createdAt.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }, [all, dateFrom, dateTo]);

  const rows = useMemo(() => {
    const list =
      filter === 'todo'
        ? dateFiltered.filter((o) => OPEN_STATUSES.includes(o.status))
        : dateFiltered;
    // Oldest first while there's work to do — the queue people waited in.
    // Everything else reads newest first, like a history.
    return [...list].sort((a, b) =>
      filter === 'todo'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
  }, [dateFiltered, filter]);

  const toFulfil = useMemo(
    () => all.filter((o) => o.status === 'paid' || o.status === 'ready'),
    [all],
  );
  const owedValue = toFulfil.reduce((sum, o) => sum + o.total, 0);

  // Round 3 #1.2: an order still `pending` 10+ minutes after being placed
  // almost certainly means Stripe took the payment but the confirmation
  // webhook never landed — a fresh checkout in progress is seconds old,
  // not minutes. 10 minutes gives a genuinely slow card entry plenty of
  // room without flagging normal traffic.
  const stuckPending = useMemo(
    () =>
      (orders.data ?? []).filter(
        (o) =>
          o.status === 'pending' && Date.now() - new Date(o.createdAt).getTime() > 10 * 60 * 1000,
      ),
    [orders.data],
  );
  const [stuckOpen, setStuckOpen] = useState(false);

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
                  onClick={() =>
                    next === 'shipped'
                      ? setShippingOrder(order)
                      : updateStatus.mutate({ id: order.id, status: next })
                  }
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

      {stuckPending.length > 0 ? (
        <StuckPaymentsNotice orders={stuckPending} open={stuckOpen} onToggle={setStuckOpen} />
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SummaryCard
          label="Unfulfilled"
          value={`${toFulfil.length}`}
          sub={toFulfil.length > 0 ? `${formatGBP(owedValue)} of goods` : 'All caught up'}
          urgent={toFulfil.length > 0}
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
          title: filter === 'todo' ? 'Nothing to fulfill' : 'No orders here',
          description:
            filter === 'todo'
              ? 'Every paid order has been sent or handed over. Switch to “All” for history.'
              : 'No orders match this filter yet.',
        }}
        toolbar={
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Order filter">
              <FilterChip active={filter === 'todo'} onClick={() => setFilter('todo')}>
                To fulfill{counts.todo > 0 ? ` (${counts.todo})` : ''}
              </FilterChip>
              <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </FilterChip>
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="Date range">
              <Input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                className="tabular h-9 w-auto"
                aria-label="From date"
              />
              <span className="text-muted text-xs">to</span>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="tabular h-9 w-auto"
                aria-label="To date"
              />
              {dateFrom || dateTo ? (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                  className="text-muted hover:text-ink text-xs underline underline-offset-2"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        }
      />

      <ShipOrderDialog
        order={shippingOrder}
        onOpenChange={(open) => (open ? undefined : setShippingOrder(null))}
        onSubmit={(courier, trackingNumber) => {
          if (!shippingOrder) return;
          updateStatus.mutate(
            { id: shippingOrder.id, status: 'shipped', courier, trackingNumber },
            { onSuccess: () => setShippingOrder(null) },
          );
        }}
        pending={updateStatus.isPending}
      />
    </div>
  );
}

/* ---- bits ------------------------------------------------------------------ */

function ShipOrderDialog({
  order,
  onOpenChange,
  onSubmit,
  pending,
}: {
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (courier: string, trackingNumber: string) => void;
  pending: boolean;
}) {
  const [courier, setCourier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  // Reset the form each time a different order is opened, not on every
  // render — an open dialog for the same order shouldn't clear itself out
  // from under someone mid-type.
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (order && order.id !== openFor) {
    setOpenFor(order.id);
    setCourier('');
    setTrackingNumber('');
  }

  const canSubmit = courier.trim().length > 0 && trackingNumber.trim().length > 0;

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark as shipped</DialogTitle>
        </DialogHeader>
        {order ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) onSubmit(courier.trim(), trackingNumber.trim());
            }}
          >
            <p className="text-muted -mt-1 text-sm">
              {order.reference} — both fields are required before this order can move to shipped.
            </p>
            <Field label="Courier" htmlFor="ship-courier">
              <Input
                id="ship-courier"
                placeholder="e.g. Royal Mail, DPD"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Tracking number" htmlFor="ship-tracking">
              <Input
                id="ship-tracking"
                placeholder="e.g. AB123456789GB"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || pending}>
                {pending ? 'Marking as shipped…' : 'Mark as shipped'}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

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

/**
 * Round 3 #1.2 — a diagnostic notice, not a fulfilment action. These orders
 * are `pending`: Stripe may or may not have actually taken the money, and
 * finding out means checking the Stripe dashboard for that reference, not
 * clicking a button here. Collapsed by default so it doesn't compete with
 * the actual fulfil queue on a normal day; the count in the header is
 * enough to notice something needs a look.
 */
function StuckPaymentsNotice({
  orders,
  open,
  onToggle,
}: {
  orders: Order[];
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <div className="border-warning/40 bg-warning/10 mb-4 rounded-lg border">
      <button
        type="button"
        onClick={() => onToggle(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <AlertTriangle className="text-warning size-4 shrink-0" aria-hidden="true" />
        <span className="text-ink text-sm font-semibold">
          {orders.length} payment{orders.length === 1 ? '' : 's'} stuck unconfirmed
        </span>
        <span className="text-muted text-xs">
          — placed a while ago and still unpaid in our records. Possibly a webhook that never
          arrived; check Stripe before assuming the customer didn’t pay.
        </span>
        <span className="text-muted ml-auto text-xs underline underline-offset-2">
          {open ? 'Hide' : 'View'}
        </span>
      </button>
      {open ? (
        <ul className="border-warning/30 divide-warning/20 divide-y border-t px-4">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
              <span className="tabular text-ink font-bold">{o.reference}</span>
              <span className="text-muted">{o.name}</span>
              <span className="text-muted tabular">{formatGBP(o.total)}</span>
              <span className="text-muted tabular ml-auto text-xs">
                {formatDateTime(o.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
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
