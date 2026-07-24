'use client';

import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useSettings, useUpdateSettings } from '@/lib/data/hooks';
import { formatGBP, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';

/**
 * Settings (item 7): the handful of dials the owner actually turns — return
 * window, float target, idle lock, and the screen-lock PIN. Flat on purpose;
 * anything else belongs to its own module. (Low-stock alerting moved to the
 * product itself — see the note in the Shop card.)
 */
export function SettingsView() {
  const { data: settings, isPending, isError, refetch } = useSettings();
  const updateSettings = useUpdateSettings();

  const [returnWindow, setReturnWindow] = useState('');
  const [idleMinutes, setIdleMinutes] = useState('');
  const [floatPounds, setFloatPounds] = useState('');

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaved, setPinSaved] = useState(false);

  // Seed the form when settings arrive.
  useEffect(() => {
    if (!settings) return;
    setReturnWindow(`${settings.returnWindowDays}`);
    setIdleMinutes(`${settings.idleLockMinutes}`);
    setFloatPounds((settings.floatTarget / 100).toFixed(2));
  }, [settings]);

  const saveShop = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate({
      returnWindowDays: Math.max(0, Math.round(Number(returnWindow) || 0)),
      idleLockMinutes: Math.max(1, Math.round(Number(idleMinutes) || 1)),
      floatTarget: pounds(Number(floatPounds) || 0),
    });
  };

  const savePin = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSaved(false);
    if (!settings) return;
    if (currentPin !== settings.adminPin) {
      setPinError('The current PIN is wrong.');
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('The new PIN must be exactly 4 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError('The new PINs don’t match.');
      return;
    }
    updateSettings.mutate(
      { adminPin: newPin },
      {
        onSuccess: () => {
          setCurrentPin('');
          setNewPin('');
          setConfirmPin('');
          setPinSaved(true);
        },
      },
    );
  };

  if (isError) {
    return (
      <div>
        <PageHeader eyebrow="Team" title="Settings" />
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Settings didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Settings"
        description="The dials that change how the shop runs."
      />

      {isPending || !settings ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[320px]" />
          <Skeleton className="h-[320px]" />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* Shop dials */}
          <form
            onSubmit={saveShop}
            className="border-line bg-card grid gap-4 rounded-lg border p-5"
          >
            <h2 className="font-display text-ink text-sm font-extrabold uppercase tracking-[0.06em]">
              Shop
            </h2>
            <Field
              label="Return window (days)"
              htmlFor="set-window"
              hint="Refunds outside this need an admin override — reason kept on record"
            >
              <Input
                id="set-window"
                type="number"
                min="0"
                step="1"
                className="tabular"
                value={returnWindow}
                onChange={(e) => setReturnWindow(e.target.value)}
              />
            </Field>
            <p className="border-line bg-paper-2/40 rounded-ui text-muted border px-3 py-2.5 text-xs">
              <strong className="text-ink">Low-stock alerts are set per product.</strong> Open a
              product in Inventory to switch its warning on and choose the count to warn at — a
              cable that sells daily and a plate that sells monthly need different rules.
            </p>
            <Field
              label="Opening float target (£)"
              htmlFor="set-float"
              hint={`Pre-filled in the morning float prompt — currently ${formatGBP(settings.floatTarget)}`}
            >
              <Input
                id="set-float"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                value={floatPounds}
                onChange={(e) => setFloatPounds(e.target.value)}
              />
            </Field>
            <Field
              label="Idle lock (minutes)"
              htmlFor="set-idle"
              hint="The dashboard locks itself after this long untouched"
            >
              <Input
                id="set-idle"
                type="number"
                min="1"
                step="1"
                className="tabular"
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={updateSettings.isPending}>
                {updateSettings.isPending ? 'Saving…' : 'Save shop settings'}
              </Button>
            </div>
          </form>

          {/* PIN */}
          <form onSubmit={savePin} className="border-line bg-card grid gap-4 rounded-lg border p-5">
            <h2 className="font-display text-ink flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.06em]">
              <LockKeyhole className="text-red size-4" aria-hidden="true" />
              Screen-lock PIN
            </h2>
            <p className="text-muted -mt-2 text-xs">
              Covers the dashboard when you step away. It never ends the session or loses work —
              staff logins are a separate, later phase.
            </p>
            <Field label="Current PIN" htmlFor="set-pin-current">
              <Input
                id="set-pin-current"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="off"
                className="tabular w-32 text-center tracking-[0.4em]"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New PIN" htmlFor="set-pin-new">
                <Input
                  id="set-pin-new"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  className="tabular text-center tracking-[0.4em]"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Field label="Confirm new PIN" htmlFor="set-pin-confirm">
                <Input
                  id="set-pin-confirm"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  className="tabular text-center tracking-[0.4em]"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
            </div>
            {pinError ? (
              <p className="text-red-deep text-sm font-semibold" role="alert">
                {pinError}
              </p>
            ) : pinSaved ? (
              <p className="text-success text-sm font-semibold">PIN changed.</p>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="outline"
                disabled={updateSettings.isPending || currentPin.length < 4 || newPin.length < 4}
              >
                Change PIN
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
