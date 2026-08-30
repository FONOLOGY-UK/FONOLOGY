import type { Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Session transport: httpOnly, Secure (in production) cookies. Never
 * readable from client-side JS — this is what makes "reload can't bypass a
 * locked till" actually true; there is no client-side token to fake, only a
 * cookie the browser attaches automatically and the server verifies against
 * Supabase Auth on every request.
 *
 * SAMESITE IS ENVIRONMENT-AWARE, AND THAT IS DELIBERATE — READ THIS BEFORE
 * "SIMPLIFYING" IT BACK INTO A CONSTANT.
 *
 * `apps/web` and `apps/api` are two separate deployables, and whether the
 * browser will attach a cookie set by one to a request made to the other
 * depends on whether the two are "same-site" — sharing a registrable
 * domain — which is NOT the same question as sharing a hostname, and is NOT
 * fixed across this app's own environments:
 *
 *   - Local dev: both on `localhost` (different ports). Same-site — a port
 *     difference doesn't affect the SameSite calculation.
 *   - Staging (Render): `fonology-web.onrender.com` calling
 *     `fonology-api.onrender.com`. These are CROSS-site, because
 *     `onrender.com` is itself on the Public Suffix List (Render, like
 *     Heroku/Vercel/GitHub Pages, registers its customer-subdomain suffix
 *     there specifically so that two customers' subdomains are never
 *     treated as one site). Confirmed the hard way: a `SameSite=Lax`
 *     cookie set at staff login was never sent back on the very next
 *     client-side API call, because Lax cookies are only sent on
 *     same-site requests and top-level cross-site navigations — never on
 *     cross-site fetch/XHR, which is exactly what every authenticated call
 *     from `apps/web` to `apps/api` is on this topology.
 *   - Production (planned): `fonology.co.uk` calling `api.fonology.co.uk`.
 *     Same registrable domain (`fonology.co.uk`) — same-site again.
 *
 * A single hardcoded `sameSite: 'lax'` is what caused the staging bug
 * above. Hardcoding `'none'` instead would silently ship that as a
 * permanent CSRF-protection weakening into production, on a system that
 * handles real payments, for no reason once `api.fonology.co.uk` exists —
 * `'lax'` is strictly safer and is what production both wants and, once the
 * `api.fonology.co.uk` DNS is live, will get automatically from the same
 * logic below without any further code change.
 *
 * So: compare the request's own host (the API's real public hostname, as
 * seen by the browser — `req.hostname`, which honours `X-Forwarded-Host`
 * because `trust proxy` is set in server.ts) against `WEB_APP_URL`'s host.
 * Same registrable domain -> 'lax'. Different -> 'none' (which requires
 * `secure: true` — see the assertion below; browsers silently reject a
 * `SameSite=None` cookie sent without `Secure`, which would just be a
 * subtler version of the same bug).
 */

const ACCESS_COOKIE = 'fnl_session';
const REFRESH_COOKIE = 'fnl_refresh';
const STAFF_SESSION_COOKIE = 'fnl_staff_session';

/**
 * Hosting providers that hand out subdomains to unrelated customers and are
 * themselves entered on the Public Suffix List for exactly that reason —
 * two different customers' subdomains here must NEVER be treated as
 * same-site, no matter how few labels apart they look. Extend this list if
 * this app is ever deployed behind another such provider; a plain "last two
 * labels" comparison would get it wrong for all of them, the same way it
 * was wrong for `onrender.com`.
 */
const MULTI_TENANT_SUFFIXES = [
  'onrender.com',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'github.io',
  'pages.dev',
];

/**
 * Second-level ccTLD-style suffixes where the registrable domain needs
 * THREE labels, not two (`fonology.co.uk`, not `co.uk`). A short curated
 * list rather than a full Public Suffix List dependency — deliberate: this
 * app is only ever deployed under a handful of known domains (localhost,
 * onrender.com subdomains, and fonology.co.uk / api.fonology.co.uk today),
 * so a full PSL library would be weight added for cases that can't occur
 * here. Extend this list before deploying under a new one of these.
 */
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

/**
 * The registrable domain ("site", for SameSite purposes) of a hostname —
 * e.g. `api.fonology.co.uk` -> `fonology.co.uk`, `fonology-api.onrender.com`
 * -> `fonology-api.onrender.com` (a multi-tenant suffix means the WHOLE
 * subdomain is the registrable unit, so distinct Render services never
 * match each other), `localhost` -> `localhost`.
 */
function registrableDomain(hostname: string): string {
  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname; // localhost, or already bare

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_TENANT_SUFFIXES.includes(lastTwo) || TWO_LABEL_TLDS.includes(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

function isSameSite(hostA: string, hostB: string): boolean {
  return registrableDomain(hostA) === registrableDomain(hostB);
}

let cachedWebAppHost: string | null = null;
function webAppHost(): string {
  if (cachedWebAppHost === null) {
    cachedWebAppHost = new URL(config.webAppUrl).hostname;
  }
  return cachedWebAppHost;
}

function cookieOpts(req: Request) {
  const sameSite = isSameSite(req.hostname, webAppHost()) ? ('lax' as const) : ('none' as const);
  // `SameSite=None` without `Secure` is silently rejected by browsers — a
  // cookie that looks set but never arrives, which is exactly the bug this
  // whole scheme exists to avoid. `config.isProduction` is true in every
  // deployed environment (staging and production both run with
  // NODE_ENV=production — see render.yaml), so this holds by construction;
  // asserting it rather than trusting that silently is the point.
  if (sameSite === 'none' && !config.isProduction) {
    throw new Error(
      '[cookies] Refusing to set SameSite=None without Secure — cross-site cookies require ' +
        'both. This should be unreachable (cross-site topologies are only ever deployed ' +
        'environments, which are always isProduction); if you are seeing this, something about ' +
        'that invariant just changed.',
    );
  }
  return {
    httpOnly: true,
    secure: sameSite === 'none' ? true : config.isProduction,
    sameSite,
    path: '/',
  };
}

export function setAuthCookies(
  req: Request,
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  const opts = cookieOpts(req);
  res.cookie(ACCESS_COOKIE, accessToken, { ...opts, maxAge: 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...opts, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export function setStaffSessionCookie(req: Request, res: Response, staffSessionId: string): void {
  res.cookie(STAFF_SESSION_COOKIE, staffSessionId, {
    ...cookieOpts(req),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(req: Request, res: Response): void {
  const opts = cookieOpts(req);
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
  res.clearCookie(STAFF_SESSION_COOKIE, opts);
}

export function readCookies(req: { cookies?: Record<string, string> }): {
  accessToken: string | null;
  refreshToken: string | null;
  staffSessionId: string | null;
} {
  const cookies = req.cookies ?? {};
  return {
    accessToken: cookies[ACCESS_COOKIE] ?? null,
    refreshToken: cookies[REFRESH_COOKIE] ?? null,
    staffSessionId: cookies[STAFF_SESSION_COOKIE] ?? null,
  };
}
