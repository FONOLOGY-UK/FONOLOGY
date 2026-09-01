/**
 * Browser-side mirror of `apps/api/src/lib/cookies.ts`'s registrable-domain
 * check. Same reasoning applies here as there — read that file's header
 * comment first if you haven't. This exists so `apiFetch` (http.adapter.ts)
 * can decide, from inside the browser, whether a call to the API is
 * same-site with the page it's running on:
 *
 *   - Same-site (local dev; production once api.fonology.co.uk exists):
 *     call the API directly. Cookies are `SameSite=Lax` and travel fine on
 *     an ordinary cross-origin-but-same-site fetch.
 *   - Cross-site (staging today — fonology-web.onrender.com calling
 *     fonology-api.onrender.com, and `onrender.com` is itself on the Public
 *     Suffix List): don't call the API directly. Safari's Intelligent
 *     Tracking Prevention blocks cross-site cookies outright — regardless
 *     of `SameSite=None; Secure` — so a cookie the API sets never comes
 *     back on the next request, and every authenticated flow (staff login
 *     included) silently fails in Safari while working fine in Chrome.
 *     Route through this app's own `/api-proxy/*` instead: same-origin from
 *     the browser's point of view, so there's no cross-site cookie question
 *     for Safari (or anyone else) to enforce at all.
 *
 * Not shared as a package with apps/api (no populated `packages/*` yet in
 * this monorepo — see CLAUDE.md) — duplicated deliberately rather than
 * reached across app boundaries for a dozen lines of pure logic. Keep the
 * two lists (MULTI_TENANT_SUFFIXES, TWO_LABEL_TLDS) in sync if either
 * changes; a small `packages/shared` extracting both copies would be a
 * reasonable follow-up once there's a second reason to want one.
 */

const MULTI_TENANT_SUFFIXES = [
  'onrender.com',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'github.io',
  'pages.dev',
];

const TWO_LABEL_TLDS = [
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'com.au',
  'co.nz',
  'co.jp',
];

function registrableDomain(hostname: string): string {
  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname;

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_TENANT_SUFFIXES.includes(lastTwo) || TWO_LABEL_TLDS.includes(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

export function isSameSite(hostA: string, hostB: string): boolean {
  return registrableDomain(hostA) === registrableDomain(hostB);
}
