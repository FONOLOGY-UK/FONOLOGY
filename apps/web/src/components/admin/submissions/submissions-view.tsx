'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Mail, Phone, ArrowUpRight } from 'lucide-react';
import { useBookings, useDevices, useJobs, useRepairTypes } from '@/lib/data/hooks';
import type { Booking, BookingStatus } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip, type ChipTone } from '@/components/admin/status-chip';

/**
 * Form Submissions (BUG-15-followup #11).
 *
 * Sell-in submissions ("sell my phone") already have a full dedicated admin
 * surface — the Trade-ins queue (search, statuses, contact details, a
 * detail view) — so this page doesn't rebuild that; it links to it. The
 * real gap this closes is mail-in repair BOOKINGS: before this, the only
 * place `useBookings()` was ever read was inside the "Add job" dialog's
 * booking picker, to prefill a new job — there was nowhere to just browse
 * what customers have actually submitted and get in touch, independent of
 * whether staff have turned it into a job yet.
 *
 * "Send shipping labels" (as asked for in the report) is contact details
 * made easy to act on — a tap-to-call, a tap-to-email, a one-click address
 * copy for whatever process staff already use to book a courier or print a
 * label at the counter — not a new courier-API integration inventing a
 * "generate and post a label" feature that doesn't exist anywhere else in
 * this app. That's a real, larger feature if the shop wants it; this page
 * doesn't quietly assume its way into building it.
 */

const STATUS_TONE: Record<BookingStatus, ChipTone> = {
  received: 'warning',
  'in-progress': 'ink',
  ready: 'accent',
  dispatched: 'success',
  cancelled: 'neutral',
};

function bookingStatusLabel(status: BookingStatus): string {
  switch (status) {
    case 'received':
      return 'Received';
    case 'in-progress':
      return 'In progress';
    case 'ready':
      return 'Ready';
    case 'dispatched':
      return 'Dispatched';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function SubmissionsView() {
  const { data: bookings, isPending, isError, refetch } = useBookings();
  const { data: devices } = useDevices();
  const { data: repairTypes } = useRepairTypes();
  const { data: jobs } = useJobs();

  // Same "already claimed by a job" check the Add Job dialog uses — staff
  // scanning this list need to know at a glance which submissions still
  // need turning into bench work, not just which exist.
  const linkedBookingIds = useMemo(
    () => new Set((jobs ?? []).map((j) => j.bookingId).filter((id): id is string => Boolean(id))),
    [jobs],
  );

  const columns = useMemo<ColumnDef<Booking>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Submitted',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: 'reference',
        header: 'Booking',
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="tabular text-ink block font-bold">{row.original.reference}</span>
            <span className="text-muted block truncate text-xs">{row.original.name}</span>
          </div>
        ),
      },
      {
        id: 'device',
        header: 'Device / repair',
        cell: ({ row }) => (
          <span className="text-[13px]">
            {devices?.find((d) => d.id === row.original.deviceId)?.name ?? 'Device'} —{' '}
            {repairTypes?.find((r) => r.id === row.original.repairId)?.name ?? 'Repair'}
          </span>
        ),
      },
      {
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => {
          const b = row.original;
          return (
            <div className="grid gap-0.5 text-[13px]">
              <a href={`tel:${b.phone}`} className="hover:text-ink flex items-center gap-1.5">
                <Phone className="text-muted size-3" aria-hidden="true" />
                {b.phone}
              </a>
              <a href={`mailto:${b.email}`} className="hover:text-ink flex items-center gap-1.5">
                <Mail className="text-muted size-3" aria-hidden="true" />
                {b.email}
              </a>
            </div>
          );
        },
      },
      {
        id: 'address',
        header: 'Address',
        cell: ({ row }) => (
          <span className="block max-w-[220px] truncate text-[13px]" title={row.original.address}>
            {row.original.address} · {row.original.postcode}
          </span>
        ),
      },
      {
        accessorKey: 'price',
        header: 'Quote',
        cell: ({ getValue }) => {
          const price = getValue<number | null>();
          return (
            <span className="tabular">{price != null ? formatGBP(price) : 'On diagnosis'}</span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusChip tone={STATUS_TONE[row.original.status]}>
            {bookingStatusLabel(row.original.status)}
          </StatusChip>
        ),
      },
      {
        id: 'job',
        header: 'Job',
        cell: ({ row }) =>
          linkedBookingIds.has(row.original.id) ? (
            <span className="text-muted text-xs">On the bench</span>
          ) : (
            <Link
              href="/admin/jobs"
              className="text-ink inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
            >
              Not started
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          ),
      },
    ],
    [devices, repairTypes, linkedBookingIds],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Form submissions"
        description={
          <>
            Mail-in repair bookings customers have submitted through the website. Sell-in (trade-in)
            submissions have their own queue —{' '}
            <Link href="/admin/trade-ins" className="text-ink underline underline-offset-2">
              see Trade-ins
            </Link>
            .
          </>
        }
      />

      <DataTable
        data={bookings}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The submissions list didn’t load."
        onRetry={() => refetch()}
        searchPlaceholder="Search name, reference, phone, email…"
        globalFilterFn={(b, query) =>
          [b.reference, b.name, b.phone, b.email, b.address, b.postcode]
            .join(' ')
            .toLowerCase()
            .includes(query)
        }
        pageSize={20}
        empty={{
          title: 'No submissions yet',
          description: 'Mail-in repair bookings from the website land here.',
        }}
      />
    </div>
  );
}
