/**
 * Where the suite points, who it signs in as, and the guard that stops it
 * ever touching production.
 *
 * Everything is overridable from the environment. The defaults are the
 * staging deployment and the standing dev-only fixture accounts — the same
 * accounts apps/api/scripts/e2e-test.ts already signs in with. They exist
 * only in the dev database.
 */

export const WEB = (process.env.E2E_WEB_BASE ?? 'https://fonology-web.onrender.com').replace(
  /\/$/,
  '',
);

/**
 * The web app's own same-origin proxy. On Render the web and API services
 * are different SITES (onrender.com is a public suffix), so a browser never
 * talks to the API directly — it goes through /api-proxy, and the auth
 * cookies live on the web origin. Signing in through the proxy leaves them
 * exactly where a real sign-in would.
 */
export const API = `${WEB}/api-proxy`;

/**
 * The API's own public address — used ONLY to wake it, never to test through.
 *
 * Observed on staging: with the API hibernating, twenty requests through
 * /api-proxy over five minutes all got Render's 429 `hibernate-rate-limited`
 * and never woke it; one request straight to the API did, and the proxy
 * answered 200 immediately after. So a sleeping API is woken directly.
 */
export const API_DIRECT = (
  process.env.E2E_API_DIRECT ?? 'https://fonology-api.onrender.com'
).replace(/\/$/, '');

export const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? 'owner@fonology.test',
  password: process.env.E2E_OWNER_PASSWORD ?? 'Test1234!',
};

export const EMPLOYEE = {
  email: process.env.E2E_EMPLOYEE_EMAIL ?? 'staff@fonology.test',
  name: process.env.E2E_EMPLOYEE_NAME ?? 'Test Employee',
  pin: process.env.E2E_EMPLOYEE_PIN ?? '5678',
};

/**
 * Tags every row this run creates, so cleanup can remove exactly those and
 * nothing else. Set once by global-setup and inherited by every worker.
 */
export function runTag(): string {
  const tag = process.env.E2E_RUN;
  if (!tag)
    throw new Error('E2E_RUN is not set — run through `pnpm e2e`, not a bare Playwright call.');
  return tag;
}

/**
 * REFUSES production, deliberately and without an override.
 *
 * This suite creates jobs, sales, products and trade-in requests, changes a
 * card limit, rings a sale through the till and PIN-switches an account —
 * which ENDS that account's session everywhere. None of that belongs in the
 * live shop's records, so there is no flag to allow it.
 */
export function assertNotProduction(): void {
  const host = new URL(WEB).hostname;
  if (/(^|\.)fonology\.co\.uk$/i.test(host)) {
    throw new Error(
      `Refusing to run against ${host}: this suite writes real data and must only ever target staging.`,
    );
  }
}
