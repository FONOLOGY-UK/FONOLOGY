'use client';

import { useCallback, useEffect, useState } from 'react';
import { Delete, LockKeyhole } from 'lucide-react';
import { useSession, useUnlockSession } from '@/lib/data/hooks';
import { useAdminStore } from '@/lib/stores/admin.store';
import { cn } from '@/lib/utils';

/**
 * Staff session lock (Phase 2.2).
 *
 * The lock lives on the server, in `staff_sessions.locked`, read fresh on
 * every request. This overlay only REFLECTS it: reloading the page, opening a
 * new tab, or clearing local storage cannot lift it, because none of those
 * touch the row the server reads. Locked sessions are refused by the API
 * itself (`requireUnlocked` → 423) — the cover on the screen is the courtesy,
 * not the control.
 *
 * The PIN is per person (`staff.pin_hash`), never a shared shop code, and is
 * never compared here: the four digits are sent once to
 * `POST /staff/session/unlock` and are not retained afterwards.
 *
 * Mock mode keeps its own in-memory flag so the flow stays demonstrable
 * without a backend; that path is a demo, not a security boundary.
 */
export function PinLock() {
  const { data: session } = useSession();
  const unlockSession = useUnlockSession();
  // Mock-mode fallback only — with a real staff session the server decides.
  const localLocked = useAdminStore((s) => s.locked);
  const clearLocalLock = useAdminStore((s) => s.unlock);

  const isStaff = session?.kind === 'staff';
  const locked = isStaff ? session.locked : localLocked;

  const [entered, setEntered] = useState('');
  const [shake, setShake] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submitPin = useCallback(
    async (pin: string) => {
      try {
        await unlockSession.mutateAsync(pin);
        // The store flag is legacy local state; clear it so a stale `true`
        // left over from before this was server-backed can't keep the cover up.
        clearLocalLock();
        setEntered('');
        setMessage(null);
      } catch {
        // Deliberately one message for every failure. The server answers a
        // wrong PIN and an unset PIN identically, and this must not add a
        // distinction the server refused to make.
        setShake(true);
        setMessage('That PIN wasn’t right.');
        setTimeout(() => {
          setShake(false);
          setEntered('');
        }, 420);
      }
    },
    [unlockSession, clearLocalLock],
  );

  const pushDigit = useCallback(
    (digit: string) => {
      if (unlockSession.isPending) return;
      setEntered((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + digit;
        if (next.length === 4) void submitPin(next);
        return next;
      });
    },
    [submitPin, unlockSession.isPending],
  );

  // Physical keyboard works too — digits + backspace.
  useEffect(() => {
    if (!locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pushDigit(e.key);
      if (e.key === 'Backspace') setEntered((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked, pushDigit]);

  if (!locked) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session locked — enter PIN"
      className="bg-void text-bone fixed inset-0 z-[3000] flex flex-col items-center justify-center gap-8 p-6"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="bg-void-2 mb-2 inline-flex size-12 items-center justify-center rounded-full">
          <LockKeyhole className="text-ember size-5" aria-hidden="true" />
        </span>
        <p className="font-display text-2xl font-extrabold uppercase tracking-tight">
          Fonology<span className="text-red">.</span>
        </p>
        <p className="text-bone/60 max-w-[280px] text-sm">
          {session?.name ? `${session.name} — ` : ''}screen locked. Enter your 4-digit PIN;
          everything is exactly where you left it.
        </p>
      </div>

      <div className={cn('flex items-center gap-4', shake && 'pin-shake')} aria-live="polite">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'size-3.5 rounded-full border transition-colors duration-150',
              i < entered.length ? 'bg-red border-red' : 'border-bone/30 bg-transparent',
            )}
          />
        ))}
        <span className="sr-only">{entered.length} of 4 digits entered</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <PinKey key={digit} onClick={() => pushDigit(digit)}>
            {digit}
          </PinKey>
        ))}
        <span aria-hidden="true" />
        <PinKey onClick={() => pushDigit('0')}>0</PinKey>
        <PinKey onClick={() => setEntered((p) => p.slice(0, -1))} aria-label="Delete last digit">
          <Delete className="size-5" aria-hidden="true" />
        </PinKey>
      </div>

      <p className="text-bone/60 min-h-[1rem] text-xs" role="status">
        {unlockSession.isPending ? 'Checking…' : (message ?? '')}
      </p>
    </div>
  );
}

function PinKey({
  children,
  onClick,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="bg-void-2 text-bone hover:bg-red focus-visible:ring-ember flex size-16 items-center justify-center rounded-full text-xl font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 active:scale-95"
    >
      {children}
    </button>
  );
}
