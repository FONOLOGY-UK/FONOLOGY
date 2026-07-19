'use client';

import { useCallback, useEffect, useState } from 'react';
import { Delete, LockKeyhole } from 'lucide-react';
import { useSettings } from '@/lib/data/hooks';
import { useAdminStore } from '@/lib/stores/admin.store';
import { cn } from '@/lib/utils';

/**
 * Dashboard SCREEN LOCK (item 7). An overlay above the admin — the pages
 * underneath stay mounted, so locking never ends the session or loses
 * in-progress work. Fires from the lock button or the idle timeout.
 * This is not authentication (that's item 9): it's the shop-floor
 * "step away from the till" cover.
 */
export function PinLock() {
  const locked = useAdminStore((s) => s.locked);
  const unlock = useAdminStore((s) => s.unlock);
  const { data: settings } = useSettings();

  const [entered, setEntered] = useState('');
  const [shake, setShake] = useState(false);

  const pushDigit = useCallback(
    (digit: string) => {
      if (!settings) return;
      setEntered((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + digit;
        if (next.length === 4) {
          if (next === settings.adminPin) {
            // Tiny beat so the 4th dot fills before the cover lifts.
            setTimeout(() => {
              unlock();
              setEntered('');
            }, 120);
          } else {
            setShake(true);
            setTimeout(() => {
              setShake(false);
              setEntered('');
            }, 420);
          }
        }
        return next;
      });
    },
    [settings, unlock],
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
      aria-label="Dashboard locked — enter PIN"
      className="bg-void text-bone fixed inset-0 z-[3000] flex flex-col items-center justify-center gap-8 p-6"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="bg-void-2 mb-2 inline-flex size-12 items-center justify-center rounded-full">
          <LockKeyhole className="text-ember size-5" aria-hidden="true" />
        </span>
        <p className="font-display text-2xl font-extrabold uppercase tracking-tight">
          Fonology<span className="text-red">.</span>
        </p>
        <p className="text-bone/60 max-w-[260px] text-sm">
          Screen locked. Enter the 4-digit PIN — everything is exactly where you left it.
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

      <p className="text-bone/35 text-xs">Demo build — the PIN is 1234 (change it in Settings).</p>
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
