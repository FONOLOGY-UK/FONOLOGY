'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useBookings, useCreateJob, useDevices, useJobs, useRepairTypes } from '@/lib/data/hooks';
import type { Booking } from '@/lib/data/types';
import { pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/admin/field';
import { cn } from '@/lib/utils';

/**
 * "Add job" (item 7, Jobs) — two doors in, one dialog:
 *   - Walk-in: name, phone, device, problem, quote, how they're paying.
 *     Optimised for speed of entry; everything else can wait until the
 *     device is on the bench.
 *   - Mail-in (FEATURE-10, relaxed by BUG-15-followup #10): links a real
 *     booking the customer already submitted through the website's /repair
 *     flow when there is one — picking a booking pre-fills the form from it
 *     (still editable). A booking is no longer REQUIRED for this channel:
 *     a device can physically arrive by post with no prior booking at all
 *     (dropped off at a courier depot, sent on spec, a booking made by
 *     phone), and staff need to be able to log it exactly like a walk-in,
 *     just correctly marked as having come in by post. `bookingId` is
 *     simply omitted in that case — `POST /jobs` already treats it the same
 *     way a walk-in's absent bookingId is treated.
 */

const formSchema = z
  .object({
    channel: z.enum(['walk_in', 'mail_in']),
    bookingId: z.string().optional(),
    customerName: z.string().trim().min(2, 'Enter the customer name'),
    phone: z
      .string()
      .trim()
      .regex(/^(?:\+?44|0)[\d\s-]{9,13}$/, 'Enter a valid UK phone number'),
    email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
    deviceDescription: z.string().trim().min(2, 'Enter the device'),
    problemDescription: z.string().trim().min(3, 'Describe the problem'),
    notes: z.string().max(1000).optional(),
    quotePounds: z.string().optional(),
    depositPounds: z.string().optional(),
    depositTender: z.enum(['cash', 'pos1', 'pos2', 'transfer']),
  })
  .refine(
    (v) => {
      if (!v.depositPounds?.trim()) return true;
      const deposit = Number(v.depositPounds);
      if (!Number.isFinite(deposit) || deposit < 0) return false;
      if (!v.quotePounds?.trim()) return true;
      const quote = Number(v.quotePounds);
      return !Number.isFinite(quote) || deposit <= quote;
    },
    { message: 'A deposit can’t be more than the quote', path: ['depositPounds'] },
  );
type FormValues = z.infer<typeof formSchema>;

const EMPTY_DEFAULTS: FormValues = {
  channel: 'walk_in',
  bookingId: '',
  customerName: '',
  phone: '',
  email: '',
  deviceDescription: '',
  problemDescription: '',
  notes: '',
  quotePounds: '',
  depositPounds: '',
  depositTender: 'cash',
};

export function AddJobDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createJob = useCreateJob();
  const { data: bookings } = useBookings();
  const { data: jobs } = useJobs();
  const { data: devices } = useDevices();
  const { data: repairTypes } = useRepairTypes();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  const channel = watch('channel');
  const bookingId = watch('bookingId');

  // Only bookings nothing has claimed yet — a booking already linked to a
  // job would silently create a second job for the same device if offered
  // again here. Cancelled bookings aren't offered either; there's no device
  // coming in for one of those.
  const linkedBookingIds = useMemo(
    () => new Set((jobs ?? []).map((j) => j.bookingId).filter((id): id is string => Boolean(id))),
    [jobs],
  );
  const availableBookings = useMemo(
    () =>
      (bookings ?? []).filter(
        (b) => b.status !== 'cancelled' && b.status !== 'dispatched' && !linkedBookingIds.has(b.id),
      ),
    [bookings, linkedBookingIds],
  );

  const describeBooking = (b: Booking) => {
    const device = devices?.find((d) => d.id === b.deviceId)?.name ?? 'Device';
    const repair = repairTypes?.find((r) => r.id === b.repairId)?.name ?? 'Repair';
    return `${b.reference} — ${b.name} — ${device} (${repair})`;
  };

  const applyBooking = (id: string) => {
    setValue('bookingId', id);
    const booking = availableBookings.find((b) => b.id === id);
    if (!booking) return;
    const device = devices?.find((d) => d.id === booking.deviceId)?.name ?? '';
    const repair = repairTypes?.find((r) => r.id === booking.repairId)?.name ?? '';
    setValue('customerName', booking.name, { shouldValidate: true });
    setValue('phone', booking.phone, { shouldValidate: true });
    setValue('email', booking.email ?? '', { shouldValidate: true });
    setValue(
      'deviceDescription',
      [device, repair].filter(Boolean).join(' — ') || booking.reference,
      { shouldValidate: true },
    );
    if (booking.notes) setValue('notes', booking.notes);
    if (booking.price != null) setValue('quotePounds', (booking.price / 100).toFixed(2));
  };

  const setChannel = (next: 'walk_in' | 'mail_in') => {
    setValue('channel', next);
    // Switching back to walk-in clears the link — a walk-in job carries no
    // bookingId at all, never a leftover one from a booking staff backed out
    // of picking.
    if (next === 'walk_in') setValue('bookingId', '');
  };

  const submit = handleSubmit((values) => {
    const quoteNumber = values.quotePounds?.trim() ? Number(values.quotePounds) : null;
    const depositNumber = values.depositPounds?.trim() ? Number(values.depositPounds) : null;
    createJob.mutate(
      {
        source: values.channel,
        // Must be omitted, not sent as '', when no booking was picked — the
        // API's schema validates a present bookingId as a real uuid, and an
        // empty string isn't one (BUG-15-followup #10: this only started
        // mattering once a mail-in job could legitimately have no booking).
        bookingId: values.channel === 'mail_in' && values.bookingId ? values.bookingId : undefined,
        depositTender: values.depositTender,
        customerName: values.customerName,
        phone: values.phone,
        email: values.email?.trim() ? values.email.trim() : undefined,
        deviceDescription: values.deviceDescription,
        problemDescription: values.problemDescription,
        notes: values.notes?.trim() ? values.notes : undefined,
        quotedPrice: quoteNumber != null && !Number.isNaN(quoteNumber) ? pounds(quoteNumber) : null,
        depositAmount:
          depositNumber != null && !Number.isNaN(depositNumber) ? pounds(depositNumber) : null,
      },
      {
        onSuccess: () => {
          reset(EMPTY_DEFAULTS);
          onOpenChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add job</DialogTitle>
          <DialogDescription>
            {channel === 'mail_in'
              ? 'Came in by post. Link the booking it belongs to if there is one, or fill the details in by hand if the device just arrived. It lands in “New” and prints a device label from the job panel.'
              : 'Walk-in at the counter. It lands in “New” and prints a device label from the job panel.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div
            className="border-input rounded-ui bg-card inline-flex border p-0.5"
            role="group"
            aria-label="How did it come in?"
          >
            <ChannelButton active={channel === 'walk_in'} onClick={() => setChannel('walk_in')}>
              Walk-in
            </ChannelButton>
            <ChannelButton active={channel === 'mail_in'} onClick={() => setChannel('mail_in')}>
              Mail-in
            </ChannelButton>
          </div>

          {channel === 'mail_in' ? (
            <Field
              label="Which booking? (optional)"
              htmlFor="job-booking"
              error={errors.bookingId?.message}
              hint={
                availableBookings.length === 0
                  ? 'No unlinked bookings right now — every mail-in booking already has a job, or none have come in yet. Fill the details in below; the device still arrived by post.'
                  : 'Leave this on "No existing booking" if the device turned up with nothing booked online — the fields below then work exactly like a walk-in.'
              }
            >
              <Select
                id="job-booking"
                value={bookingId ?? ''}
                onChange={(e) => applyBooking(e.target.value)}
              >
                <option value="">No existing booking — fill in the details below</option>
                {availableBookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {describeBooking(b)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="job-name" error={errors.customerName?.message}>
              <Input
                id="job-name"
                autoFocus={channel === 'walk_in'}
                placeholder="Full name"
                {...register('customerName')}
              />
            </Field>
            <Field label="Phone" htmlFor="job-phone" error={errors.phone?.message}>
              <Input id="job-phone" inputMode="tel" placeholder="07…" {...register('phone')} />
            </Field>
          </div>
          <Field label="Email (optional)" htmlFor="job-email" error={errors.email?.message}>
            <Input id="job-email" type="email" placeholder="For updates" {...register('email')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Device" htmlFor="job-device" error={errors.deviceDescription?.message}>
              <Input
                id="job-device"
                placeholder="e.g. iPhone 14 Pro"
                {...register('deviceDescription')}
              />
            </Field>
            <Field
              label="Quote (£, blank = on diagnosis)"
              htmlFor="job-quote"
              error={errors.quotePounds?.message}
            >
              <Input
                id="job-quote"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
                {...register('quotePounds')}
              />
            </Field>
          </div>
          <Field label="Problem" htmlFor="job-problem" error={errors.problemDescription?.message}>
            <Input
              id="job-problem"
              placeholder="What's wrong with it?"
              {...register('problemDescription')}
            />
          </Field>
          <Field label="Notes (optional)" htmlFor="job-notes">
            <Textarea
              id="job-notes"
              placeholder="Passcode, condition on arrival, warnings given…"
              {...register('notes')}
            />
          </Field>
          {/*
            A deposit is an AMOUNT, not a flag. The old "paid in advance"
            dropdown recorded that money had changed hands without recording how
            much, which is unreconcilable. `payment_status` is now derived by the
            server from the payments actually taken, so it isn't set here at all.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Deposit taken (£)"
              htmlFor="job-deposit"
              error={errors.depositPounds?.message}
              hint="Blank if nothing has been paid. Can't be more than the quote."
            >
              <Input
                id="job-deposit"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                placeholder="0.00"
                {...register('depositPounds')}
              />
            </Field>
            {/*
              Asked for, not assumed: a card deposit booked as cash turns into an
              unexplainable drawer variance at close.
            */}
            <Field label="Taken as" htmlFor="job-deposit-tender">
              <Select id="job-deposit-tender" {...register('depositTender')}>
                <option value="cash">Cash</option>
                <option value="pos1">Card — terminal 1</option>
                <option value="pos2">Card — terminal 2</option>
                <option value="transfer">Bank transfer</option>
              </Select>
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createJob.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createJob.isPending}>
              {createJob.isPending ? 'Adding…' : 'Add to the bench'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChannelButton({
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-ui px-3 py-1.5 text-sm font-semibold transition-colors duration-150',
        active ? 'bg-ink text-bone' : 'text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
