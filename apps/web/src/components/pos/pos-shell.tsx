'use client';

import { Suspense, useCallback, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Lock, LogIn, LogOut } from 'lucide-react';
import {
  useLockSession,
  useSession,
  useSettings,
  useSignOut,
  useTodaySummary,
} from '@/lib/data/hooks';
import { formatGBP } from '@/lib/data/types';
import { POS_TABS, can } from '@/lib/permissions.config';
import { useStaffRole, useStaffPermissions } from '@/components/shared/can';
import { FloatPrompt } from '@/components/admin/float-prompt';
import { PinLock } from '@/components/admin/pin-lock';
import { useAdminStore } from '@/lib/stores/admin.store';
import { cn } from '@/lib/utils';

/**
 * Employee panel shell (item 8): a top tab bar built for a counter — large
 * touch targets, no sidebar to reach across. Tabs are DERIVED from
 * permissions.config.ts: change a permission there and the tab (and its
 * route access) appears or disappears — no edits here.
 *
 * Employees see today's total only (permission `sales.today`); analytics,
 * history and margins stay behind the admin.
 *
 * `<PinLock />` was missing from this shell entirely until Step 4's
 * verification pass (Aug 2026). `POST /pos/sales` is gated by
 * `requireUnlocked` — so the server has always expected a locked staff
 * session to be reachable at the till — but nothing here could ever show
 * the lock screen or let anyone type a PIN to clear it. A session locked
 * while the till was open (the admin-shell idle timer, or the same staff
 * account open in a second tab) would have left every sale failing with a
 * 423 and no way back in short of signing out. `route-guard.tsx` was
 * checked and only gates on permission, never on `session.locked` — this
 * really was the only place it could have been handled. Same component
 * admin-shell uses, so the exemption logic in `ui/dialog.tsx` (never fight
 * a `role="dialog"` element for focus) already covers it here too.
 */
export function PosShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const role = useStaffRole('employee');
  const permissions = useStaffPermissions();
  const { data: session, isPending: sessionPending } = useSession();
  const { data: settings } = useSettings();
  const localLocked = useAdminStore((s) => s.locked);
  const localLock = useAdminStore((s) => s.lock);
  const lockSession = useLockSession();
  const signOut = useSignOut();
  const today = useTodaySummary();

  // Hold off rendering permission-gated tabs until the session (and with it,
  // the real per-person permission set) has resolved — otherwise `can()`
  // briefly falls back to the coarse role map and can flash a tab the signed-
  // in person doesn't actually hold (e.g. Promotions for counter staff).
  const tabs = sessionPending
    ? []
    : POS_TABS.filter((tab) => can(role, tab.permission, permissions));
  const staffName = session?.kind === 'staff' ? session.name : 'Counter';
  // Same computation as admin-shell — the server session is the only source
  // of truth (see PinLock's own comment: a reload cannot lift this).
  const isStaff = session?.kind === 'staff';
  const locked = isStaff ? (session.locked ?? false) : localLocked;
  const lock = useCallback(() => {
    if (isStaff) lockSession.mutate(undefined);
    else localLock();
  }, [isStaff, lockSession, localLock]);

  // ---- idle timeout -> screen lock (same pattern as admin-shell; never
  // loses the ticket — it's an overlay, not a navigation) ----
  //
  // `GET /admin/settings` requires `settings.manage`, which counter staff
  // never hold — deliberately: idleLockMinutes tells an attacker how long an
  // unattended till stays open (see the comment on it in
  // apps/api/src/routes/shop.routes.ts). So `settings` is never just
  // "loading" here, it's permanently unavailable for this audience, and
  // admin-shell's `!settings` early-return would silently turn this whole
  // feature off for exactly the role it's for. Same gap, same fix already
  // used for `floatTarget` in float-prompt.tsx: fall back to the shop's
  // actual default (mock/admin.ts's `idleLockMinutes: 5`) rather than never
  // locking. A manager who changes the real value from Settings still gets
  // the real number here — this only matters for the till's own display.
  const idleLockMinutes = settings?.idleLockMinutes ?? 5;
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      lastActive.current = Date.now();
    };
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch, { passive: true });
    window.addEventListener('scroll', touch, { passive: true });
    const interval = setInterval(() => {
      if (locked) return;
      if (Date.now() - lastActive.current > idleLockMinutes * 60_000) lock();
    }, 15_000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.removeEventListener('scroll', touch);
      clearInterval(interval);
    };
  }, [locked, idleLockMinutes, lock]);

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="bg-void text-bone sticky top-0 z-40 print:hidden">
        <div className="flex items-center gap-4 px-4 py-2.5">
          <p className="font-display text-base font-extrabold uppercase tracking-tight">
            Fonology<span className="text-red">.</span>{' '}
            <span className="text-bone/40 text-[10px] tracking-[0.22em]">Counter</span>
          </p>

          <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="Counter">
            {tabs.map((tab) => {
              const active =
                tab.href === '/pos' ? pathname === '/pos' : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'whitespace-nowrap rounded-md px-3.5 py-2 text-[13px] font-bold uppercase tracking-[0.04em] transition-colors duration-150',
                    active ? 'bg-red text-white' : 'text-bone/60 hover:text-bone hover:bg-white/5',
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          {!sessionPending && can(role, 'sales.today', permissions) ? (
            <p
              className="tabular border-r border-white/10 pr-4 text-right text-[13px] leading-tight"
              title="Today's takings — the only sales figure on this panel"
            >
              <span className="text-bone font-extrabold">
                {today.data ? formatGBP(today.data.total) : '—'}
              </span>
              <br />
              <span className="text-bone/45 text-[10px] uppercase tracking-[0.14em]">
                Today · {today.data?.sales ?? 0} sales
              </span>
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <span className="text-bone/70 max-w-[140px] truncate text-[13px] font-semibold">
              {staffName}
            </span>
            <button
              onClick={lock}
              className="text-bone/50 hover:text-bone rounded-md p-2 transition-colors"
              title="Lock the till (PIN to resume — nothing is lost)"
            >
              <Lock className="size-4" aria-hidden="true" />
              <span className="sr-only">Lock till</span>
            </button>
            {session?.kind === 'staff' ? (
              <button
                // Land on the staff door, not a signed-out till. Without this
                // the counter is left on /pos with no session, which looks
                // like a broken screen rather than a finished shift.
                onClick={() =>
                  signOut.mutate(undefined, { onSuccess: () => router.push('/staff-login') })
                }
                className="text-bone/50 hover:text-bone rounded-md p-2 transition-colors"
                title="Sign out"
              >
                <LogOut className="size-4" aria-hidden="true" />
                <span className="sr-only">Sign out</span>
              </button>
            ) : (
              <Link
                href="/staff-login"
                className="text-bone/50 hover:text-bone rounded-md p-2 transition-colors"
                title="Staff sign in"
              >
                <LogIn className="size-4" aria-hidden="true" />
                <span className="sr-only">Staff sign in</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="min-w-0 flex-1">
        <Suspense fallback={null}>{children}</Suspense>
      </main>

      <PinLock />
      {locked ? null : <FloatPrompt />}
    </div>
  );
}
