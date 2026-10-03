/**
 * Where the suite points, who it signs in as, and the guard that stops it
 * ever touching the live shop by accident.
 *
 * Everything is overridable from the environment. The defaults are the local
 * stack (web :3000, API :4000) and the standing test accounts from
 * apps/api/scripts/seed-dev.ts — the same ones apps/api/scripts/e2e-test.ts
 * signs in with.
 */

export const WEB = (process.env.E2E_WEB_BASE ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * The API, called directly — the way the browser calls it. Locally and in
 * production (fonology.co.uk → api.fonology.co.uk) web and API are the same
 * SITE, so the web app's /api-proxy route is not in the path and the session
 * cookie lives on the API's host. (The proxy existed for the Render staging
 * site, where onrender.com made the two cross-site.)
 */
export const API = (process.env.E2E_API_BASE ?? 'http://localhost:4000').replace(/\/$/, '');

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
 * REFUSES the live shop — unless ALLOW_TEST_WRITES=true says it has not
 * opened yet.
 *
 * This suite creates jobs, sales, products and trade-in requests, changes a
 * card limit, rings a sale through the till and PIN-switches an account —
 * which ENDS that account's session everywhere. None of that belongs in the
 * live shop's records. Before opening day, though, the live server is the
 * only place left to prove it on, so the same switch that lets the server
 * accept test writes (apps/api config) lets this run there. It is removed on
 * opening day, and from then on this refuses with no override.
 */
export function assertNotProduction(): void {
  const host = new URL(WEB).hostname;
  if (/(^|\.)fonology\.co\.uk$/i.test(host) && process.env.ALLOW_TEST_WRITES !== 'true') {
    throw new Error(
      `Refusing to run against ${host}: this suite writes real data. Only before opening, with ALLOW_TEST_WRITES=true.`,
    );
  }
}
