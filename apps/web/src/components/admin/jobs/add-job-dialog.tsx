'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Search, X } from 'lucide-react';
import { useCreateJob, useDevices, useRepairTypes } from '@/lib/data/hooks';
import type { Device, PartTierId, RepairType } from '@/lib/data/types';
import { formatGBP, pounds, repairQuoteFloor } from '@/lib/data/types';
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
    // Change request item 6 — the catalogue repair, when one was picked.
    // All three or none; the server's own CHECK (0079) says the same.
    repairTypeId: z.string().nullable(),
    deviceId: z.string().nullable(),
    partTier: z.enum(['original', 'oem', 'copy']).nullable(),
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
  partTier: null,
};

/**
 * Change request item 6 — the part tiers, in the order the shop quotes them.
 *
 * A floor only means anything against a chosen tier: an iPhone 11 screen is
 * three different prices depending on whether the part is original, OEM or
 * copy, so "the base price" is not one number. This is the same three-way
 * split `repair_types` has carried since 0006 and that /admin/repair-pricing
 * already edits — nothing new is being invented for the staff side.
 */
const TIERS: { id: PartTierId; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'oem', label: 'OEM' },
  { id: 'copy', label: 'Copy' },
];

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
  const partTier = watch('partTier');
  const quotePounds = watch('quotePounds');

  const devices = useDevices();
  const repairTypes = useRepairTypes();

  const device = devices.data?.find((d) => d.id === deviceId) ?? null;
  const repairType = repairTypes.data?.find((r) => r.id === repairTypeId) ?? null;

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
    repairType && device && partTier
      ? repairQuoteFloor(repairType.base, partTier, device.priceMultiplier)
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
    setValue('partTier', null);
  };

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
        // Item 6: the selection travels, the floor does not. The server
        // recomputes it from these through the same repair_quote_price() the
        // admin pricing screen uses.
        repairTypeId: values.repairTypeId,
        deviceId: values.deviceId,
        partTier: values.partTier,
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
            loading={devices.isPending || repairTypes.isPending}
            deviceId={deviceId}
            repairTypeId={repairTypeId}
            partTier={partTier}
            floor={floor}
            onPick={(next) => {
              setValue('deviceId', next.deviceId);
              setValue('repairTypeId', next.repairTypeId);
              setValue('partTier', next.partTier);
              // Fill the two fields staff would otherwise retype. Both stay
              // editable — the catalogue name is a starting point, not a
              // replacement for "iPhone 14 Pro, back glass also cracked".
              if (next.deviceName) setValue('deviceDescription', next.deviceName);
              if (next.repairName) setValue('problemDescription', next.repairName);
            }}
            onClear={clearRepair}
            onUseFloor={(price) => setValue('quotePounds', (price / 100).toFixed(2))}
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
            place; the server refuses it again regardless, and 0079's trigger
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
 * Change request item 6 — "add a search bar on the Add Job screen so staff can
 * search for a specific repair and see the admin-defined price to quote".
 *
 * WHY IT SEARCHES THE CROSS PRODUCT RATHER THAN OFFERING TWO DROPDOWNS
 *
 * The shop's price is not stored per repair; it is `base_price[tier] x device
 * multiplier`. "iPhone 11 Screen Replacement" — the doc's own example — is a
 * DEVICE and a REPAIR TYPE together, and that is the phrase a staff member has
 * in their head with a customer in front of them. Two dropdowns would make
 * them decompose it first. So the box searches over every device x repair
 * pairing and matches on the combined label, and typing "11 screen" finds it.
 *
 * The list is small enough for this to be honest: devices and repair types are
 * both administered catalogues of tens of rows, both already fetched with a
 * five-minute staleTime for the public /repair wizard. No new endpoint, no
 * request per keystroke.
 *
 * The tier is picked AFTER the pairing, not searched, because it changes the
 * price rather than identifying the repair — and because a floor is
 * meaningless until you have said which grade of part you are quoting.
 */
function RepairPicker({
  devices,
  repairTypes,
  loading,
  deviceId,
  repairTypeId,
  partTier,
  floor,
  onPick,
  onClear,
  onUseFloor,
}: {
  devices: Device[];
  repairTypes: RepairType[];
  loading: boolean;
  deviceId: string | null;
  repairTypeId: string | null;
  partTier: PartTierId | null;
  floor: number | null;
  onPick: (next: {
    deviceId: string;
    repairTypeId: string;
    partTier: PartTierId;
    deviceName: string;
    repairName: string;
  }) => void;
  onClear: () => void;
  onUseFloor: (price: number) => void;
}) {
  const [term, setTerm] = useState('');

  const device = devices.find((d) => d.id === deviceId) ?? null;
  const repairType = repairTypes.find((r) => r.id === repairTypeId) ?? null;
  const picked = device !== null && repairType !== null && partTier !== null;

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    const out: { device: Device; repair: RepairType }[] = [];
    for (const d of devices) {
      for (const r of repairTypes) {
        const label = `${d.name} ${d.brand} ${r.name}`.toLowerCase();
        // Every word has to appear somewhere, in any order — "screen 11" and
        // "11 screen" are the same search to a person in a hurry.
        if (words.every((w) => label.includes(w))) out.push({ device: d, repair: r });
        if (out.length >= 40) return out;
      }
    }
    return out;
  }, [term, devices, repairTypes]);

  if (picked) {
    return (
      <div className="border-line bg-card rounded-ui grid gap-2 border p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-ink text-sm font-bold">
              {device.name} — {repairType.name}
            </p>
            <p className="text-muted text-xs">
              {floor != null ? (
                <>
                  Shop price <strong className="text-ink tabular">{formatGBP(floor)}</strong> at
                  this tier
                </>
              ) : (
                // A diagnosis-only repair type has no price at any tier
                // (repair_types_all_or_no_pricing), so there is no floor to
                // show and none to enforce. Saying so is better than an
                // empty space that reads like a loading failure.
                'Priced on diagnosis — no set price for this repair, so nothing to quote against.'
              )}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X aria-hidden="true" />
            Clear
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted text-[11px] font-bold uppercase tracking-[0.08em]">Part</span>
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={partTier === t.id}
              onClick={() =>
                onPick({
                  deviceId: device.id,
                  repairTypeId: repairType.id,
                  partTier: t.id,
                  deviceName: '',
                  repairName: '',
                })
              }
              className={cn(
                'rounded-ui border px-2 py-1 text-xs font-semibold transition-colors duration-150',
                partTier === t.id
                  ? 'bg-ink text-bone border-ink'
                  : 'border-input text-muted hover:text-ink',
              )}
            >
              {t.label}
              {repairType.base ? (
                <span className="tabular ml-1.5 opacity-70">
                  {formatGBP(repairQuoteFloor(repairType.base, t.id, device.priceMultiplier) ?? 0)}
                </span>
              ) : null}
            </button>
          ))}
          {floor != null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onUseFloor(floor)}
            >
              Quote {formatGBP(floor)}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Field
      label="Find the repair (optional)"
      htmlFor="job-repair-search"
      hint="Type a device and a repair — “11 screen”. Shows the shop price and stops a quote going under it. Skip it for anything not in the price list."
    >
      <div className="relative">
        <Search
          className="text-muted pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          id="job-repair-search"
          className="pl-8"
          placeholder={loading ? 'Loading the price list…' : 'e.g. iPhone 11 screen'}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoComplete="off"
        />
      </div>
      {matches.length > 0 ? (
        <ul className="border-line bg-card rounded-ui mt-1 max-h-52 overflow-auto border">
          {matches.map(({ device: d, repair: r }) => {
            // 'original' is shown in the list because it is the top of the
            // three and the one staff quote by default; the tier is
            // changeable the moment the pairing is picked.
            const preview = repairQuoteFloor(r.base, 'original', d.priceMultiplier);
            return (
              <li key={`${d.id}:${r.id}`}>
                <button
                  type="button"
                  className="hover:bg-line/40 flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm"
                  onClick={() => {
                    onPick({
                      deviceId: d.id,
                      repairTypeId: r.id,
                      partTier: 'original',
                      deviceName: d.name,
                      repairName: r.name,
                    });
                    setTerm('');
                  }}
                >
                  <span className="text-ink">
                    {d.name} — {r.name}
                  </span>
                  <span className="text-muted tabular shrink-0 text-xs">
                    {preview != null ? formatGBP(preview) : 'On diagnosis'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : term.trim().length >= 2 && !loading ? (
        <p className="text-muted mt-1 text-sm">
          Nothing in the price list matches that. Leave it blank and quote by hand.
        </p>
      ) : null}
    </Field>
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
