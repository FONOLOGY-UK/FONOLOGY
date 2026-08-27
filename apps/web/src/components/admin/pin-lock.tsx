'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Delete, LockKeyhole } from 'lucide-react';
import { useSession, useSignOut, useUnlockSession } from '@/lib/data/hooks';
import { ApiError } from '@/lib/data/adapters';
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
  const router = useRouter();
  const { data: session } = useSession();
  const unlockSession = useUnlockSession();
  const signOut = useSignOut();
  // Mock-mode fallback only — with a real staff session the server decides.
  const localLocked = useAdminStore((s) => s.locked);
  const clearLocalLock = useAdminStore((s) => s.unlock);

  const isStaff = session?.kind === 'staff';
  const locked = isStaff ? session.locked : localLocked;

  const [entered, setEntered] = useState('');
  const [shake, setShake] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // BUG-03: a correct PIN sent against a session that's no longer valid
  // (expired, signed out elsewhere) 401s the same as a wrong PIN — but it
  // isn't one, and no amount of correct digits will ever get through. Without
  // this, that reads to the person typing as "my PIN is being rejected".
  const [sessionExpired, setSessionExpired] = useState(false);

  const submitPin = useCallback(
    async (pin: string) => {
      try {
        await unlockSession.mutateAsync(pin);
        // The store flag is legacy local state; clear it so a stale `true`
        // left over from before this was server-backed can't keep the cover up.
        clearLocalLock();
        setEntered('');
        setMessage(null);
      } catch (error) {
        // `requireStaff` refuses the unlock request itself with this exact
        // text (auth.ts) when the session cookie is missing/expired/invalid —
        // before the PIN is even looked at. Everything else — an actually
        // wrong PIN, an unset one, a 500, a network error — keeps the single
        // deliberately-generic message: the server answers a wrong PIN and an
        // unset PIN identically, and this must not add a distinction the
        // server refused to make.
        if (error instanceof ApiError && error.message === 'Staff sign-in required.') {
          setSessionExpired(true);
          setMessage('Your session timed out. Sign in again to continue.');
          setEntered('');
          return;
        }
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
      if (unlockSession.isPending || sessionExpired) return;
      setEntered((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + digit;
        if (next.length === 4) void submitPin(next);
        return next;
      });
    },
    [submitPin, unlockSession.isPending, sessionExpired],
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
          {session?.name ? `${session.name} — ` : ''}screen locked after a spell of inactivity.
          Enter your 4-digit PIN to carry on; nothing is lost.
        </p>
      </div>

      {sessionExpired ? (
        // No PIN can fix this — the session itself is gone, not locked.
        // Keeping the keypad up would just invite more "wrong PIN" guesses
        // against a request that was never going to reach the PIN check.
        <a
          href="/staff-login"
          className="bg-ember text-void rounded-full px-6 py-3 text-sm font-bold transition-opacity hover:opacity-90"
        >
          Sign in again
        </a>
      ) : (
        <>
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
            <PinKey
              onClick={() => setEntered((p) => p.slice(0, -1))}
              aria-label="Delete last digit"
            >
              <Delete className="size-5" aria-hidden="true" />
            </PinKey>
          </div>

          {/* Round 3 #1.1: this overlay used to be the ONLY thing on screen
              while locked (fixed inset-0, above everything, including the
              sidebar's own "Sign out") — with no PIN and no way out from
              here, it read as a frozen app rather than a locked one. */}
          <button
            type="button"
            onClick={() =>
              signOut.mutate(undefined, { onSuccess: () => router.push('/staff-login') })
            }
            disabled={signOut.isPending}
            className="text-bone/50 hover:text-bone text-xs underline underline-offset-2 disabled:opacity-50"
          >
            {signOut.isPending ? 'Signing out…' : "Don't know the PIN? End this session"}
          </button>
        </>
      )}

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
