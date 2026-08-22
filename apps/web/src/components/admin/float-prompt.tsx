'use client';

import { useMemo, useState } from 'react';
import {
  useCashEntries,
  useCreateCashEntry,
  useSession,
  useSettings,
  useStaff,
} from '@/lib/data/hooks';
import { formatGBP, pounds } from '@/lib/data/types';
import { isoDay } from '@/lib/dates';
import { useAdminStore } from '@/lib/stores/admin.store';
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
import { Field } from './field';

/**
 * Morning float prompt (item 7, Float & petty cash): on the first dashboard
 * visit of a trading day with no opening float recorded, ask for it. Can be
 * put off for the day ("Not now") — the Cash drawer page always accepts it
 * later. Float money is tracked separately from sales revenue.
 */
export function FloatPrompt() {
  const today = isoDay();
  const dismissedFor = useAdminStore((s) => s.floatPromptDismissedFor);
  const dismissRaw = useAdminStore((s) => s.dismissFloatPrompt);

  const { data: session } = useSession();
  const { data: entries } = useCashEntries();
  const { data: settings } = useSettings();
  const { data: staff } = useStaff();
  const createEntry = useCreateCashEntry();

  const [amount, setAmount] = useState('');
  const [staffName, setStaffName] = useState('');

  const floatRecorded = useMemo(
    () => entries?.some((e) => e.kind === 'float-open' && e.date === today) ?? true,
    [entries, today],
  );

  // BUG-14: only counter staff get asked to count the float. An owner logging
  // in — often just to check reports, not to open the till — isn't holding
  // cash and shouldn't be interrupted for it. `cash.manage` is held by both
  // roles, so this had to be an explicit role check, not a permission gate.
  // `session` is `undefined` while useSession() is still loading — treating
  // that as "not confirmed owner, ok to show" opened the dialog for a real
  // owner during that window every time (session resolves after floatRecorded
  // most loads). Once Radix has genuinely opened it, flipping `open` back to
  // `false` a render later doesn't reliably close it again, so the fix is to
  // never open it until the session answer is actually in, matching how
  // `floatRecorded` already defaults to the safe "don't show" while loading.
  const sessionLoaded = session !== undefined;
  const isOwner = session?.kind === 'staff' && session.staffRole === 'owner';
  // Per-person, not just per-day (BUG-14 follow-up) — see the comment on
  // `floatPromptDismissedFor` in admin.store.ts for why this bit the old
  // day-only version on a shared till.
  const dismiss = () => {
    if (session) dismissRaw(session.id, today);
  };
  const open =
    sessionLoaded &&
    !isOwner &&
    !floatRecorded &&
    Boolean(session) &&
    dismissedFor !== `${session?.id}:${today}`;
  const activeStaff = staff?.filter((s) => s.active) ?? [];
  const suggested = settings ? settings.floatTarget : pounds(150);
  const amountPence = amount === '' ? suggested : pounds(Number(amount) || 0);

  const record = () => {
    if (amountPence <= 0) return;
    createEntry.mutate(
      {
        date: today,
        kind: 'float-open',
        amount: amountPence,
        note: 'Opening float',
        staffName: staffName || activeStaff[0]?.name || 'Staff',
      },
      { onSuccess: dismiss },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : dismiss())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Morning — count the float</DialogTitle>
          <DialogDescription>
            No opening float is recorded for today. Count the till and log it — float cash is
            tracked separately from sales.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field
            label="Float in the till"
            htmlFor="float-amount"
            hint={`Target is ${formatGBP(suggested)}`}
          >
            <div className="relative">
              <span className="text-muted absolute left-3 top-1/2 -translate-y-1/2 text-sm">£</span>
              <Input
                id="float-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder={(suggested / 100).toFixed(2)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular pl-7"
              />
            </div>
          </Field>
          <Field label="Counted by" htmlFor="float-staff">
            <Select
              id="float-staff"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
            >
              {activeStaff.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss} disabled={createEntry.isPending}>
            Not now
          </Button>
          <Button onClick={record} disabled={createEntry.isPending || amountPence <= 0}>
            {createEntry.isPending ? 'Recording…' : 'Record float'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
