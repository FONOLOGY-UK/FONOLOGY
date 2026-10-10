/**
 * Browser-side mirror of `apps/api/src/lib/cookies.ts`'s registrable-domain check (read that header
 * first). `apiFetch` (http.adapter.ts) uses it to decide whether a call to the API is same-site with the
 * page it is running on:
 *
 *   - Same-site (local dev; production, `fonology.co.uk` -> `api.fonology.co.uk`): call the API
 *     directly. Cookies are `SameSite=Lax` and travel fine.
 *   - Cross-site (e.g. both apps under one multi-tenant suffix): Safari's tracking prevention blocks
 *     cross-site cookies even with `SameSite=None; Secure`, so route through this app's own
 *     `/api-proxy/*` instead — same-origin from the browser's point of view.
 *
 * Duplicated from apps/api rather than shared (there is no shared package): keep the two lists
 * (MULTI_TENANT_SUFFIXES, TWO_LABEL_TLDS) in sync if either changes.
 */

const MULTI_TENANT_SUFFIXES = [
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
