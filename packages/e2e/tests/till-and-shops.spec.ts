/**
 * The till, and the second shop — as the people who use them.
 *
 *  1. a Shop 1 employee rings up a product at the counter, pays cash
 *  2. stock fell by one, and the sale is in Shop 1's payments
 *  3. a Shop 2 employee's till does NOT show Shop 1's product, and never sees its price/cost/stock
 *  4. the Shop 2 employee adds it from the master list and sees only name/photo/barcode
 *  5. Shop 2's employee cannot see Shop 1's takings
 *
 * Fixtures: one product (named with the run tag) and one Shop 2 employee, made through the
 * owner API and removed / switched off afterwards.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, EMPLOYEE, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PASSWORD = 'Test1234!';
const PRODUCT = `${RUN} Counter Cable`;
const S2_EMP = { email: `${RUN.toLowerCase()}-till2@example.invalid`, name: `${RUN} Till Two` };

let owner: BrowserContext;
let emp1: BrowserContext;
let emp2: BrowserContext;
let productId = '';
let shop2Id = '';
let s2StaffId = '';
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
  // waitFor really waits; isVisible({timeout}) does not.
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

  const shops = await (await owner.request.get(`${API}/shops`)).json();
  const hub = shops.find((s: any) => s.isFulfilmentHub) ?? shops[0];
  let shop2 = shops.find((s: any) => s.id !== hub.id && s.isActive);
  if (!shop2) {
    const made = await owner.request.post(`${API}/admin/shops`, {
      data: { code: `T${RUN.slice(-5)}`, name: `${RUN} Shop Two` },
    });
    shop2 = await made.json();
  }
  shop2Id = shop2.id;

  const cats = await (await owner.request.get(`${API}/admin/categories`)).json();
  const category = cats.find((c: any) => /^access/i.test(c.label)) ?? cats[0];
  const p = await owner.request.post(`${API}/admin/products`, {
    data: {
      name: PRODUCT,
      sub: 'USB-C 1m',
      categoryId: category.id,
      price: 1250,
      costPrice: 400,
      stockQty: 6,
      localBuying: false,
      supplier: 'Test Supplier',
      description: 'Counter fixture.',
      lowStockAlert: false,
      lowStockThreshold: 2,
      onMasterList: true,
    },
  });
  expect(p.status(), (await p.text()).slice(0, 200)).toBe(201);
  productId = (await p.json()).id;

  const e = await owner.request.post(`${API}/admin/staff`, {
    data: {
      name: S2_EMP.name,
      email: S2_EMP.email,
      role: 'employee',
      shopId: shop2Id,
      phone: '07700900298',
      password: PASSWORD,
    },
  });
  expect(e.status(), (await e.text()).slice(0, 200)).toBe(201);
  s2StaffId = (await e.json()).id;

  emp1 = await signIn(browser, EMPLOYEE.email, PASSWORD);
  emp2 = await signIn(browser, S2_EMP.email, PASSWORD);
});

test.afterAll(async () => {
  if (s2StaffId)
    await owner.request
      .put(`${API}/admin/staff/${s2StaffId}`, { data: { isActive: false } })
      .catch(() => {});
  await Promise.all([owner?.close(), emp1?.close(), emp2?.close()]);
});

test('1. Shop 1 employee rings up a product and takes cash', async () => {
  const page = await emp1.newPage();
  const problems = watch(page);
  await page.goto('/pos');
  await dismissFloat(page);
  await page.getByLabel('Scan or search products').fill(RUN);
  const tile = page.getByRole('button', { name: new RegExp(PRODUCT) }).first();
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-till-search');
  await tile.click();
  // A product with options asks which; a plain one goes straight on the ticket.
  await expect(page.getByText('£12.50').first()).toBeVisible();
  await shot(page, '01-ticket');

  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(page.getByText('Fully paid')).toBeVisible();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText('Sale complete')).toBeVisible({ timeout: 30_000 });
  saleRef = (await page.locator('body').innerText()).match(/[A-Z]{2,4}-\d+/)![0];
  await shot(page, '01-sale-complete');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. stock fell by one and the sale shows in Shop 1 payments', async () => {
  const all = await (await owner.request.get(`${API}/admin/products`)).json();
  const mine = all.find((x: any) => x.id === productId);
  expect(mine.stockQty ?? mine.stock).toBe(5);

  const page = await owner.newPage();
  await page.goto('/admin/payments');
  await dismissFloat(page);
  await page
    .getByPlaceholder(/search/i)
    .first()
    .fill(saleRef);
  await expect(page.locator('tr').filter({ hasText: saleRef })).toContainText('£12.50', {
    timeout: 30_000,
  });
  await shot(page, '02-payments');
  await page.close();
});

test('3. a Shop 2 employee’s till has no Shop 1 product, price or stock', async () => {
  const page = await emp2.newPage();
  const problems = watch(page);
  await page.goto('/pos');
  await dismissFloat(page);
  await page.getByLabel('Scan or search products').fill(RUN);
  await page.waitForTimeout(2_500);
  await expect(page.getByRole('button', { name: new RegExp(PRODUCT) })).toHaveCount(0);
  await shot(page, '03-shop2-till');

  // And not by asking the API directly either.
  for (const path of ['/admin/products', '/admin/products?shop=all']) {
    const r = await emp2.request.get(`${API}${path}`);
    expect(await r.text(), path).not.toContain(PRODUCT);
  }
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('4. Shop 2 adds it from the master list and sees no other shop’s money', async () => {
  const page = await emp2.newPage();
  const problems = watch(page);
  await page.goto('/pos/inventory');
  await dismissFloat(page);
  await page.getByRole('button', { name: 'Add from master list' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search the master list').fill(PRODUCT); // the full name: other specs share the run tag
  const row = dialog.locator('li, tr, div').filter({ hasText: PRODUCT }).last();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(page, '04-master-picker');
  // Name, photo and barcode only: none of Shop 1's price (£12.50), cost (£4.00) or stock.
  const text = await dialog.innerText();
  expect(text).not.toContain('12.50');
  expect(text).not.toContain('4.00');
  await dialog.getByRole('button', { name: /^Add/ }).first().click();
  // Adding opens the edit form straight away, with a prompt to set its own price and stock.
  await expect(page.getByText(/added to your shop — set your price and stock/)).toBeVisible({
    timeout: 15_000,
  });
  const edit = page.getByRole('dialog');
  await expect(edit.getByLabel('Name')).toHaveValue(PRODUCT);
  await expect(edit.getByLabel('Stock count')).toHaveValue('0');
  // A counter employee never sees a cost price field.
  await expect(edit.getByLabel('Cost price (£)')).toHaveCount(0);
  await shot(page, '04-shop2-edit');
  // Regression: a fresh copy used to open as a 'local buy-in' and demand a signed form to save.
  await expect(edit.getByRole('checkbox', { name: /Bought locally/ })).not.toBeChecked();
  await edit.getByLabel('Selling price (£)').fill('14.00');
  await edit.getByLabel('Stock count').fill('3');
  await edit.getByLabel('Supplier', { exact: true }).fill('Shop Two Supplies Ltd');
  await edit.getByRole('button', { name: /save/i }).click();
  await expect(edit).toBeHidden({ timeout: 30_000 });
  const mine = page.locator('tr').filter({ hasText: PRODUCT });
  await expect(mine).toContainText('£14');
  await shot(page, '04-after-save');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('4b. Shop 2 sells it at its own price, and Shop 1 is untouched', async () => {
  const page = await emp2.newPage();
  const problems = watch(page);
  await page.goto('/pos');
  await dismissFloat(page);
  await page.getByLabel('Scan or search products').fill(RUN);
  await page
    .getByRole('button', { name: new RegExp(PRODUCT) })
    .first()
    .click();
  await expect(page.getByText(/£14(\.00)?(?!\d)/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText('Sale complete')).toBeVisible({ timeout: 30_000 });
  await shot(page, '04b-shop2-sale');

  // Shop 1 still has 5 and still charges £12.50.
  const all = await (await owner.request.get(`${API}/admin/products`)).json();
  const s1 = all.find((x: any) => x.id === productId);
  expect(s1.stockQty ?? s1.stock).toBe(5);
  expect(s1.price).toBe(1250);
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('5. a Shop 2 employee cannot see Shop 1’s takings, even by asking for all shops', async () => {
  for (const path of [
    '/admin/sales',
    '/admin/sales?shop=all',
    '/admin/payments',
    '/admin/payments?shop=all',
    '/pos/sales',
    '/pos/sales?shop=all',
  ]) {
    const r = await emp2.request.get(`${API}${path}`);
    expect(await r.text(), path).not.toContain(saleRef);
  }
});

/* ---------------------------------------------------------- repair at the till */
test('6. a repair deposit is taken at the till, and the balance later', async () => {
  const page = await emp1.newPage();
  const problems = watch(page);
  const customer = `${RUN} Walk-in`;
  await page.goto('/pos/jobs');
  await dismissFloat(page);
  await page.getByRole('button', { name: 'Add job' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Customer').fill(customer);
  await d.getByLabel('Phone').fill('07700900640');
  await d.getByLabel('Device').fill('iPhone 14 Pro');
  await d.getByLabel(/^Quote/).fill('80');
  await d.getByLabel('Problem').fill('Screen smashed. Test run.');
  await d.getByLabel('Deposit to take (£)').fill('30');
  await shot(page, '06-add-job');
  await d.getByRole('button', { name: 'Add to the bench' }).click();

  // A deposit is taken at the till: the job opens there, pre-priced.
  await expect(page).toHaveURL(/\/pos\?job=.*amount=30/, { timeout: 30_000 });
  await dismissFloat(page);
  await expect(page.getByRole('button', { name: /Take payment · £30/ })).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, '06-till-with-job');
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: /Take payment/ }).click();
  await expect(page.getByText(/still owed on this repair/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/£50(\.00)? still owed/)).toBeVisible();
  await shot(page, '06-deposit-taken');

  // The job now shows what has been paid.
  await page.goto('/pos/jobs');
  // Either is enough — and the board card now shows both (the customer's name
  // was added to it), so the union matches two elements: take the first.
  await expect(
    page.getByText(customer).first().or(page.getByText('iPhone 14 Pro').first()).first(),
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, '06-jobs-after-deposit');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('7. cancelling that job gives the deposit back, out of today’s takings', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  const customer = `${RUN} Walk-in`;
  const listed = await (
    await owner.request.get(`${API}/jobs?search=${encodeURIComponent(customer)}`)
  ).json();
  const job = (Array.isArray(listed) ? listed : (listed.items ?? listed.rows ?? [])).find(
    (j: any) => JSON.stringify(j).includes(customer),
  );
  expect(job, 'the walk-in job from the previous test').toBeTruthy();

  await page.goto('/admin/jobs');
  await dismissFloat(page);
  await page.getByText(job.reference, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Cancel job' }).click();
  const d = page.getByRole('dialog').filter({ hasText: 'Why is it being cancelled?' });
  await d.getByLabel('Why is it being cancelled?').fill('Customer changed their mind. Test run.');
  const refund = d.getByRole('checkbox', { name: /Give back what the customer has paid/ });
  await expect(refund, 'refund is ticked by default').toBeChecked();
  await shot(page, '07-cancel-dialog');
  await d
    .getByRole('button', { name: /cancel job|confirm|move/i })
    .last()
    .click();
  await expect(d).toBeHidden({ timeout: 30_000 });

  // The money went back: a refund row exists for this job, for the £30 deposit.
  await page.goto('/admin/payments');
  await page
    .getByPlaceholder(/search/i)
    .first()
    .fill(job.reference);
  const rows = page
    .locator('tbody tr')
    .filter({ visible: true })
    .filter({ hasText: job.reference });
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const text = (await rows.allInnerTexts()).join(' | ');
  expect(text).toMatch(/Refund/i);
  expect(text).toMatch(/£30/);
  await shot(page, '07-refund-in-payments');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});
