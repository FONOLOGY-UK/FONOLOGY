'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Mail, Phone, ArrowUpRight } from 'lucide-react';
import {
  useBookings,
  useConvertBookingToJob,
  useDevices,
  useJobs,
  usePartTiers,
  useRepairConversionFields,
  useRepairTypes,
} from '@/lib/data/hooks';
import type {
  Booking,
  BookingStatus,
  JobConversionField,
  RepairConversionFields,
  RepairType,
} from '@/lib/data/types';
import {
  formatGBP,
  jobConversionFieldHint,
  jobConversionFieldLabel,
  pounds,
} from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip, type ChipTone } from '@/components/admin/status-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Repair Requests (BUG-15-followup #11) — renamed from "Form Submissions"
 * in Round 4 #FEAT-03; this file's own title/copy missed that rename at
 * the time, catching up now.
 *
 * Sell-in submissions ("sell my phone") already have a full dedicated admin
 * surface — the Sell In Requests queue (search, statuses, contact details, a
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

export function SubmissionsView({
  jobsHref = '/admin/jobs',
  tradeInsHref = '/admin/trade-ins',
}: {
  /**
   * Round 5 Phase 2 #6 — this view is shared verbatim by the new /pos/
   * submissions staff route. Both links below used to be hardcoded into
   * the admin panel regardless of where this view was mounted.
   */
  jobsHref?: string;
  tradeInsHref?: string;
} = {}) {
  const { data: bookings, isPending, isError, refetch } = useBookings();
  const { data: devices } = useDevices();
  const { data: repairTypes } = useRepairTypes();
  const { data: partTiers } = usePartTiers();
  const { data: jobs } = useJobs();
  /** Item 2 — which details each repair type needs at intake. Staff-only. */
  const { data: conversionFields } = useRepairConversionFields();

  // Round 5 #35: the table has no room to show the customer's actual
  // problem description (`notes`) — nowhere at all to read it before this.
  const [viewing, setViewing] = useState<Booking | null>(null);

  // Same "already claimed by a job" check the Add Job dialog uses — staff
  // scanning this list need to know at a glance which submissions still
  // need turning into bench work, not just which exist.
  const linkedBookingIds = useMemo(
    () => new Set((jobs ?? []).map((j) => j.bookingId).filter((id): id is string => Boolean(id))),
    [jobs],
  );

  /**
   * Change request item 2: "the original Repair Request record must then
   * update to display the newly generated Job Number".
   *
   * A join, not a new column — jobs.booking_id already carries the link and
   * this view already holds both lists. The request keeps its own FNL-
   * reference and the job has its own; they are separate sequences by
   * design (0006) and neither is renumbered.
   */
  const jobByBookingId = useMemo(() => {
    const map = new Map<string, { id: string; reference: string }>();
    for (const j of jobs ?? []) {
      if (j.bookingId) map.set(j.bookingId, { id: j.id, reference: j.reference });
    }
    return map;
  }, [jobs]);

  /** Change request item 2 — the request currently being sent to the bench. */
  const [converting, setConverting] = useState<Booking | null>(null);

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
            <div className="grid gap-0.5 text-[13px]" onClick={(e) => e.stopPropagation()}>
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
        cell: ({ row }) => {
          const job = jobByBookingId.get(row.original.id);
          // Item 2 — the job NUMBER, not just "on the bench". That is the
          // linkage the doc asks for, and it is what someone on the phone to
          // the customer actually needs to read out.
          if (job) {
            return (
              <Link
                href={jobsHref}
                className="text-ink tabular inline-flex items-center gap-1 text-xs font-bold underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                {job.reference}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            );
          }
          if (row.original.status === 'cancelled') {
            return <span className="text-muted text-xs">Cancelled</span>;
          }
          return (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setConverting(row.original);
              }}
            >
              <ArrowUpRight className="size-3" aria-hidden="true" />
              Send to Jobs
            </Button>
          );
        },
      },
    ],
    [devices, repairTypes, jobByBookingId, jobsHref],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Repair Requests"
        description={
          <>
            Mail-in repair bookings customers have submitted through the website. Sell-in (trade-in)
            submissions have their own queue —{' '}
            <Link href={tradeInsHref} className="text-ink underline underline-offset-2">
              see Sell In Requests
            </Link>
            .
          </>
        }
      />

      <SendToJobsDialog
        booking={converting}
        repairTypes={repairTypes ?? []}
        conversionFields={conversionFields ?? {}}
        onClose={() => setConverting(null)}
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
        onRowClick={(b) => setViewing(b)}
      />

      <BookingDetailsDialog
        booking={viewing}
        deviceName={
          viewing ? (devices?.find((d) => d.id === viewing.deviceId)?.name ?? null) : null
        }
        repairName={
          viewing ? (repairTypes?.find((r) => r.id === viewing.repairId)?.name ?? null) : null
        }
        tierName={viewing ? (partTiers?.find((t) => t.id === viewing.tierId)?.name ?? null) : null}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />
    </div>
  );
}

/** Round 5 #35: the only place a staff member can read the customer's own
 * problem description (`notes`) — the table has no room for it, and there
 * was nowhere at all to see it before this. Mirrors OrderDetailsDialog's
 * pattern in orders-view.tsx. */
function BookingDetailsDialog({
  booking,
  deviceName,
  repairName,
  tierName,
  onOpenChange,
}: {
  booking: Booking | null;
  deviceName: string | null;
  repairName: string | null;
  tierName: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={booking !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{booking?.reference}</DialogTitle>
          <DialogDescription>
            {booking ? `Submitted ${formatDateTime(booking.createdAt)}` : null}
          </DialogDescription>
        </DialogHeader>
        {booking ? (
          <div className="grid gap-4 text-sm">
            <div className="flex items-center justify-between">
              <StatusChip tone={STATUS_TONE[booking.status]}>
                {bookingStatusLabel(booking.status)}
              </StatusChip>
              <span className="tabular text-ink font-bold">
                {booking.price != null ? formatGBP(booking.price) : 'On diagnosis'}
              </span>
            </div>

            <div>
              <p className="text-muted mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]">
                Customer
              </p>
              <p className="text-ink font-semibold">{booking.name}</p>
              <p className="text-muted">{booking.email}</p>
              <p className="text-muted">{booking.phone}</p>
              <p className="text-muted text-xs">
                Prefers {booking.preferredContact === 'phone' ? 'text / call' : 'email'}
              </p>
            </div>

            <div>
              <p className="text-muted mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]">
                Return address
              </p>
              <p className="text-ink">{booking.address || '—'}</p>
              <p className="text-ink tabular">{booking.postcode || '—'}</p>
            </div>

            <div>
              <p className="text-muted mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]">
                Device / repair
              </p>
              <p className="text-ink">
                {deviceName ?? 'Device'} — {repairName ?? 'Repair'}
                {tierName ? ` (${tierName})` : ''}
              </p>
            </div>

            <div>
              <p className="text-muted mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]">
                Problem description
              </p>
              <p className="text-ink whitespace-pre-wrap">
                {booking.notes && booking.notes.trim() ? booking.notes : 'Nothing added.'}
              </p>
            </div>

            <div className="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Change request item 2 — "Send to Jobs".
 *
 * "It should show a pop-up asking only for the 1–3 missing details. Do not
 * force the admin to manually re-enter data the customer already provided."
 *
 * So this dialog shows what the customer gave as READ-ONLY context and asks
 * only for what they could not give. Which fields those are is not decided
 * here: it comes from the repair type's own `conversionRequiredFields`,
 * configured per type in the database, because it genuinely varies — a
 * screen replacement needs a passcode to test afterwards, water damage needs
 * the condition recorded and no quote at all until someone has looked at it.
 * Hardcoding a list here is exactly what the doc's developer note warns
 * against, and what would become unmaintainable the first time a new repair
 * type needs a different field.
 *
 * The server enforces the same list. This dialog is the convenience; the
 * function is the rule.
 */
function SendToJobsDialog({
  booking,
  repairTypes,
  conversionFields,
  onClose,
}: {
  booking: Booking | null;
  repairTypes: RepairType[];
  conversionFields: RepairConversionFields;
  onClose: () => void;
}) {
  const convert = useConvertBookingToJob();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const open = booking !== null;
  const repairType = repairTypes.find((r) => r.id === booking?.repairId) ?? null;
  // Falls back to ['quote'] rather than to nothing: an empty list would let
  // a request through with no details at all if the lookup hadn't loaded,
  // and the server would refuse it anyway with a less helpful message.
  const required: JobConversionField[] = repairType
    ? (conversionFields[repairType.id] ?? ['quote'])
    : ['quote'];

  // Fresh answers every time. Carrying one device's passcode into the next
  // conversion is the kind of thing that only gets noticed at the bench.
  useEffect(() => {
    if (!open) return;
    setValues({});
    setError(null);
  }, [open, booking?.id]);

  if (!booking) return null;

  const submit = () => {
    setError(null);

    let quotedPrice: number | null = null;
    const intakeDetails: Record<string, string> = {};

    for (const field of required) {
      const raw = (values[field] ?? '').trim();
      if (field === 'quote') {
        const n = Number(raw);
        if (!raw || !Number.isFinite(n) || n < 0) {
          setError('Enter the price agreed with the customer.');
          return;
        }
        quotedPrice = pounds(n);
        continue;
      }
      if (!raw) {
        setError(`${jobConversionFieldLabel(field)} is needed before this goes on the bench.`);
        return;
      }
      intakeDetails[field] = raw;
    }

    convert.mutate({ bookingId: booking.id, quotedPrice, intakeDetails }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send {booking.reference} to Jobs</DialogTitle>
          <DialogDescription>
            It gets the next job number. The request keeps its own reference and will show the job
            number against it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/*
            What the customer already gave, shown and NOT asked for again.
            This block is the point of the whole item: it exists so nobody
            re-types a name and a phone number off a form the customer
            already filled in.
          */}
          <div className="border-line bg-card rounded-ui grid gap-0.5 border p-3 text-sm">
            <p className="text-ink font-bold">{booking.name}</p>
            <p className="text-muted text-xs">
              {booking.phone} · {booking.email}
            </p>
            <p className="text-ink mt-1">{repairType?.name ?? 'Repair'}</p>
            {booking.notes?.trim() ? (
              <p className="text-muted text-xs">“{booking.notes.trim()}”</p>
            ) : null}
            <p className="text-muted mt-1 text-xs">
              Quoted online{' '}
              {booking.price != null ? (
                <strong className="text-ink tabular">{formatGBP(booking.price)}</strong>
              ) : (
                'on diagnosis'
              )}{' '}
              — all of this comes across automatically.
            </p>
          </div>

          {required.map((field) => (
            <Field
              key={field}
              label={jobConversionFieldLabel(field)}
              htmlFor={`convert-${field}`}
              hint={jobConversionFieldHint(field)}
            >
              <Input
                id={`convert-${field}`}
                {...(field === 'quote'
                  ? {
                      type: 'number',
                      min: '0',
                      step: '0.01',
                      inputMode: 'decimal' as const,
                      className: 'tabular',
                      placeholder:
                        booking.price != null ? (booking.price / 100).toFixed(2) : '0.00',
                    }
                  : { placeholder: '' })}
                value={values[field] ?? ''}
                onChange={(e) => setValues((cur) => ({ ...cur, [field]: e.target.value }))}
              />
            </Field>
          ))}

          {error ? (
            <p className="text-red-deep text-sm font-semibold" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={convert.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={convert.isPending}>
              {convert.isPending ? 'Sending…' : 'Send to the bench'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
