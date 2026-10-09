'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Search, X } from 'lucide-react';
import {
  useCreateJob,
  useDevices,
  useRepairOffers,
  useRepairSubTypes,
  useRepairTypes,
} from '@/lib/data/hooks';
import type { Device, RepairSubType, RepairType } from '@/lib/data/types';
import { formatGBP, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
    // The catalogue repair, when one was picked (C-3): device and repair together, and the
    // sub-type for a standard repair (null for a Diagnosis-only one).
    repairTypeId: z.string().nullable(),
    deviceId: z.string().nullable(),
    subTypeId: z.string().nullable(),
    // 0105 — text the customer at each stage.
    smsUpdates: z.boolean(),
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
  repairTypeId: null,
  deviceId: null,
  subTypeId: null,
  smsUpdates: true,
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
  const repairTypeId = watch('repairTypeId');
  const deviceId = watch('deviceId');
  const subTypeId = watch('subTypeId');
  const quotePounds = watch('quotePounds');

  const devices = useDevices();
  const repairTypes = useRepairTypes();
  const subTypes = useRepairSubTypes();
  const offers = useRepairOffers(deviceId);

  /**
   * The shop's own price for what's been picked, and from item 6 the minimum
   * a staff member may quote.
   *
   * Shown, not enforced, here — the server recomputes this from the selection
   * and refuses anything under it, because a floor the client sends is a floor
   * the client can lower. Blocking Add on screen just means the refusal
   * happens while the number can still be corrected in place.
   */
  const floor =
    deviceId && repairTypeId
      ? ((offers.data ?? []).find(
          (o) => o.repairId === repairTypeId && o.subTypeId === (subTypeId ?? null),
        )?.price ?? null)
      : null;

  const typedQuote = quotePounds?.trim() ? Number(quotePounds) : null;
  const belowFloor =
    floor != null &&
    typedQuote != null &&
    Number.isFinite(typedQuote) &&
    pounds(typedQuote) < floor;

  const setChannel = (next: 'walk_in' | 'mail_in') => setValue('channel', next);

  const clearRepair = () => {
    setValue('repairTypeId', null);
    setValue('deviceId', null);
    setValue('subTypeId', null);
    // The quote came from that device's price list — don't leave it behind without it.
    setValue('quotePounds', '');
  };

  const router = useRouter();

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
        // The selection travels, the price does not: the server reads the device's own price
        // for it, refuses one the device doesn't offer, and never takes a quote below it.
        repairTypeId: values.deviceId && values.repairTypeId ? values.repairTypeId : null,
        deviceId: values.deviceId && values.repairTypeId ? values.deviceId : null,
        subTypeId: values.deviceId && values.repairTypeId ? values.subTypeId : null,
        smsUpdates: values.smsUpdates,
      },
      {
        onSuccess: (job) => {
          reset(EMPTY_DEFAULTS);
          onOpenChange(false);
          // A deposit is taken at the till, like any other payment: go there with the job.
          const deposit =
            depositNumber != null && !Number.isNaN(depositNumber) ? pounds(depositNumber) : 0;
          if (deposit > 0) router.push(`/pos?job=${encodeURIComponent(job.id)}&amount=${deposit}`);
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
          <label className="text-ink -mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--red)]"
              {...register('smsUpdates')}
            />
            Send text updates at each stage of the repair
          </label>
          {/*
            Change request item 6: look the repair up and see what the shop
            charges for it, instead of quoting from memory.

            Optional on purpose. A device that isn't in the catalogue, an odd
            repair nobody has priced, a goodwill fix — all still ordinary
            free-text jobs, exactly as before. The floor binds only once a
            priced repair has actually been picked.
          */}
          <RepairPicker
            devices={devices.data ?? []}
            repairTypes={repairTypes.data ?? []}
            subTypes={subTypes.data ?? []}
            loading={devices.isPending || repairTypes.isPending}
            deviceId={deviceId}
            repairTypeId={repairTypeId}
            subTypeId={subTypeId}
            onDevice={(d) => {
              // A new device (or "change repair") always clears the repair and its price.
              setValue('deviceId', d?.id ?? null);
              setValue('repairTypeId', null);
              setValue('subTypeId', null);
              setValue('quotePounds', '');
              // Fill the field staff would otherwise retype; it stays editable.
              if (d) setValue('deviceDescription', d.name);
            }}
            onRepair={(pick) => {
              setValue('repairTypeId', pick.repair.id);
              setValue('subTypeId', pick.subTypeId);
              // The device's price is the job's price, taken now and stored on the job.
              setValue('quotePounds', (pick.price / 100).toFixed(2));
              setValue('problemDescription', pick.label);
            }}
            onClear={clearRepair}
          />

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
              hint={
                floor != null
                  ? `Shop price is ${formatGBP(floor)}. You can quote more, never less.`
                  : undefined
              }
            >
              <Input
                id="job-quote"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
                aria-invalid={belowFloor || undefined}
                {...register('quotePounds')}
              />
            </Field>
          </div>

          {/*
            Item 6's actual constraint. Said here so it can be corrected in
            place; the server refuses it again regardless, and 0082's trigger
            refuses it below that.
          */}
          {belowFloor && floor != null ? (
            <p className="text-red text-sm font-semibold">
              That’s below the {formatGBP(floor)} shop price for this repair. Quote more, or clear
              the repair above if this job isn’t that repair.
            </p>
          ) : null}
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
              label="Deposit to take (£)"
              htmlFor="job-deposit"
              error={errors.depositPounds?.message}
              hint="Blank for none. You'll take it at the till next. Can't be more than the quote."
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
            <Button type="submit" disabled={createJob.isPending || belowFloor}>
              {createJob.isPending ? 'Adding…' : 'Add to the bench'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Job creation's repair lookup (tester change C-3.5) — two search bars, in order:
 *
 *   1. Device Model — search and pick the device.
 *   2. Repair Type — disabled until a device is picked. Lists ONLY what that device offers: each
 *      repair at each sub-type with a price on that device ("Screen replacement — OEM · £89"), and a
 *      Diagnosis-only repair as one option with its flat price. A repair or sub-type with no price
 *      on the device is not listed.
 *
 * Changing the device clears the repair, so a price for another device can never carry over.
 * Optional on purpose: a device or repair that isn't in the price list is still an ordinary
 * free-text job.
 */
function RepairPicker({
  devices,
  repairTypes,
  subTypes,
  loading,
  deviceId,
  repairTypeId,
  subTypeId,
  onDevice,
  onRepair,
  onClear,
}: {
  devices: Device[];
  repairTypes: RepairType[];
  subTypes: RepairSubType[];
  loading: boolean;
  deviceId: string | null;
  repairTypeId: string | null;
  subTypeId: string | null;
  onDevice: (device: Device | null) => void;
  onRepair: (pick: {
    repair: RepairType;
    subTypeId: string | null;
    price: number;
    label: string;
  }) => void;
  onClear: () => void;
}) {
  const [deviceTerm, setDeviceTerm] = useState('');
  const [repairTerm, setRepairTerm] = useState('');
  const device = devices.find((d) => d.id === deviceId) ?? null;
  const offers = useRepairOffers(device?.id);

  const deviceMatches = useMemo(() => {
    const words = deviceTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return devices
      .filter((d) => words.every((w) => `${d.name} ${d.brand}`.toLowerCase().includes(w)))
      .slice(0, 30);
  }, [deviceTerm, devices]);

  // Every priced option for this device, labelled "Repair — Sub-type" (or just the repair).
  const options = useMemo(() => {
    const list = (offers.data ?? []).flatMap((o) => {
      const repair = repairTypes.find((r) => r.id === o.repairId);
      if (!repair) return [];
      const sub = o.subTypeId ? subTypes.find((s) => s.id === o.subTypeId) : null;
      if (o.subTypeId && !sub) return [];
      return [
        {
          key: `${o.repairId}:${o.subTypeId ?? ''}`,
          repair,
          subTypeId: o.subTypeId,
          price: o.price,
          label: sub ? `${repair.name} — ${sub.name}` : repair.name,
        },
      ];
    });
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [offers.data, repairTypes, subTypes]);

  const words = repairTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const repairMatches = options.filter((o) =>
    words.every((w) => o.label.toLowerCase().includes(w)),
  );
  const chosen = options.find(
    (o) => o.repair.id === repairTypeId && o.subTypeId === (subTypeId ?? null),
  );

  return (
    <div className="border-line rounded-ui grid gap-3 border p-3">
      <span className="text-ink text-[11px] font-semibold uppercase tracking-[0.08em]">
        From the price list (optional)
      </span>

      {/* 1 — Device Model */}
      {device ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">
            <span className="text-muted">Device </span>
            <strong className="text-ink">{device.name}</strong>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X aria-hidden="true" />
            Change device
          </Button>
        </div>
      ) : (
        <Field label="1. Device model" htmlFor="job-device-search">
          <div className="relative">
            <Search
              className="text-muted pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id="job-device-search"
              className="pl-8"
              placeholder={loading ? 'Loading devices…' : 'e.g. iPhone 13'}
              value={deviceTerm}
              onChange={(e) => setDeviceTerm(e.target.value)}
              autoComplete="off"
            />
          </div>
          {deviceMatches.length > 0 ? (
            <ul className="border-line bg-card rounded-ui mt-1 max-h-52 overflow-auto border">
              {deviceMatches.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="hover:bg-line/40 w-full px-3 py-2 text-left text-sm"
                    onClick={() => {
                      onDevice(d);
                      setDeviceTerm('');
                      setRepairTerm('');
                    }}
                  >
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : deviceTerm.trim() && !loading ? (
            <p className="text-muted mt-1 text-sm">
              No device by that name. Leave it blank and describe it below.
            </p>
          ) : null}
        </Field>
      )}

      {/* 2 — Repair Type: only what this device offers */}
      {chosen ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">
            <span className="text-muted">Repair </span>
            <strong className="text-ink">{chosen.label}</strong>{' '}
            <span className="tabular text-ink">· {formatGBP(chosen.price)}</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => device && onDevice(device)}
          >
            Change repair
          </Button>
        </div>
      ) : (
        <Field label="2. Repair" htmlFor="job-repair-search">
          <div className="relative">
            <Search
              className="text-muted pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id="job-repair-search"
              className="pl-8"
              disabled={!device}
              placeholder={device ? 'e.g. screen' : 'Pick the device first'}
              value={repairTerm}
              onChange={(e) => setRepairTerm(e.target.value)}
              autoComplete="off"
            />
          </div>
          {device && offers.isPending ? (
            <p className="text-muted mt-1 text-sm">Loading its prices…</p>
          ) : device && options.length === 0 ? (
            <p className="text-muted mt-1 text-sm">No repairs offered for this device.</p>
          ) : device ? (
            <ul className="border-line bg-card rounded-ui mt-1 max-h-52 overflow-auto border">
              {repairMatches.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    className="hover:bg-line/40 flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm"
                    onClick={() => {
                      onRepair({
                        repair: o.repair,
                        subTypeId: o.subTypeId,
                        price: o.price,
                        label: o.label,
                      });
                      setRepairTerm('');
                    }}
                  >
                    <span className="text-ink">{o.label}</span>
                    <span className="text-muted tabular shrink-0 text-xs">
                      {formatGBP(o.price)}
                    </span>
                  </button>
                </li>
              ))}
              {repairMatches.length === 0 ? (
                <li className="text-muted px-3 py-2 text-sm">
                  Nothing this device offers matches.
                </li>
              ) : null}
            </ul>
          ) : null}
        </Field>
      )}
    </div>
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
