'use client';

import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogIn, LogOut } from 'lucide-react';
import { useSession, useSignOut, useTodaySummary } from '@/lib/data/hooks';
import { formatGBP } from '@/lib/data/types';
import { POS_TABS, can } from '@/lib/permissions.config';
import { useStaffRole, useStaffPermissions } from '@/components/shared/can';
import { FloatPrompt } from '@/components/admin/float-prompt';
import { cn } from '@/lib/utils';

/**
 * Employee panel shell (item 8): a top tab bar built for a counter — large
 * touch targets, no sidebar to reach across. Tabs are DERIVED from
 * permissions.config.ts: change a permission there and the tab (and its
 * route access) appears or disappears — no edits here.
 *
 * Employees see today's total only (permission `sales.today`); analytics,
 * history and margins stay behind the admin.
 */
export function PosShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const role = useStaffRole('counter');
  const permissions = useStaffPermissions();
  const { data: session, isPending: sessionPending } = useSession();
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
            {session?.kind === 'staff' ? (
              <button
                onClick={() => signOut.mutate(undefined)}
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

      <FloatPrompt />
    </div>
  );
}
