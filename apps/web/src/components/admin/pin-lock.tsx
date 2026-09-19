'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Delete, LockKeyhole } from 'lucide-react';
import {
  useSession,
  useSignOut,
  useSwitchStaffSession,
  useSwitchableStaff,
  useUnlockSession,
} from '@/lib/data/hooks';
import { ApiError, activeDataSource } from '@/lib/data/adapters';
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
 *
 * ---------------------------------------------------------------------------
 * CHANGE REQUEST ITEM 4 — `allowSwitching`
 * ---------------------------------------------------------------------------
 * Passed true by the POS shell and NOT by the admin shell, because the doc is
 * explicit: "Fast PIN-switching must be strictly limited to the Till/POS
 * dashboard. It cannot be used to access the Admin dashboard."
 *
 * This prop is the cosmetic half of that and nothing more. The real half is
 * server-side and does not depend on it: a PIN-switched session is marked
 * `pos_only` (0086) and `blockPosOnlySession` refuses the entire admin API
 * surface for it, whatever permissions the person holds and whichever screen
 * they reached it from. If this prop were flipped to true on the admin shell
 * tomorrow, someone could switch and would then find every admin call
 * refused — which is the correct failure, and exactly why the restriction is
 * not left to a prop.
 */
export function PinLock({ allowSwitching = false }: { allowSwitching?: boolean } = {}) {
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

  /**
   * Item 4. `switchingTo` null means "unlocking my own session" — the
   * original behaviour and still the default, because the common case by far
   * is the same person coming back to their own till.
   */
  const [switchingTo, setSwitchingTo] = useState<{ id: string; name: string } | null>(null);
  /**
   * One submission per four digits.
   *
   * `pushDigit` calls submitPin from INSIDE a setEntered updater, and React
   * is free to run an updater more than once — which it does in development
   * StrictMode. The side effect therefore fired twice. On the unlock path
   * that was invisible (two identical unlocks of the same session); on the
   * switch path added for item 4 it is not, because each call MINTS A
   * SESSION: two switches, two live staff_sessions rows, and on a wrong PIN
   * two failed attempts against the escalating delay instead of one.
   * Observed directly — one PIN entry, two live sessions in the table.
   *
   * A ref rather than state: it has to be readable and settable inside the
   * updater, synchronously, without scheduling another render.
   */
  const submitting = useRef(false);
  /** Set the moment a switch is sent, so the catch below knows which
   *  failure it is looking at. See the comment there. */
  const switchAttempted = useRef(false);
  const [picking, setPicking] = useState(false);
  const switchSession = useSwitchStaffSession();
  // Only fetched once someone actually opens the picker.
  const switchable = useSwitchableStaff(allowSwitching && picking);
  const others = (switchable.data ?? []).filter((s) => s.id !== session?.id);

  const submitPin = useCallback(
    async (pin: string) => {
      if (submitting.current) return;
      submitting.current = true;
      try {
        // Item 4: the same four digits mean two different things depending on
        // whether an account was picked — unlock mine, or switch to theirs.
        // Both end with an unlocked till; only one changes who is signed in.
        if (switchingTo) {
          switchAttempted.current = true;
          await switchSession.mutateAsync({ staffId: switchingTo.id, pin });
          setSwitchingTo(null);
          setPicking(false);
          clearLocalLock();
          setEntered('');
          setMessage(null);
          return;
        }
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
        /*
         * A FAILED SWITCH IS NOT AUTOMATICALLY A WRONG PIN, and saying so
         * once cost days.
         *
         * An `ApiError` means the server refused us and said why — a wrong
         * PIN really is a wrong PIN. Anything else (a Zod parse failure on
         * the response, a network drop mid-flight) means we never got a
         * refusal, so the switch may well have SUCCEEDED and swapped both
         * auth cookies before whatever broke, broke. That is exactly what
         * happened with item 4: the response was missing a field, the parse
         * threw, and the keypad told people their correct PIN was wrong
         * while the till had already changed hands behind the overlay.
         *
         * Reloading is safe in both directions. If the cookies did change,
         * the page comes back as the incoming person, which is what was
         * asked for. If they did not, it comes back locked as before and
         * the keypad is still there. Neither outcome is a lie.
         */
        if (switchAttempted.current && !(error instanceof ApiError)) {
          if (activeDataSource === 'http') {
            setMessage('Something went wrong finishing the switch — reloading.');
            window.location.reload();
            return;
          }
          // Mock mode has no server, so nothing can have half-happened and
          // there is nothing to reload into. The barrel's own note applies:
          // mock methods never throw ApiError, so without this check every
          // mock failure would take the branch above. Its message is written
          // for a person ("needs the real backend") — show it.
          setMessage(error instanceof Error ? error.message : 'Could not switch accounts.');
          setEntered('');
          return;
        }
        setShake(true);
        setMessage('That PIN wasn’t right.');
        setTimeout(() => {
          setShake(false);
          setEntered('');
        }, 420);
      } finally {
        switchAttempted.current = false;
        // Released even on the success path: a successful SWITCH navigates
        // away, so this never runs there, but a successful unlock stays on
        // the page and must accept a later lock/unlock cycle.
        submitting.current = false;
      }
    },
    [unlockSession, clearLocalLock, switchingTo, switchSession],
  );

  const pushDigit = useCallback(
    (digit: string) => {
      if (unlockSession.isPending || switchSession.isPending || sessionExpired) return;
      setEntered((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + digit;
        if (next.length === 4) void submitPin(next);
        return next;
      });
    },
    [submitPin, unlockSession.isPending, switchSession.isPending, sessionExpired],
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
          {switchingTo ? (
            <>
              Switching to <strong className="text-bone">{switchingTo.name}</strong>. Enter their
              4-digit PIN. This ends the current session — anything half-rung goes with it.
            </>
          ) : (
            <>
              {session?.name ? `${session.name} — ` : ''}screen locked after a spell of inactivity.
              Enter your 4-digit PIN to carry on; nothing is lost.
            </>
          )}
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

          {/*
            Change request item 4 — the account picker, till only.

            Deliberately NOT the first thing on screen. The overwhelmingly
            common case is the same person coming back to their own till, so
            that stays a four-digit keypad with nothing in the way; switching
            is one tap behind it. Leading with a list of names would slow the
            frequent case down to speed up the rare one.
          */}
          {allowSwitching && !switchingTo ? (
            picking ? (
              <div className="w-full max-w-[280px]">
                {switchable.isPending ? (
                  <p className="text-bone/50 text-center text-xs">Loading…</p>
                ) : others.length === 0 ? (
                  <p className="text-bone/50 text-center text-xs">
                    Nobody else has a PIN set up for the till.
                  </p>
                ) : (
                  <ul className="grid max-h-48 gap-1.5 overflow-y-auto">
                    {others.map((person) => (
                      <li key={person.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSwitchingTo(person);
                            setEntered('');
                            setMessage(null);
                          }}
                          className="bg-void-2 text-bone hover:bg-red w-full rounded-full px-4 py-2.5 text-sm font-semibold transition-colors"
                        >
                          {person.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="text-bone/50 hover:text-bone mt-2 w-full text-center text-xs underline underline-offset-2"
                >
                  Back
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="text-bone/50 hover:text-bone text-xs underline underline-offset-2"
              >
                Someone else taking over?
              </button>
            )
          ) : null}

          {switchingTo ? (
            <button
              type="button"
              onClick={() => {
                setSwitchingTo(null);
                setEntered('');
                setMessage(null);
              }}
              className="text-bone/50 hover:text-bone text-xs underline underline-offset-2"
            >
              Not {switchingTo.name} — go back
            </button>
          ) : null}

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
        {unlockSession.isPending || switchSession.isPending ? 'Checking…' : (message ?? '')}
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
