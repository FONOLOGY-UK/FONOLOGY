/**
 * Where to send someone after they sign in.
 *
 * The auth pages accept `?redirect=` so that "Sign in" from the checkout, the
 * basket or any storefront page returns to the page it was clicked on instead
 * of dumping the customer on the homepage. That parameter is attacker-writable
 * — anyone can send a Fonology customer a `/login?redirect=…` link — so it is
 * never used raw.
 *
 * Only a same-origin, path-relative destination survives. Rejected:
 *   `https://evil.example`  absolute URL — the classic open redirect
 *   `//evil.example`        protocol-relative; the browser treats it as absolute
 *   `/\evil.example`        backslash variant some browsers normalise to `//`
 *   `javascript:…`          no scheme is allowed through at all
 * Anything rejected falls back to the homepage, which is always safe.
 */
// Round 5 Phase 3 #22 — signing in with no more specific destination now
// lands on the account dashboard rather than the homepage. Every explicit
// `?redirect=` (checkout, "sign in" clicked from a specific page) still
// wins over this — see signInHref below, which always attaches the
// current page as an explicit redirect. This only changes the truly
// no-context case: visiting /login directly.
export const DEFAULT_REDIRECT = '/account';

export function safeRedirect(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_REDIRECT;
  const value = raw.trim();
  if (!value.startsWith('/')) return DEFAULT_REDIRECT;
  // Second character decides: `//` and `/\` both escape to another origin.
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_REDIRECT;
  return value;
}

/**
 * Build the sign-in href for a "Sign in" control, remembering where it was
 * clicked. Auth routes themselves are never used as a destination — bouncing
 * someone from /register back to /register, or looping /login → /login, is
 * worse than the homepage.
 */
const AUTH_ROUTES = ['/login', '/register', '/forgot-password', '/staff-login', '/auth'];

export function signInHref(pathname: string | null | undefined): string {
  if (!pathname || AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return '/login';
  }
  return `/login?redirect=${encodeURIComponent(pathname)}`;
}
