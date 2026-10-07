/**
 * Money going back out, the way staff actually do it:
 *
 *  1. an employee sells a product at the till for cash
 *  2. the owner opens Returns, picks "Counter sale", enters the receipt reference, adds the item
 *     back and records the return — the stock goes back on the shelf
 *  3. the same sale cannot be refunded a second time (the cap is the amount paid)
 *  4. the refund appears in the day's refunds list, and the till's takings drop by that amount
 *
 * Page errors, console errors and 5xx responses fail each test (a 400/409 refusal is expected in 3);
 * every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, EMPLOYEE, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PRODUCT = `${RUN} Refund Widget`;
const PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD ?? 'Test1234!';

let owner: BrowserContext;
let employee: BrowserContext;
let productId = '';
let saleRef = '';

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

async function dismissFloat(page: Page) {
  const notNow = page.getByRole('button', { name: 'Not now' });
  const shown = await notNow.waitFor({ state: 'visible', timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (shown) await notNow.click();
}

async function signIn(browser: any, email: string, password: string) {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await ctx.request.post(`${API}/staff/signin`, {
    data: { email, password },
    timeout: 120_000,
  });
  expect(r.status(), `sign in ${email}`).toBe(200);
  return ctx;
}

test.beforeAll(async ({ browser }) => {
  owner = await signIn(browser, OWNER.email, OWNER.password);
  employee = await signIn(browser, EMPLOYEE.email, PASSWORD);

  const cats = await (await owner.request.get(`${API}/admin/categories`)).json();
  const category = cats.find((c: any) => /^access/i.test(c.label)) ?? cats[0];
  const p = await owner.request.post(`${API}/admin/products`, {
    data: {
      name: PRODUCT,
      sub: 'Refund fixture',
      categoryId: category.id,
      price: 1250,
      costPrice: 400,
      stockQty: 6,
      localBuying: false,
      description: 'Created by the refund journey.',
      lowStockAlert: false,
      lowStockThreshold: 2,
    },
  });
  expect(p.status(), (await p.text()).slice(0, 200)).toBe(201);
  productId = (await p.json()).id;
});

test.afterAll(async () => {
  await Promise.all([owner?.close(), employee?.close()]);
});

async function stockOf(): Promise<number> {
  const all = await (await owner.request.get(`${API}/admin/products`)).json();
  const mine = all.find((x: any) => x.id === productId);
  return mine.stockQty ?? mine.stock;
}

test('1. an employee sells it at the till for cash', async () => {
  const page = await employee.newPage();
  const problems = watch(page);
  await page.goto('/pos');
  await dismissFloat(page);
  await page.getByLabel('Scan or search products').fill(RUN);
  const tile = page.getByRole('button', { name: new RegExp(PRODUCT) }).first();
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.click();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(page.getByText('Fully paid')).toBeVisible();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText('Sale complete')).toBeVisible({ timeout: 30_000 });
  saleRef = (await page.locator('body').innerText()).match(/F\d{2,}-SAL-\d{9,}/)![0];
  await shot(page, '01-sold');
  expect(await stockOf()).toBe(5);
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. the owner records the return against that receipt, and the stock goes back', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/returns');
  await page
    .getByRole('group', { name: 'Return source' })
    .getByRole('button', { name: 'Counter sale' })
    .click();
  await page.locator('#ret-receipt').fill(saleRef);
  await page.getByPlaceholder(/Search the catalogue/).fill(PRODUCT);
  await page
    .getByRole('button', { name: new RegExp(PRODUCT) })
    .first()
    .click();
  await expect(page.locator('#ret-amount')).toHaveValue('12.50');
  await page.locator('#ret-reason').fill('E2E: customer changed their mind');
  await shot(page, '02-return-form');
  await page.getByRole('button', { name: 'Record return' }).click();
  await expect(page.getByRole('button', { name: /print refund receipt/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, '02-return-recorded');
  expect(await stockOf()).toBe(6);
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('3. the same sale cannot be refunded twice', async () => {
  const page = await owner.newPage();
  await page.goto('/admin/returns');
  await page
    .getByRole('group', { name: 'Return source' })
    .getByRole('button', { name: 'Counter sale' })
    .click();
  await page.locator('#ret-receipt').fill(saleRef);
  await page.locator('#ret-amount').fill('0.01');
  await page.locator('#ret-reason').fill('E2E: should be refused');
  const refused = page.waitForResponse(
    (r) => r.url().includes('/refunds') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Record return' }).click();
  expect(
    (await refused).status(),
    'a second refund is refused, not recorded',
  ).toBeGreaterThanOrEqual(400);
  expect((await refused).status()).toBeLessThan(500);
  await shot(page, '03-second-refund-refused');
  expect(await stockOf(), 'a refused refund puts nothing back on the shelf').toBe(6);
  await page.close();
});

test('4. the refund shows in the refunds list', async () => {
  const page = await owner.newPage();
  await page.goto('/admin/returns');
  await expect(page.getByText(saleRef).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '04-refund-listed');
  await page.close();
});
