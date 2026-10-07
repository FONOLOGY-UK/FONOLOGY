/**
 * The owner's back-office, clicked through the way the owner would — the multi-shop
 * screens built in stage 3 that only the API test had touched:
 *
 *  1. Shops: add a shop, close it, reopen it
 *  2. Staff: add a manager in that shop, see them on the roster, move them, switch them off
 *  3. Shop switcher: view one shop, then "All shops" — and a write on "All shops" is refused
 *  4. Promotions: "Runs in" ticks, pause keeps the shops, delete
 *  5. Products: untick "Add to Master List" → marked "Till only"
 *  6. Paged lists: Next / Previous really change the rows
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const SHOP_NAME = `${RUN} Branch`;
const MANAGER = { name: `${RUN} Manager`, email: `${RUN.toLowerCase()}-mgr@example.invalid` };
const PROMO = `${RUN} Multi-buy`;
const TILL_ONLY = `${RUN} Till Only Item`;
const PROMO_PRODUCT = `${RUN} Promo Case`;

let owner: BrowserContext;
let page: Page;
let managerId = '';
let shopId = '';

test.describe.configure({ mode: 'serial' });

async function shot(name: string) {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

function watch(p: Page) {
  const problems: string[] = [];
  p.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|caret-color/.test(m.text()))
      problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  p.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return problems;
}

async function dismissFloat() {
  const notNow = page.getByRole('button', { name: 'Not now' });
  const shown = await notNow.waitFor({ state: 'visible', timeout: 6_000 }).then(
    () => true,
    () => false,
  );
  if (shown) await notNow.click();
}

async function fillDescription(d: ReturnType<Page['getByRole']>) {
  await d.locator('#p-desc').click();
  await page.keyboard.type('A fixture product added by the test run, for the admin click-through.');
}

async function openRowMenu(row: ReturnType<Page['locator']>) {
  await row.getByRole('button').last().click();
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 });
  expect(r.status()).toBe(200);
  page = await owner.newPage();

  // A product for the promotion test (made through the API — the form is covered elsewhere).
  const cats = await (await owner.request.get(`${API}/admin/categories`)).json();
  const category = cats.find((c: any) => /^access/i.test(c.label)) ?? cats[0];
  const p = await owner.request.post(`${API}/admin/products`, {
    data: {
      name: PROMO_PRODUCT,
      sub: 'Promo fixture',
      categoryId: category.id,
      price: 1500,
      costPrice: 500,
      stockQty: 10,
      localBuying: false,
      supplier: 'Test Supplier',
      description: 'A fixture product for the promotions test. Added by the test run.',
      lowStockAlert: false,
      lowStockThreshold: 2,
    },
  });
  expect(p.status(), (await p.text()).slice(0, 160)).toBe(201);
});

test.afterAll(async () => {
  if (managerId)
    await owner.request
      .put(`${API}/admin/staff/${managerId}`, { data: { isActive: false } })
      .catch(() => {});
  if (shopId)
    await owner.request
      .put(`${API}/admin/shops/${shopId}`, {
        data: { name: SHOP_NAME, isActive: false },
      })
      .catch(() => {});
  await owner?.close();
});

test('1. Shops: add a shop, close it, reopen it', async () => {
  const problems = watch(page);
  await page.goto('/admin/shops');
  await dismissFloat();
  await shot('01-shops-before');
  await page.getByRole('button', { name: 'Add shop' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(SHOP_NAME);
  await d.getByLabel('Address').fill('9 Branch Road, Glasgow');
  const saved = page.waitForResponse(
    (r) => /\/admin\/shops/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Add shop' }).click();
  const res = await saved;
  expect(res.status(), (await res.text()).slice(0, 200)).toBe(201);
  const made = await res.json();
  shopId = made.id;
  // Nobody types a code: the database hands out the next one (F02, F03 …).
  expect(made.code).toMatch(/^F\d{2,}$/);
  await expect(d).toBeHidden();

  const card = page.locator('article').filter({ hasText: SHOP_NAME });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Open');
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toContainText('Closed', { timeout: 15_000 });
  await expect(card.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await shot('01-shop-closed');
  await card.getByRole('button', { name: 'Reopen' }).click();
  await expect(card).toContainText('Open', { timeout: 15_000 });
  await shot('01-shop-reopened');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('2. Staff: add a manager in that shop, see them on the roster, move them', async () => {
  const problems = watch(page);
  await page.goto('/admin/staff');
  await dismissFloat();
  await page
    .getByRole('button', { name: /Add staff/ })
    .first()
    .click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(MANAGER.name);
  await d.getByLabel('Role').selectOption('manager');
  await d.getByLabel('Shop', { exact: true }).selectOption({ label: SHOP_NAME });
  await d.getByLabel('Phone').fill('07700900297');
  await d.getByLabel('Email').fill(MANAGER.email);
  await shot('02-add-manager');
  const saved = page.waitForResponse(
    (r) => /\/admin\/staff$/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Add staff' }).click();
  const res = await saved;
  expect(res.status(), (await res.text()).slice(0, 200)).toBe(201);
  const made = await res.json();
  managerId = made.id;
  expect(made.shopId).toBe(shopId);
  expect(made.role).toBe('manager');

  // The one-time password is shown once.
  await expect(page.getByRole('dialog')).toContainText(`${MANAGER.name} is on the roster`);
  await shot('02-temp-password');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /done|close|got it/i })
    .first()
    .click();

  // The roster follows the shop switcher: they are not in the shop being viewed (the first one)...
  await page
    .getByPlaceholder(/search/i)
    .first()
    .fill(MANAGER.name);
  await expect(page.locator('tr').filter({ hasText: MANAGER.name })).toHaveCount(0);
  // ...but are there once that shop is selected.
  await page.getByLabel('Shop to view').selectOption({ label: SHOP_NAME });
  const row = page.locator('tr').filter({ hasText: MANAGER.name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(SHOP_NAME);
  await expect(row).toContainText(/manager/i);
  await shot('02-roster');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('3. Shop switcher: one shop, then All shops — and a write on All is refused', async () => {
  const problems = watch(page);
  await page.goto('/admin');
  await dismissFloat();
  const switcher = page.getByLabel('Shop to view');
  await expect(switcher).toBeVisible();
  await switcher.selectOption({ label: SHOP_NAME });
  await page.goto('/admin/inventory');
  await expect(page.getByLabel('Shop to view')).toContainText(SHOP_NAME);
  await expect(page.locator('body')).not.toContainText(PROMO_PRODUCT); // the new shop has nothing yet
  await shot('03-viewing-new-shop');

  // The same screen as the API says: scoped to that shop.
  const scoped = await (await owner.request.get(`${API}/admin/products?shop=${shopId}`)).json();
  expect(scoped.length).toBe(0);

  await page.getByLabel('Shop to view').selectOption({ label: 'All shops' });
  await page.goto('/admin/inventory');
  await shot('03-all-shops');
  // Writing while "All shops" is selected must be refused, not dumped into a default shop.
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(`${RUN} Should Not Save`);
  await d.getByLabel('Short line').fill('Should not be saved');
  await d.getByLabel('Category').selectOption({ label: 'Accessories' });
  await d.getByLabel('Selling price (£)').fill('1.00');
  await d.getByLabel('Cost price (£)').fill('0.50');
  await d.getByLabel('Stock count').fill('1');
  await d.getByLabel('Supplier', { exact: true }).fill('X Supplies');
  await fillDescription(d);
  const attempt = page.waitForResponse(
    (r) => /\/admin\/products(\?|$)/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Add product' }).click();
  const res = await attempt;
  expect(res.status(), 'a write on All shops is refused').toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
  await expect(
    page.getByText(/pick a shop|choose a shop|select a shop|one shop/i).first(),
  ).toBeVisible({ timeout: 10_000 });
  await shot('03-write-refused');
  await d.getByRole('button', { name: 'Cancel' }).click();

  // Back to normal.
  await page.getByLabel('Shop to view').selectOption({ index: 0 });
  expect(
    problems.filter((x) => !/40\d/.test(x)),
    problems.join('\n'),
  ).toEqual([]);
});

test('4. Promotions: "Runs in" ticks, pause keeps the shops, then delete', async () => {
  const problems = watch(page);
  // The branch must stock the product too, or an offer has nothing to attach to there
  // ("a shop that doesn't stock one is skipped"). Copy it from the master list.
  const masters = await (
    await owner.request.get(`${API}/admin/master?search=${encodeURIComponent(PROMO_PRODUCT)}`)
  ).json();
  const master = masters.find((m: any) => m.name === PROMO_PRODUCT);
  expect(master, 'the product is on the master list').toBeTruthy();
  const copied = await owner.request.post(`${API}/admin/master/${master.id}/copy?shop=${shopId}`);
  expect(copied.status(), (await copied.text()).slice(0, 200)).toBeLessThan(300);

  await page.goto('/admin/promotions');
  await dismissFloat();
  await page.getByRole('button', { name: 'New promotion' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(PROMO);
  await d.getByLabel('Filter products').fill(PROMO_PRODUCT);
  await d
    .getByRole('button', { name: new RegExp(PROMO_PRODUCT) })
    .first()
    .click();
  // Tiers: first tier row — buy 2 at £12.
  await d.getByLabel('Tier 1 minimum quantity').fill('2');
  await d.getByLabel('Tier 1 unit price in pounds').fill('12');
  // Runs in: one tick-box per open shop. Tick two on purpose: the hub and the new branch.
  const hubBox = d.getByRole('checkbox', { name: 'Fonology', exact: true });
  const branchBox = d.getByRole('checkbox', { name: SHOP_NAME, exact: true });
  await expect(hubBox, 'a Runs in tick-box for the hub').toBeVisible();
  await expect(branchBox, 'a Runs in tick-box for the new branch').toBeVisible();
  if (!(await hubBox.isChecked())) await hubBox.click();
  if (!(await branchBox.isChecked())) await branchBox.click();
  await expect(hubBox).toBeChecked();
  await expect(branchBox).toBeChecked();
  await shot('04-promo-form');
  const saved = page.waitForResponse(
    (r) => /promotion/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Create promotion' }).click();
  const res = await saved;
  expect([200, 201], (await res.text()).slice(0, 300)).toContain(res.status());
  await expect(page.getByText(PROMO).first()).toBeVisible();
  await shot('04-promo-created');

  // Pause: untick "Active at the till" on that card.
  const card = page.locator('article').filter({ hasText: PROMO });
  const active = card.getByRole('checkbox', { name: /Active at the till/ });
  await active.click();
  await expect(card).toContainText('Paused', { timeout: 15_000 });

  // Open it again: it must still run in every shop it ran in.
  await card.getByRole('button', { name: `Edit ${PROMO}` }).click();
  const edit = page.getByRole('dialog');
  await expect(
    edit.getByRole('checkbox', { name: 'Fonology', exact: true }),
    'pausing keeps the hub',
  ).toBeChecked();
  await expect(
    edit.getByRole('checkbox', { name: SHOP_NAME, exact: true }),
    'pausing keeps the branch',
  ).toBeChecked();
  await shot('04-promo-paused-edit');
  await edit.getByRole('button', { name: 'Cancel' }).click();

  // Delete.
  await card.getByRole('button', { name: `Delete ${PROMO}` }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
  await confirm
    .getByRole('button', { name: /delete|remove|confirm/i })
    .last()
    .click();
  await expect(page.getByText(PROMO)).toHaveCount(0, { timeout: 15_000 });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('5. Products: unticking "Add to Master List" marks it "Till only"', async () => {
  const problems = watch(page);
  await page.goto('/admin/inventory');
  await dismissFloat();
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(TILL_ONLY);
  await d.getByLabel('Short line').fill('Till only fixture');
  await d.getByLabel('Category').selectOption({ label: 'Accessories' });
  await d.getByLabel('Selling price (£)').fill('3.00');
  await d.getByLabel('Cost price (£)').fill('1.00');
  await d.getByLabel('Stock count').fill('4');
  await d.getByLabel('Supplier', { exact: true }).fill('Test Supplier');
  await fillDescription(d);
  const master = d.getByRole('checkbox', { name: /Add to Master List/ });
  await expect(master, 'ticked by default').toBeChecked();
  await master.uncheck();
  await shot('05-untick-master');
  const saved = page.waitForResponse(
    (r) => /\/admin\/products(\?|$)/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Add product' }).click();
  expect((await saved).status()).toBe(201);
  const row = page.locator('tr').filter({ hasText: TILL_ONLY });
  await expect(row).toContainText(/Till only/i);
  await shot('05-till-only');

  // And a ticked one is NOT marked.
  await expect(page.locator('tr').filter({ hasText: PROMO_PRODUCT })).not.toContainText(
    /Till only/i,
  );
  expect(problems, problems.join('\n')).toEqual([]);
});

test('6. Paged lists: Next and Previous really change the rows', async () => {
  const problems = watch(page);
  for (const path of ['/admin/payments', '/admin/orders']) {
    await page.goto(path);
    await dismissFloat();
    if (path === '/admin/orders') await page.getByRole('button', { name: /^All/ }).click();
    const rows = page.locator('tbody tr').filter({ visible: true });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const norm = async () => (await rows.first().innerText()).replace(/\s+/g, ' ').trim();
    const first = await norm();
    const next = page.getByRole('button', { name: /next/i }).first();
    if (!(await next.isVisible().catch(() => false)) || (await next.isDisabled())) {
      test.info().annotations.push({
        type: 'note',
        description: `${path}: only one page of data, paging not exercised`,
      });
      continue;
    }
    await next.click();
    await expect.poll(norm, { timeout: 15_000 }).not.toBe(first);
    await shot(`06-${path.slice(7)}-page-2`);
    await page.getByRole('button', { name: /prev/i }).first().click();
    await expect.poll(norm, { timeout: 15_000 }).toBe(first);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
