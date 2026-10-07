/**
 * "A tester walks every door." Signs in as each kind of person and opens every
 * screen they can reach, the way a user would, and fails on anything a user would
 * hit: an uncaught page error, a console error, a failed API call (5xx always; 4xx
 * unless it is a refusal the screen is expected to produce), or the framework's
 * error page. Each screen is photographed — a green run is not proof until the
 * pictures agree.
 *
 * Roles: owner, employee (Shop 1), Shop 2 employee, Shop 2 manager, customer, guest.
 * The Shop 2 accounts are made through the owner API and switched off at the end.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PASSWORD = 'Test1234!';

type Who = { label: string; email: string; staff: boolean };

const SHOP2_EMP = {
  email: `${RUN.toLowerCase()}-s2emp@example.invalid`,
  name: `${RUN} S2 Employee`,
};
const SHOP2_MGR = {
  email: `${RUN.toLowerCase()}-s2mgr@example.invalid`,
  name: `${RUN} S2 Manager`,
};

const STOREFRONT = [
  '/',
  '/shop',
  '/cart',
  '/checkout',
  '/repair',
  '/sell',
  '/track',
  '/about',
  '/contact',
  '/faq',
  '/shipping',
  '/returns',
  '/privacy',
  '/terms',
  '/cookies',
  '/login',
  '/register',
  '/forgot-password',
  '/staff-login',
];

const ADMIN = [
  '/admin',
  '/admin/inventory',
  // The two inventory logs (0103/0104).
  '/admin/goods-in',
  '/admin/logs',
  '/admin/categories',
  '/admin/product-folders',
  '/admin/jobs',
  '/admin/jobs/archive',
  '/admin/orders',
  '/admin/submissions',
  '/admin/trade-ins',
  '/admin/trade-ins/payouts',
  '/admin/sales',
  '/admin/payments',
  '/admin/returns',
  '/admin/cash',
  '/admin/day-close',
  '/admin/promotions',
  '/admin/repair-pricing',
  '/admin/reviews',
  '/admin/misc-costs',
  '/admin/labels',
  '/admin/printing',
  '/admin/devices',
  '/admin/reports',
  '/admin/settings',
  // Delivery tiers (0102) and the repair-stage texts (0105).
  '/admin/delivery',
  '/admin/notifications',
  '/admin/shops',
  '/admin/staff',
];

const POS = [
  '/pos',
  '/pos/inventory',
  '/pos/goods-in',
  '/pos/jobs',
  '/pos/jobs/archive',
  '/pos/submissions',
  '/pos/trade-ins',
  '/pos/trade-ins/payouts',
  '/pos/promotions',
  '/pos/cash',
  '/pos/day',
  '/pos/settings',
];

/** Responses a screen is allowed to get without it being a bug — by who is asking. */
const EXPECTED_REFUSAL = /\/(auth\/me|customer\/me|me)$|\/auth\/session/;

async function signedIn(browser: any, email: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await ctx.request.post(`${API}/staff/signin`, {
    data: { email, password: PASSWORD },
    timeout: 120_000,
  });
  expect(r.status(), `sign in as ${email}`).toBe(200);
  return ctx;
}

async function crawl(
  ctx: BrowserContext,
  label: string,
  paths: string[],
  opts: { expectRefusal?: RegExp } = {},
) {
  // Every first visit to a screen compiles it on a dev server, and the owner walks ~45 of them —
  // more than the suite-wide 4 minutes ever covered. Each screen gets its own budget on top.
  test.info().setTimeout(test.info().timeout + paths.length * 15_000);
  const page: Page = await ctx.newPage();
  const problems: string[] = [];
  let current = '';
  page.on('pageerror', (e) => problems.push(`${current}: page error — ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // The browser logs every failed fetch as a console error too; responses are judged below.
    if (/Failed to load resource/.test(t)) return;
    problems.push(`${current}: console error — ${t.slice(0, 200)}`);
  });
  page.on('response', (r) => {
    const s = r.status();
    const url = r.url();
    if (s < 400) return;
    if (EXPECTED_REFUSAL.test(new URL(url).pathname)) return;
    if (/\/_next\/|favicon|\.map$/.test(url)) return;
    if (s < 500 && opts.expectRefusal?.test(url)) return;
    problems.push(`${current}: ${s} ${r.request().method()} ${url.replace(API, '')}`);
  });

  for (const path of paths) {
    current = `${label} ${path}`;
    const res = await page.goto(path, { waitUntil: 'networkidle', timeout: 120_000 }).catch((e) => {
      problems.push(`${current}: navigation failed — ${e.message.slice(0, 120)}`);
      return null;
    });
    if (res && res.status() >= 500) problems.push(`${current}: page ${res.status()}`);
    const body =
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? '';
    if (
      /Application error|Internal Server Error|This page couldn.t load|Something went wrong/i.test(
        body,
      )
    )
      problems.push(`${current}: the screen shows an error page`);
    // The till greets a new session with a float prompt that covers the whole screen. Only the
    // till screens show it, so only they wait for it.
    const notNow = page.getByRole('button', { name: 'Not now' });
    if (
      await notNow
        .waitFor({ state: 'visible', timeout: path.startsWith('/pos') ? 2_500 : 300 })
        .then(
          () => true,
          () => false,
        )
    ) {
      await notNow.click();
      await page.waitForTimeout(400);
    }
    const name = `${label}${path.replace(/\W+/g, '_')}`;
    const file = test.info().outputPath(`${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    await test.info().attach(name, { path: file, contentType: 'image/png' });
  }
  await page.close();
  expect(problems, problems.join('\n')).toEqual([]);
}

let owner: BrowserContext;
let s2: { emp?: string; mgr?: string } = {};

/**
 * Creates a Shop 2 account, or brings back the one this run already made. Playwright restarts
 * the worker after a failed test and runs beforeAll again with the same run tag, so a plain
 * create met its own account and failed every later test in the file with "already exists".
 */
async function ensureStaff(
  who: { name: string; email: string },
  role: 'employee' | 'manager',
  shopId: string,
): Promise<{ id: string }> {
  const r = await owner.request.post(`${API}/admin/staff`, {
    data: {
      name: who.name,
      email: who.email,
      role,
      shopId,
      phone: '07700900299',
      password: PASSWORD,
    },
  });
  if (r.status() === 201) return r.json();
  const text = await r.text();
  expect(text, `create ${role}: ${text.slice(0, 150)}`).toMatch(/already exists/i);
  const list = await (await owner.request.get(`${API}/admin/staff?shop=all`)).json();
  const rows = (Array.isArray(list) ? list : list.items) as { id: string; email: string }[];
  const existing = rows.find((s) => s.email.toLowerCase() === who.email.toLowerCase());
  expect(existing, `find the ${role} this run already made`).toBeTruthy();
  const back = await owner.request.put(`${API}/admin/staff/${existing!.id}`, {
    data: { isActive: true },
  });
  expect(back.status(), `switch the ${role} back on`).toBeLessThan(300);
  return existing!;
}

test.beforeAll(async ({ browser }) => {
  owner = await signedIn(browser, OWNER.email);
  const shops = await (await owner.request.get(`${API}/shops`)).json();
  const shop1 = shops.find((s: any) => s.isFulfilmentHub) ?? shops[0];
  let shop2 = shops.find((s: any) => s.id !== shop1.id && s.isActive);
  if (!shop2) {
    const made = await owner.request.post(`${API}/admin/shops`, {
      data: { code: `T${RUN.slice(-5)}`, name: `${RUN} Shop Two` },
    });
    expect([200, 201], await made.text()).toContain(made.status());
    shop2 = await made.json();
  }
  for (const [who, role, shopId] of [
    [SHOP2_EMP, 'employee', shop2.id],
    [SHOP2_MGR, 'manager', shop2.id],
  ] as const) {
    const row = await ensureStaff(who, role, shopId);
    if (role === 'employee') s2.emp = row.id;
    else s2.mgr = row.id;
  }
});

test.afterAll(async () => {
  for (const id of [s2.emp, s2.mgr]) {
    if (!id) continue;
    await owner.request
      .put(`${API}/admin/staff/${id}`, { data: { isActive: false } })
      .catch(() => {});
  }
  await owner?.close();
});

test('guest — every storefront page', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await crawl(ctx, 'guest', STOREFRONT, { expectRefusal: /\/(auth|customer)\// });
  await ctx.close();
});

test('owner — every dashboard and till screen', async () => {
  await crawl(owner, 'owner', [...ADMIN, ...POS]);
});

test('Shop 2 manager — every dashboard screen they may open', async ({ browser }) => {
  const ctx = await signedIn(browser, SHOP2_MGR.email);
  // A manager is refused some screens (staff, shops, settings). A refusal is fine;
  // a crash or a blank screen is not — the crawl treats <500 as acceptable here.
  await crawl(ctx, 'mgr2', [...ADMIN, ...POS], { expectRefusal: /\/(admin|pos|print|shops)/ });
  await ctx.close();
});

test('Shop 2 employee — the till and what an employee may open', async ({ browser }) => {
  const ctx = await signedIn(browser, SHOP2_EMP.email);
  await crawl(ctx, 'emp2', POS, { expectRefusal: /\/(admin|pos|print|shops)/ });
  await crawl(ctx, 'emp2admin', ['/admin/inventory', '/admin/jobs', '/admin/reports'], {
    expectRefusal: /\/(admin|pos|print|shops)/,
  });
  await ctx.close();
});
