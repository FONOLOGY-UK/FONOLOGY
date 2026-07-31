'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowDownLeft,
  Banknote,
  CalendarCheck,
  CreditCard,
  ExternalLink,
  FileText,
  Gauge,
  Lock,
  Menu,
  Package,
  Percent,
  Settings,
  ShoppingBag,
  Tag,
  Undo2,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useLockSession, useSession, useSettings } from '@/lib/data/hooks';
import { useStaffPermissions } from '@/components/shared/can';
import { type Permission } from '@/lib/permissions.config';
import { useAdminStore } from '@/lib/stores/admin.store';
import { cn } from '@/lib/utils';
import { FloatPrompt } from './float-prompt';
import { PinLock } from './pin-lock';

/**
 * Admin app shell (item 7): dark bench-wall sidebar against the paper work
 * canvas. Deliberately quiet — the storefront is the show, this is the
 * back of house. Motion is 150ms colour transitions only.
 */

interface NavEntry {
  label: string;
  href: string;
  icon: typeof Gauge;
  /**
   * Hide this entry unless the viewer holds the permission. Optional: entries
   * without one are shown to any staff member reaching the admin panel, which
   * is how every entry here behaved before. UX only — the server is the real
   * boundary and refuses the request regardless.
   */
  permission?: Permission;
}

const NAV_GROUPS: { heading: string | null; items: NavEntry[] }[] = [
  {
    heading: null,
    items: [{ label: 'Overview', href: '/admin', icon: Gauge }],
  },
  {
    heading: 'Operations',
    items: [
      { label: 'Online orders', href: '/admin/orders', icon: ShoppingBag },
      { label: 'Jobs', href: '/admin/jobs', icon: Wrench },
      { label: 'Returns', href: '/admin/returns', icon: Undo2 },
      { label: 'Cash drawer', href: '/admin/cash', icon: Banknote },
      {
        label: 'Close the day',
        href: '/admin/day-close',
        icon: CalendarCheck,
        permission: 'cash.manage',
      },
    ],
  },
  {
    heading: 'Catalogue',
    items: [
      { label: 'Inventory', href: '/admin/inventory', icon: Package },
      { label: 'Promotions', href: '/admin/promotions', icon: Percent },
      { label: 'Labels', href: '/admin/labels', icon: Tag },
    ],
  },
  {
    heading: 'Money',
    items: [
      { label: 'Payments', href: '/admin/payments', icon: CreditCard },
      {
        label: 'Trade-ins',
        href: '/admin/trade-ins',
        icon: ArrowDownLeft,
        permission: 'tradein.manage',
      },
      { label: 'Reports', href: '/admin/reports', icon: FileText },
    ],
  },
  {
    heading: 'Team',
    items: [
      { label: 'Staff', href: '/admin/staff', icon: Users },
      { label: 'Settings', href: '/admin/settings', icon: Settings },
    ],
  },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const localLocked = useAdminStore((s) => s.locked);
  const localLock = useAdminStore((s) => s.lock);
  const { data: settings } = useSettings();
  const { data: session } = useSession();
  const lockSession = useLockSession();

  /**
   * Locking goes to the server (`staff_sessions.locked`) so a reload can't
   * undo it. The local store flag is only the mock-mode path, where there is
   * no staff session to lock.
   */
  const isStaff = session?.kind === 'staff';
  const locked = isStaff ? (session.locked ?? false) : localLocked;
  const lock = useCallback(() => {
    if (isStaff) lockSession.mutate(undefined);
    else localLock();
  }, [isStaff, lockSession, localLock]);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Nav entries that declare a permission are hidden without it. UX only —
  // the server refuses the request either way.
  const staffPermissions = useStaffPermissions();

  // ---- idle timeout -> screen lock (never loses work; it's an overlay) ----
  const lastActive = useRef(Date.now());
  useEffect(() => {
    const touch = () => {
      lastActive.current = Date.now();
    };
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch, { passive: true });
    window.addEventListener('scroll', touch, { passive: true });
    const interval = setInterval(() => {
      if (locked || !settings) return;
      if (Date.now() - lastActive.current > settings.idleLockMinutes * 60_000) lock();
    }, 15_000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.removeEventListener('scroll', touch);
      clearInterval(interval);
    };
  }, [locked, settings, lock]);

  // Close the mobile drawer on navigation.
  useEffect(() => setMobileOpen(false), [pathname]);

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const sidebar = (
    <div className="bg-void text-bone flex h-full flex-col">
      <div className="border-b border-white/10 px-5 py-5">
        <Link
          href="/admin"
          className="font-display text-lg font-extrabold uppercase tracking-tight"
        >
          Fonology<span className="text-red">.</span>
        </Link>
        <p className="text-bone/40 mt-0.5 text-[10px] font-bold uppercase tracking-[0.22em]">
          Back of house
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Admin">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && 'mt-5')}>
            {group.heading ? (
              <p className="text-bone/35 mb-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.2em]">
                {group.heading}
              </p>
            ) : null}
            <ul className="grid gap-0.5">
              {group.items.map((item) => {
                // Gate on the REAL per-person set, not can()'s role fallback:
                // ROLE_PERMISSIONS['counter'] contains cash.manage, so a
                // counter whose grant has actually been removed would still
                // be offered the link. With no staff session at all (mock,
                // or still loading) the entry stays visible, which is how
                // every other entry here behaves.
                if (
                  item.permission &&
                  staffPermissions &&
                  !staffPermissions.includes(item.permission)
                ) {
                  return null;
                }
                const active =
                  item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-semibold transition-colors duration-150',
                        active
                          ? 'text-bone bg-white/[0.07]'
                          : 'text-bone/55 hover:text-bone hover:bg-white/[0.04]',
                      )}
                    >
                      {active ? (
                        <span
                          className="bg-red absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full"
                          aria-hidden="true"
                        />
                      ) : null}
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        <button
          onClick={lock}
          className="text-bone/55 hover:text-bone flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-semibold transition-colors duration-150 hover:bg-white/[0.04]"
          title="Lock the dashboard (PIN to resume — nothing is lost)"
        >
          <Lock className="size-4" aria-hidden="true" />
          Lock screen
        </button>
        <Link
          href="/"
          target="_blank"
          className="text-bone/55 hover:text-bone flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-semibold transition-colors duration-150 hover:bg-white/[0.04]"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          View storefront
        </Link>
        <p className="text-bone/30 tabular mt-2 px-2.5 text-[11px]">{today}</p>
      </div>
    </div>
  );

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Mobile top bar */}
      <header className="bg-void text-bone sticky top-0 z-40 flex items-center justify-between px-4 py-3 lg:hidden">
        <Link href="/admin" className="font-display text-base font-extrabold uppercase">
          Fonology<span className="text-red">.</span>{' '}
          <span className="text-bone/40 text-[10px] tracking-[0.2em]">Admin</span>
        </Link>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          className="rounded-md p-2 hover:bg-white/10"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="shadow-drawer absolute inset-y-0 left-0 w-[248px]">{sidebar}</aside>
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[232px_1fr]">
        {/* Desktop sidebar */}
        {/*
          Suspense boundaries around the sidebar and page keep any
          hydration-time suspension contained instead of bubbling to the
          route's root boundary (which shows the whole-page "Loading"
          fallback until it resolves — notably slow in throttled/background
          tabs). Cheap insurance; keep them.
        */}
        <aside className="sticky top-0 hidden h-screen lg:block">
          <Suspense fallback={null}>{sidebar}</Suspense>
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1200px]">
            <Suspense fallback={null}>{children}</Suspense>
          </div>
        </main>
      </div>

      <PinLock />
      {/*
        Not while locked. The float prompt is a Radix modal: it marks
        everything outside itself aria-hidden and traps focus, which left the
        PIN keypad visually on top but completely inert — the lock could not be
        opened at all, and a screen reader couldn't see it either. Nothing
        behind the lock needs prompting until it's open.
      */}
      {locked ? null : <FloatPrompt />}
    </div>
  );
}
