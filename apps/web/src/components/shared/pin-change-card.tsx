'use client';

import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useSetStaffPin } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';

/**
 * "Your screen-lock PIN" — extracted out of admin/settings/settings-view.tsx
 * (Round 5 Phase 2 #4) so the staff panel's own Settings tab can offer the
 * exact same self-service PIN change without duplicating the form logic.
 * `useSetStaffPin` -> `POST /staff/pin` was already self-scoped server-side
 * (`.eq('id', req.user!.id)`, no staff id ever accepted from the client) —
 * the only thing blocking counter staff from reaching it was that the only
 * place this card was mounted required `settings.manage`.
 */
export function PinChangeCard() {
  const setStaffPin = useSetStaffPin();
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaved, setPinSaved] = useState(false);

  const savePin = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSaved(false);
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('The new PIN must be exactly 4 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError('The new PINs don’t match.');
      return;
    }
    setStaffPin.mutate(newPin, {
      onSuccess: () => {
        setNewPin('');
        setConfirmPin('');
        setPinSaved(true);
      },
      onError: (error) =>
        setPinError(error instanceof Error ? error.message : 'Could not set the PIN.'),
    });
  };

  return (
    <form onSubmit={savePin} className="border-line bg-card grid gap-4 rounded-lg border p-5">
      <h2 className="font-display text-ink flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.06em]">
        <LockKeyhole className="text-red size-4" aria-hidden="true" />
        Your screen-lock PIN
      </h2>
      <p className="text-muted -mt-2 text-xs">
        Yours alone, not a shop-wide code — each member of staff has their own. It covers the screen
        when you step away and never ends the session or loses work. Setting it here replaces
        whatever you had before; there is no current PIN to enter, because the server stores it
        hashed and never hands it back.
      </p>
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
          disabled={setStaffPin.isPending || newPin.length < 4 || confirmPin.length < 4}
        >
          Change PIN
        </Button>
      </div>
    </form>
  );
}
