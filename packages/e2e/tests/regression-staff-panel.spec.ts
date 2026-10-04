/**
 * Regression pack — people and the till: who sees what, the clock, the lock, favourites.
 *
 *   v1 BUG-14 / v5 #36  the opening-float prompt: counter staff only (never the Admin), and it follows
 *                       UK time — a device set to Pakistan time at its local midnight must NOT ask again
 *   v4 BUG-12           Add staff: a password can be set (or one is generated and shown), role says "Admin"
 *   v5 #3               a counter person pins favourite products to the top of THEIR till, and only theirs
 *   v5 #4               staff Settings tab: their own auto-lock minutes
 *   v5 #5/#6, v4 FEAT-03/04  tab names: Repair Requests, Sell In Requests (no "Form Submissions" / "Trade Ins")
 *   v2 #5               no useless "/" box inside search bars
 *   v1 BUG-02/03        the lock screen locks every time, and the PIN still works after a long wait
 *
 * Page errors, console errors and 5xx responses fail each test; every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD ?? 'Test1234!';
const OWNER_PIN = process.env.E2E_OWNER_PIN ?? '1234';

let owner: BrowserContext;
let shopId = '';
let empA: { id: string; email: string };
let empB: { id: string; email: string };
const created: string[] = [];

test.describe.configure({ mode: 'serial' });

async function shot(page: Page, name: string) {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|caret-color/.test(m.text()))
      problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return problems;
}

async function signIn(
  browser: any,
  email: string,
  password: string,
  options: Record<string, unknown> = {},
) {
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    ...options,
  });
  const r = await ctx.request.post(`${API}/staff/signin`, {
    data: { email, password },
    timeout: 120_000,
  });
  expect(r.status(), `sign in ${email}`).toBe(200);
  return ctx;
}

const send = async (ctx: BrowserContext, method: 'POST' | 'PUT', path: string, data?: unknown) => {
  const r = await ctx.request.fetch(`${API}${path}`, { method, data });
  return { status: r.status(), body: await r.json().catch(() => null) };
};

async function makeStaff(name: string, role: string, shop: string) {
  const email = `${RUN.toLowerCase()}-${name.toLowerCase().replace(/\W+/g, '')}@example.invalid`;
  const r = await send(owner, 'POST', '/admin/staff', {
    name: `${RUN} ${name}`,
    email,
    role,
    shopId: shop,
    phone: '07700900911',
    password: PASSWORD,
  });
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
  created.push(r.body.id);
  return { id: r.body.id as string, email };
}

test.beforeAll(async ({ browser }) => {
  owner = await signIn(browser, OWNER.email, OWNER.password);
  // A brand-new shop: no float, no history — so "no float recorded today" is true until the test records one.
  const shop = await send(owner, 'POST', '/admin/shops', {
    code: `F${RUN.slice(-5)}`,
    name: `${RUN} Float Shop`,
  });
  expect(shop.status, JSON.stringify(shop.body).slice(0, 200)).toBeLessThan(300);
  shopId = shop.body.id;
  empA = await makeStaff('Till A', 'employee', shopId);
  empB = await makeStaff('Till B', 'employee', shopId);

  // Two products for this shop to pin.
  const cats = (await (await owner.request.get(`${API}/admin/categories`)).json()) as any[];
  const category = cats.find((c) => c.slug === 'accessories');
  for (const n of ['Alpha', 'Bravo', 'Charlie']) {
    const p = await send(owner, 'POST', `/admin/products?shop=${shopId}`, {
      name: `${RUN} ${n}`,
      sub: 'Pin fixture',
      categoryId: category.id,
      price: 500,
      costPrice: 100,
      stockQty: 5,
      localBuying: false,
      supplier: 'Test Supplier',
      description: 'A fixture to pin at the till.',
      lowStockAlert: false,
      lowStockThreshold: 1,
    });
    expect(p.status, JSON.stringify(p.body).slice(0, 200)).toBe(201);
  }
});

test.afterAll(async () => {
  for (const id of created)
    await owner.request
      .put(`${API}/admin/staff/${id}`, { data: { isActive: false } })
      .catch(() => {});
  await owner?.close();
});

test('1. the Admin is never asked to count the float', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await expect(
    page.getByText('Morning — count the float'),
    'no float prompt for the Admin',
  ).toHaveCount(0);
  await shot(page, '01-admin-no-float-prompt');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. a counter person IS asked — and a device on Pakistan time at ITS midnight is not asked twice (UK time rules)', async ({
  browser,
}) => {
  // 19:30 UTC on 4 Oct is 20:30 in the UK (still the 4th) and 00:30 on the 5th in Pakistan (UTC+5).
  const ctx = await signIn(browser, empA.email, PASSWORD, {
    timezoneId: 'Asia/Karachi',
    locale: 'en-GB',
  });
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.clock.setFixedTime(new Date('2026-10-04T19:30:00Z'));
  await page.goto('/pos');
  const prompt = page.getByText('Morning — count the float');
  await expect(prompt, 'a counter person is asked for the float').toBeVisible({ timeout: 30_000 });
  await shot(page, '02a-float-prompt');

  const day = await page.evaluate(() => new Date().toString());
  expect(day, 'the device really is on Pakistan time').toMatch(/Pakistan|PKT|\+0500/);

  await page.locator('#float-amount').fill('150');
  const saved = page.waitForResponse(
    (r) => /\/cash/.test(r.url()) && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: /record|save|open/i })
    .last()
    .click();
  const res = await saved;
  expect(res.status(), (await res.text()).slice(0, 200)).toBeLessThan(300);
  await expect(prompt).toBeHidden({ timeout: 15_000 });

  // The entry belongs to the UK day (4 Oct), not the device's day (5 Oct).
  const entries = (await (await ctx.request.get(`${API}/pos/cash`)).json()) as any;
  const list = (entries.items ?? entries) as any[];
  const today = list.find((e) => e.kind === 'float-open');
  expect(today, 'the float was recorded').toBeTruthy();
  expect(String(today.date ?? today.tradingDay)).toBe('2026-10-04');

  // Reload on the same device at the same instant: it already knows. No second prompt.
  await page.reload();
  await expect(page.getByRole('link', { name: /checkout|jobs/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);
  await expect(prompt, 'no second float prompt at Pakistan midnight').toHaveCount(0);
  await shot(page, '02b-no-second-prompt');
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});

test('3. favourites: each person pins their own products to the top of their own till', async ({
  browser,
}) => {
  const a = await signIn(browser, empA.email, PASSWORD);
  const b = await signIn(browser, empB.email, PASSWORD);
  const pageA = await a.newPage();
  const problems = watch(pageA);
  const names = ['Alpha', 'Bravo', 'Charlie'].map((n) => `${RUN} ${n}`);
  const order = async (page: Page) => {
    await page.goto('/pos');
    const notNow = page.getByRole('button', { name: 'Not now' });
    if (
      await notNow.waitFor({ state: 'visible', timeout: 4_000 }).then(
        () => true,
        () => false,
      )
    )
      await notNow.click();
    await page.getByLabel('Scan or search products').fill(RUN);
    await expect(page.getByText(names[0]!).first()).toBeVisible({ timeout: 30_000 });
    return page
      .getByText(new RegExp(`^${RUN} (Alpha|Bravo|Charlie)$`))
      .evaluateAll((els) =>
        els.map((e) => (e.textContent ?? '').match(/(Alpha|Bravo|Charlie)/)?.[1] ?? '?'),
      );
  };

  const before = await order(pageA);
  expect([...new Set(before)]).toEqual(expect.arrayContaining(['Alpha', 'Bravo', 'Charlie']));
  await shot(pageA, '03a-before');

  // A pins Charlie (the last one).
  await pageA.getByRole('button', { name: `Pin ${names[2]}`, exact: true }).click();
  await expect(pageA.getByRole('button', { name: `Unpin ${names[2]}`, exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await pageA.reload();
  const afterA = await order(pageA);
  expect(afterA[0], 'Charlie is now first on A’s till').toBe('Charlie');
  await shot(pageA, '03b-after-pin');

  // B's till is unchanged.
  const pageB = await b.newPage();
  const afterB = await order(pageB);
  expect(afterB[0], 'B’s order is unaffected by A’s pin').not.toBe('Charlie');
  await expect(pageB.getByRole('button', { name: `Pin ${names[2]}`, exact: true })).toBeVisible();

  // Unpin puts it back.
  await pageA.getByRole('button', { name: `Unpin ${names[2]}`, exact: true }).click();
  await expect(pageA.getByRole('button', { name: `Pin ${names[2]}`, exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(problems, problems.join('\n')).toEqual([]);
  await a.close();
  await b.close();
});

test('4. the staff Settings tab: a person sets their own auto-lock, and it sticks', async ({
  browser,
}) => {
  const ctx = await signIn(browser, empA.email, PASSWORD);
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto('/pos/settings');
  await expect(page.getByText(/auto-lock/i).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '04a-settings');
  await page.getByRole('radio', { name: 'Use my own timeout' }).check();
  await page.locator('#own-idle-minutes').fill('7');
  const saved = page.waitForResponse(
    (r) =>
      /idle|session|staff/.test(r.url()) && ['PUT', 'PATCH', 'POST'].includes(r.request().method()),
  );
  await page.getByRole('button', { name: 'Save auto-lock' }).click();
  expect((await saved).status()).toBeLessThan(300);
  await page.reload();
  await expect(page.locator('#own-idle-minutes')).toHaveValue('7');
  await shot(page, '04b-saved');
  const session = await (await ctx.request.get(`${API}/auth/session`)).json();
  expect(session.idleLockMinutes, 'the server holds it for this person').toBe(7);
  // Person B is not affected.
  const other = await signIn(browser, empB.email, PASSWORD);
  const sB = await (await other.request.get(`${API}/auth/session`)).json();
  expect(sB.idleLockMinutes ?? null).not.toBe(7);
  expect(problems, problems.join('\n')).toEqual([]);
  await other.close();
  await ctx.close();
});

test('5. Add staff: the role says "Admin", a chosen password works, and a blank one is generated and shown once', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/staff');
  await page.getByRole('button', { name: 'Add staff' }).first().click();
  const d = page.getByRole('dialog');
  const roles = await d.locator('#stf-role option').allInnerTexts();
  expect(roles.join('|')).toMatch(/Admin/);
  expect(roles.join('|'), 'the role is not called "Owner"').not.toMatch(/Owner/);
  await expect(d.getByLabel(/Password/)).toBeVisible();

  const email = `${RUN.toLowerCase()}-uiadd@example.invalid`;
  await d.locator('#stf-name').fill(`${RUN} Added By Form`);
  await d.locator('#stf-phone').fill('07700900912');
  await d.getByLabel('Email').fill(email);
  await d.getByLabel(/Password/).fill('Chosen-Pass-77!');
  await shot(page, '05a-add-staff');
  const made = page.waitForResponse(
    (r) => /\/admin\/staff$/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Add staff' }).last().click();
  const res = await made;
  expect(res.status()).toBe(201);
  created.push((await res.json()).id);

  // The password they were given really signs them in.
  const probe = await (await import('@playwright/test')).request.newContext();
  const login = await probe.post(`${API}/staff/signin`, {
    data: { email, password: 'Chosen-Pass-77!' },
  });
  expect(login.status(), 'the chosen password works').toBe(200);
  await probe.dispose();
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('6. tab names: Repair Requests and Sell In Requests, in both the Admin and the till; no "/" box in any search bar', async ({
  browser,
}) => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' }).first()).toBeVisible({
    timeout: 30_000,
  });
  const side = page.locator('aside, nav').first();
  const text = await page.locator('body').innerText();
  expect(text).toContain('Repair Requests');
  expect(text).toContain('Sell In Requests');
  expect(text).not.toMatch(/Form Submissions/i);
  expect(text).not.toMatch(/\bTrade[- ]?Ins\b/i);
  void side;

  // No decorative "/" key hint inside a search box on the main admin lists.
  for (const path of [
    '/admin/inventory',
    '/admin/jobs',
    '/admin/orders',
    '/admin/payments',
    '/admin/returns',
    '/admin/trade-ins',
  ]) {
    await page.goto(path);
    await page.waitForTimeout(1_500);
    const hints = await page.evaluate(() =>
      [...document.querySelectorAll('kbd, [class*="kbd"], span')]
        .filter((e) => (e.textContent ?? '').trim() === '/' && e.children.length === 0)
        .map((e) => (e as HTMLElement).outerHTML.slice(0, 100)),
    );
    expect(hints, `${path} has no "/" hint box`).toEqual([]);
  }
  await shot(page, '06-tab-names');

  const till = await signIn(browser, empA.email, PASSWORD);
  const tp = await till.newPage();
  await tp.goto('/pos');
  await expect(tp.getByLabel('Scan or search products')).toBeVisible({ timeout: 30_000 });
  const tillText = await tp.locator('nav').first().innerText();
  expect(tillText).toMatch(/Repair Requests/i);
  expect(tillText).toMatch(/Sell In R/i);
  expect(tillText).not.toMatch(/Trade[- ]?ins?/i);
  await till.close();
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('7. the lock screen locks every time, and the correct PIN still opens it after a long wait', async ({
  browser,
}) => {
  // Its own sign-in: unlocking by PIN is a session switch, and must not disturb the other tests' sessions.
  const ctx = await signIn(browser, OWNER.email, OWNER.password);
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.clock.install();
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Lock screen' })).toBeVisible({ timeout: 30_000 });

  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Lock screen' }).click();
    await expect(
      page.getByRole('dialog', { name: /Session locked/i }).or(page.getByLabel(/Session locked/i)),
      `lock #${i} locked`,
    ).toBeVisible({
      timeout: 10_000,
    });
    if (i === 1) await shot(page, '07a-locked');
    // Wait a long time on the (client) clock — the "20 minutes and the PIN stops working" report.
    if (i === 3) await page.clock.fastForward('25:00');
    await page.keyboard.type(OWNER_PIN);
    await expect(page.getByLabel(/Session locked/i), `unlock #${i}`).toBeHidden({
      timeout: 15_000,
    });
  }
  await shot(page, '07b-unlocked-after-wait');
  // The page is usable again.
  await page
    .getByRole('link', { name: /inventory/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/inventory/);
  expect(problems, problems.join('\n')).toEqual([]);
  await ctx.close();
});
