'use client';

import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { useSession, useSetOwnIdleLock, useSettings } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { PinChangeCard } from '@/components/shared/pin-change-card';

/**
 * Round 5 Phase 2 #4 — a Settings tab in the staff panel, for the two
 * things every staff member should be able to set for themselves without
 * needing settings.manage (an owner-only permission counter staff never
 * hold): their own screen-lock PIN, and their own auto-lock timeout.
 *
 * Both mutations are self-scoped server-side — POST /staff/pin and POST
 * /staff/me/idle-lock both write `.eq('id', req.user!.id)` with no staff
 * id ever accepted in the request body, so there is no field a caller
 * could tamper with to reach anyone else's row. That's the actual
 * enforcement; this screen only decides who gets a route to reach it.
 */
export function StaffSettingsView() {
  const { data: session } = useSession();
  const { data: shopSettings } = useSettings();
  const setIdleLock = useSetOwnIdleLock();

  const [idleMinutes, setIdleMinutes] = useState('');
  const [useShopDefault, setUseShopDefault] = useState(true);

  useEffect(() => {
    if (session?.kind !== 'staff') return;
    if (session.idleLockMinutes != null) {
      setUseShopDefault(false);
      setIdleMinutes(`${session.idleLockMinutes}`);
    } else {
      setUseShopDefault(true);
      setIdleMinutes('');
    }
  }, [session]);

  const saveIdleLock = (e: React.FormEvent) => {
    e.preventDefault();
    if (useShopDefault) {
      setIdleLock.mutate(null);
      return;
    }
    const minutes = Math.max(1, Math.round(Number(idleMinutes) || 0));
    if (minutes < 1) return;
    setIdleLock.mutate(minutes);
  };

  const shopDefault = shopSettings?.idleLockMinutes;

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Your account"
        title="Settings"
        description="Your own PIN and auto-lock timeout. Nothing here is shared with, or changes, anyone else's."
      />

      <div className="grid gap-4">
        <PinChangeCard />

        <form
          onSubmit={saveIdleLock}
          className="border-line bg-card grid gap-4 rounded-lg border p-5"
        >
          <h2 className="font-display text-ink flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.06em]">
            <Timer className="text-red size-4" aria-hidden="true" />
            Your auto-lock
          </h2>
          <p className="text-muted -mt-2 text-xs">
            How long the till or dashboard sits idle before it locks itself, needing your PIN to
            resume. The shop default is currently{' '}
            <strong className="text-ink">
              {shopDefault != null ? `${shopDefault} minute${shopDefault === 1 ? '' : 's'}` : '…'}
            </strong>
            . Set your own here if you want a different one — nothing is lost when it locks, it’s
            only an overlay.
          </p>

          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input
              type="radio"
              name="idle-lock-mode"
              className="accent-[var(--red)]"
              checked={useShopDefault}
              onChange={() => setUseShopDefault(true)}
            />
            Use the shop default
          </label>
          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input
              type="radio"
              name="idle-lock-mode"
              className="accent-[var(--red)]"
              checked={!useShopDefault}
              onChange={() => setUseShopDefault(false)}
            />
            Use my own timeout
          </label>

          {!useShopDefault ? (
            <Field label="Minutes" htmlFor="own-idle-minutes" hint="At least 1 minute.">
              <Input
                id="own-idle-minutes"
                type="number"
                min="1"
                step="1"
                className="tabular w-28"
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(e.target.value)}
              />
            </Field>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="outline"
              disabled={setIdleLock.isPending || (!useShopDefault && !idleMinutes)}
            >
              {setIdleLock.isPending ? 'Saving…' : 'Save auto-lock'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
