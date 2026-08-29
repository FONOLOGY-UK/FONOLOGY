'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LayoutDashboard, LogOut, Search, User } from 'lucide-react';
import { useSession, useSignOut } from '@/lib/data/hooks';
import { useStaffPermissions, useStaffRole } from '@/components/shared/can';
import { can } from '@/lib/permissions.config';
import { signInHref } from '@/lib/auth-redirect';

/**
 * The account control in the storefront nav, sat next to the bag — the one
 * place on the shop that leads to /login.
 *
 * Before this existed there was NO link to any auth route from the storefront:
 * /login, /register and /staff-login could only be reached by typing the path.
 * The only exception was one "Have an account? Sign in" line buried in the
 * checkout details step.
 *
 * Signed out it is a plain link, not a menu — one click to the sign-in page is
 * the shorter path, and /register is already the second link on it. Signed in
 * it has to be a menu, because signing out needs somewhere to live and the
 * storefront had nowhere at all.
 *
 * Deliberately NOT gated on an account existing: customer accounts are
 * optional here (see lib/data/types/auth.ts), so this stays a convenience and
 * never reads as a wall in front of the shop.
 */
export function AccountMenu() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const signOut = useSignOut();
  // Read before the signed-out early return — hooks can't sit behind a branch.
  const staffRole = useStaffRole('employee');
  const staffPermissions = useStaffPermissions();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on route change, Escape, and any click that isn't inside the menu.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (!session) {
    return (
      <Link href={signInHref(pathname)} className="nav__account" data-cursor>
        <User className="nav__account-icon" aria-hidden="true" />
        <span className="nav__account-word">Sign in</span>
      </Link>
    );
  }

  const firstName = session.name.trim().split(/\s+/)[0] || 'Account';
  const isStaff = session.kind === 'staff';
  // Same rule as the staff sign-in page: managers belong on the dashboard,
  // counter staff on the till. Keeps one answer to "where do I go back to".
  const staffHome = can(staffRole, 'analytics.view', staffPermissions) ? '/admin' : '/pos';

  return (
    <div className="nav__account-wrap" ref={wrapRef}>
      <button
        type="button"
        className={open ? 'nav__account is-open' : 'nav__account'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-cursor
      >
        <User className="nav__account-icon" aria-hidden="true" />
        <span className="nav__account-word">{firstName}</span>
      </button>

      {open ? (
        <div className="acct-menu" role="menu">
          <p className="acct-menu__who">
            <strong>{session.name}</strong>
            <span>{session.email}</span>
          </p>
          {isStaff ? (
            <Link href={staffHome} className="acct-menu__item" role="menuitem">
              <User className="size-4" aria-hidden="true" />
              Back to the counter
            </Link>
          ) : (
            <>
              {/* Round 5 Phase 3 #22 */}
              <Link href="/account" className="acct-menu__item" role="menuitem">
                <LayoutDashboard className="size-4" aria-hidden="true" />
                My account
              </Link>
              <Link href="/track" className="acct-menu__item" role="menuitem">
                <Search className="size-4" aria-hidden="true" />
                Track an order or repair
              </Link>
            </>
          )}
          <button
            type="button"
            className="acct-menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut.mutate(undefined);
            }}
            disabled={signOut.isPending}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {signOut.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The same links for the full-screen mobile menu, where the nav's compact
 * control is too small to carry a dropdown. Rendered inside `.menu__meta`, so
 * it inherits that block's muted-on-void treatment.
 */
export function MenuAccountLinks() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const signOut = useSignOut();

  if (!session) {
    return (
      <p className="menu__account">
        <Link href={signInHref(pathname)}>Sign in</Link>
        <Link href="/register">Create an account</Link>
        <Link href="/track">Track an order</Link>
      </p>
    );
  }

  return (
    <p className="menu__account">
      <span className="menu__account-who">Signed in as {session.name}</span>
      {session.kind === 'customer' ? <Link href="/account">My account</Link> : null}
      <Link href="/track">Track an order</Link>
      <button type="button" onClick={() => signOut.mutate(undefined)}>
        Sign out
      </button>
    </p>
  );
}

/**
 * Footer sign-in links, including the STAFF door.
 *
 * /staff-login belongs down here and nowhere else: it is the one auth route
 * with no customer-facing purpose, so it stays out of the nav, but a member of
 * staff on a shop tablet still has to be able to reach it without typing a
 * path. A discreet footer link is where every small-business site puts it.
 */
export function FooterAuthLinks() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const signOut = useSignOut();

  return (
    <>
      {session ? (
        <button type="button" className="footer__auth" onClick={() => signOut.mutate(undefined)}>
          Sign out
        </button>
      ) : (
        <>
          <Link href={signInHref(pathname)} data-cursor>
            Sign in
          </Link>
          <Link href="/register" data-cursor>
            Create an account
          </Link>
        </>
      )}
      <Link href="/staff-login" data-cursor>
        Staff sign-in
      </Link>
    </>
  );
}
