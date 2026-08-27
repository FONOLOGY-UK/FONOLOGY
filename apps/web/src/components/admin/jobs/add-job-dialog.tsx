'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateJob } from '@/lib/data/hooks';
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
 * "Add job" (item 7, Jobs) — two doors in, one dialog, both filled in by
 * hand:
 *   - Walk-in: name, phone, device, problem, quote, how they're paying.
 *   - Mail-in (Round 3 #2.1): same fields, source recorded as mail-in. The
 *     booking-link picker that used to sit here (FEATURE-10, then made
 *     optional in BUG-15-followup #10) is gone entirely, not merely
 *     optional — staff re-enter a mail-in job's details by hand every time,
 *     same as a walk-in. A real online booking is still visible and
 *     actionable on its own — see /admin/submissions — this dialog just no
 *     longer offers to auto-fill from one.
 */

const formSchema = z
  .object({
    channel: z.enum(['walk_in', 'mail_in']),
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

  const setChannel = (next: 'walk_in' | 'mail_in') => setValue('channel', next);

  const submit = handleSubmit((values) => {
    const quoteNumber = values.quotePounds?.trim() ? Number(values.quotePounds) : null;
    const depositNumber = values.depositPounds?.trim() ? Number(values.depositPounds) : null;
    createJob.mutate(
      {
        source: values.channel,
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
              ? 'Came in by post. It lands in “New” and prints a device label from the job panel.'
              : 'Walk-in at the counter. It lands in “New” and prints a device label from the job panel.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div
            // Round 3 #3.1 follow-up: `inline-flex` alone wasn't enough — as
            // a direct child of the form's `grid`, this div is a grid item,
            // and CSS blockifies its `inline-flex` to a block-level `flex`
            // (an outer-display rule, not a Tailwind bug), which then took
            // the grid's default `justify-self: stretch` and spanned the
            // whole row. `justify-self-start` pins it to its own content
            // width regardless of that blockification.
            className="border-input rounded-ui bg-card inline-flex justify-self-start border p-0.5"
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer" htmlFor="job-name" error={errors.customerName?.message}>
              <Input
                id="job-name"
                autoFocus
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
        // Round 3 #3.1: was px-3 py-1.5 — visibly more padding than the
        // text needed, next to a form of otherwise-tight controls.
        'rounded-ui px-2 py-1 text-sm font-semibold transition-colors duration-150',
        active ? 'bg-ink text-bone' : 'text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
