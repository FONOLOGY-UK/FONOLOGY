import type { Request, Response } from 'express';
import { config } from '../config.js';
import { SESSION_TTL_MS } from './authSessions.js';

/**
 * Session transport: httpOnly, Secure (in production) cookies. Never readable from client-side JS, so
 * there is no client-side token to fake — only a cookie the browser attaches automatically and the
 * server looks up in `auth_sessions` on every request.
 *
 * SameSite depends on the topology, so it is computed, not a constant. `apps/web` and `apps/api` are
 * separate deployables; the browser attaches a SameSite=Lax cookie only if the two share a registrable
 * domain ("same-site"), which is not the same as sharing a hostname:
 *
 *   - Local dev: both on `localhost` (ports don't matter) — same-site.
 *   - Production: `fonology.co.uk` calling `api.fonology.co.uk` — same-site.
 *   - Any deployment where the two sit under a multi-tenant suffix (e.g. `*.vercel.app`) is cross-site,
 *     and a Lax cookie would never come back on the next fetch.
 *
 * So the request's own host (`req.hostname`, which honours X-Forwarded-Host because `trust proxy` is
 * set in server.ts) is compared with `WEB_APP_URL`'s host: same registrable domain -> 'lax', otherwise
 * 'none'. SameSite=None requires `Secure`, and browsers silently drop it without — see the assertion
 * in cookieOpts().
 */

const SESSION_COOKIE = 'fnl_session';
const STAFF_SESSION_COOKIE = 'fnl_staff_session';

/**
 * Hosting providers that hand out subdomains to unrelated customers and are on the Public Suffix List
 * for exactly that reason: two customers' subdomains here must NEVER be treated as same-site. Extend
 * this list if the app is ever deployed behind another such provider.
 */
const MULTI_TENANT_SUFFIXES = [
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'github.io',
  'pages.dev',
];

/**
 * Second-level ccTLD-style suffixes where the registrable domain needs
 * THREE labels, not two (`fonology.co.uk`, not `co.uk`). A short curated list rather than a full Public
 * Suffix List dependency: the app is only deployed under a few known domains. Extend it before deploying
 * under a new one of these.
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
 * The registrable domain ("site", for SameSite purposes) of a hostname — e.g. `api.fonology.co.uk` ->
 * `fonology.co.uk`; under a multi-tenant suffix the whole subdomain is the unit; `localhost` -> `localhost`.
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
  // SameSite=None without Secure is silently rejected by browsers: a cookie that looks set but never
  // arrives. isProduction is true in every deployed environment (the image sets NODE_ENV=production).
  if (sameSite === 'none' && !config.isProduction) {
    throw new Error(
      '[cookies] Refusing to set SameSite=None without Secure — cross-site cookies need both, and ' +
        'cross-site topologies only exist in deployed (isProduction) environments.',
    );
  }
  return {
    httpOnly: true,
    secure: sameSite === 'none' ? true : config.isProduction,
    sameSite,
    path: '/',
  };
}

export function setSessionCookie(req: Request, res: Response, sessionToken: string): void {
  res.cookie(SESSION_COOKIE, sessionToken, { ...cookieOpts(req), maxAge: SESSION_TTL_MS });
}

export function setStaffSessionCookie(req: Request, res: Response, staffSessionId: string): void {
  res.cookie(STAFF_SESSION_COOKIE, staffSessionId, { ...cookieOpts(req), maxAge: SESSION_TTL_MS });
}

export function clearAuthCookies(req: Request, res: Response): void {
  const opts = cookieOpts(req);
  res.clearCookie(SESSION_COOKIE, opts);
  res.clearCookie(STAFF_SESSION_COOKIE, opts);
}

export function readCookies(req: { cookies?: Record<string, string> }): {
  sessionToken: string | null;
  staffSessionId: string | null;
} {
  const cookies = req.cookies ?? {};
  return {
    sessionToken: cookies[SESSION_COOKIE] ?? null,
    staffSessionId: cookies[STAFF_SESSION_COOKIE] ?? null,
  };
}

/**
 * The Google sign-in round trip's state: the CSRF `state`, the PKCE verifier
 * and where to land afterwards. Always SameSite=Lax, whatever the topology —
 * it only has to survive the top-level redirect back from Google, which Lax
 * cookies do, and it is scoped to the two Google routes.
 */
const OAUTH_COOKIE = 'fnl_oauth';
const OAUTH_COOKIE_PATH = '/auth/google';

export function setOAuthCookie(res: Response, value: string): void {
  res.cookie(OAUTH_COOKIE, value, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: OAUTH_COOKIE_PATH,
    maxAge: 10 * 60 * 1000,
  });
}

export function takeOAuthCookie(req: Request, res: Response): string | null {
  const value = (req.cookies as Record<string, string> | undefined)?.[OAUTH_COOKIE] ?? null;
  res.clearCookie(OAUTH_COOKIE, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: OAUTH_COOKIE_PATH,
  });
  return value;
}
