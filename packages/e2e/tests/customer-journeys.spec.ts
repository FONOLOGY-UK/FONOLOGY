/**
 * The shop's life, in the order a real day goes — one serial file, one shared product.
 *
 *  1. the owner ADDS a product through the admin form (not the API)
 *  2. the owner EDITS it (price change) and sees the table update
 *  3. a guest finds it in the shop, adds it to the bag, changes quantity, checks out
 *  4. the owner sees the order in Online orders
 *  5. a guest cannot buy a vape online
 *
 * Locators are the ones a person uses — roles, labels, visible text. Page errors,
 * console errors and 5xx responses fail the test (watch()). Every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { API, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PRODUCT = `${RUN} Aegis Case`;
let owner: BrowserContext;
let ownerPage: Page;
let slug = '';
let orderRef = '';

test.describe.configure({ mode: 'serial' });

async function shot(page: Page, name: string) {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

/** Collects what a user would feel: page errors, console errors, 5xx. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|caret-color/.test(m.text()))
      problems.push(`console: ${m.text().slice(0, 200)}`);
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

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 });
  expect(r.status()).toBe(200);
  ownerPage = await owner.newPage();
});
test.afterAll(async () => owner?.close());

test('1. owner adds a product through the form', async () => {
  const problems = watch(ownerPage);
  await ownerPage.goto('/admin/inventory');
  await dismissFloat(ownerPage);
  await ownerPage.getByRole('button', { name: 'Add product' }).click();
  const dialog = ownerPage.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Name').fill(PRODUCT);
  await dialog.getByLabel('Short line').fill('iPhone 15 / 15 Pro');
  await dialog.getByLabel('Category').selectOption({ label: 'Accessories' });
  await dialog.getByLabel('Selling price (£)').fill('19.99');
  await dialog.getByLabel('Cost price (£)').fill('6.50');
  await dialog.getByLabel('Stock count').fill('8');
  await dialog.getByLabel('Supplier', { exact: true }).fill('Northline Trade Ltd');
  await dialog
    .getByText('What goes on the product page.')
    .or(dialog.locator('#p-desc'))
    .first()
    .click();
  await ownerPage.keyboard.type('A tough case. Added by the test run.');
  await shot(ownerPage, '01-add-product-filled');

  const saved = ownerPage.waitForResponse(
    (r) => r.url().includes('/admin/products') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await dialog.getByRole('button', { name: 'Add product' }).click();
  const res = await saved.catch(async (e) => {
    // No request went out: the form refused. Say what it told the user.
    const alerts = await dialog.getByRole('alert').allInnerTexts();
    await shot(ownerPage, '01-form-refused');
    throw new Error(`form did not submit. Visible errors: ${JSON.stringify(alerts)}`);
  });
  expect(res.status(), (await res.text()).slice(0, 200)).toBe(201);
  slug = (await res.json()).slug;
  expect(slug).toBeTruthy();

  await expect(dialog).toBeHidden();
  const row = ownerPage.locator('tr').filter({ hasText: PRODUCT });
  await expect(row).toBeVisible();
  await expect(row).toContainText('£19.99');
  await expect(row).toContainText('8');
  await shot(ownerPage, '01-product-in-table');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('2. owner edits the price and the table follows', async () => {
  await ownerPage.goto('/admin/inventory');
  const row = ownerPage.locator('tr').filter({ hasText: PRODUCT });
  await row.getByRole('button').last().click();
  await ownerPage.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = ownerPage.getByRole('dialog');
  // What the form opens with must be what was saved — the IMEI bug class.
  await expect(dialog.getByLabel('Name')).toHaveValue(PRODUCT);
  await expect(dialog.getByLabel('Selling price (£)')).toHaveValue('19.99');
  await expect(dialog.getByLabel('Stock count')).toHaveValue('8');
  await dialog.getByLabel('Selling price (£)').fill('17.49');
  await shot(ownerPage, '02-edit-product');
  await dialog.getByRole('button', { name: /save/i }).click();
  await expect(dialog).toBeHidden();
  await expect(ownerPage.locator('tr').filter({ hasText: PRODUCT })).toContainText('£17.49');
});

test('3. a guest finds it, bags it, and checks out as far as the card form', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/shop');
  await page.getByPlaceholder('Search products…').fill(RUN);
  const card = page.locator(`a[href="/shop/${slug}"]`).first();
  await expect(card).toBeVisible();
  await shot(page, '03-shop-search');
  await card.click();
  await expect(page.getByRole('heading', { name: PRODUCT })).toBeVisible();
  await expect(page.getByText('£17.49').first()).toBeVisible();
  // A customer must never see stock counts.
  await expect(page.locator('body')).not.toContainText(/\b8 (in stock|left)\b/i);

  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: 'Add to bag' }).first().click();

  await expect(page.getByText('added to your bag').first()).toBeVisible();
  await page.getByRole('button', { name: /^bag/i }).first().click();
  const bag = page.getByRole('complementary', { name: 'Shopping bag' });
  await expect(bag).toBeVisible();
  await expect(bag).toContainText(PRODUCT);
  await expect(bag).toContainText('£34.98');
  await shot(page, '03-bag');
  await bag
    .getByRole('link', { name: /checkout/i })
    .or(bag.getByRole('button', { name: /checkout/i }))
    .first()
    .click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.getByLabel('Email').fill(`${RUN.toLowerCase()}@example.invalid`);
  await page.getByLabel('First name').fill('Pat');
  await page.getByLabel('Last name').fill(`${RUN} Tester`);
  await page.getByLabel('Phone').fill('07700900611');
  const address = page.getByPlaceholder('4 Cherry Lane, Yourtown');
  if (await address.isVisible().catch(() => false)) {
    await address.fill('1 Test Street');
    await page.getByPlaceholder('YT1 2AB').fill('G46 7AA');
  }
  await shot(page, '03-checkout-details');
  await page.getByRole('button', { name: 'Continue' }).first().click();
  await page.waitForTimeout(8_000); // Stripe's frame keeps the network busy, so 'idle' never comes
  await shot(page, '03-checkout-payment-step');

  // Pay with Stripe's published TEST card (the local API runs on a test key).
  let cardFrame: import('@playwright/test').Frame | null = null;
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    if (
      await f
        .getByPlaceholder('1234 1234 1234 1234')
        .isVisible()
        .catch(() => false)
    ) {
      cardFrame = f;
      break;
    }
  }
  expect(cardFrame, 'the card form is on screen').not.toBeNull();
  await cardFrame!.getByPlaceholder('1234 1234 1234 1234').fill('4242424242424242');
  await cardFrame!.getByPlaceholder('MM / YY').fill('1234');
  await cardFrame!.getByPlaceholder('CVC').fill('123');
  await shot(page, '03-card-filled');
  await page.getByRole('button', { name: /^Pay £/ }).click();
  await expect(page).toHaveURL(/\/checkout\/confirmation/, { timeout: 90_000 });
  await page.waitForTimeout(3_000);
  // Bug report v1, BUG-002: until the payment has landed the page must not claim it has.
  await expect(page.getByRole('heading', { name: /Confirming your payment/ })).toBeVisible();
  await expect(page.getByText(/emailed your confirmation/)).toHaveCount(0);
  await shot(page, '03-confirmation-waiting');
  orderRef = (await page.locator('body').innerText()).match(/FNL-\d+/)![0];

  // Locally nothing delivers Stripe's webhook; send the signed one Stripe would.
  execFileSync(
    'pnpm',
    ['--filter', '@fonology/api', 'exec', 'tsx', 'scripts/simulate-stripe-paid.ts', orderRef],
    { stdio: 'inherit', shell: true },
  );
  // ...and the page notices by itself once it has.
  await expect(page.getByRole('heading', { name: /Order in/ })).toBeVisible({ timeout: 20_000 });
  await shot(page, '03-confirmation');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('4. the owner finds that order in Online orders, with the right items and total', async () => {
  await ownerPage.goto('/admin/orders');
  await dismissFloat(ownerPage);
  await ownerPage
    .getByRole('button', { name: 'All', exact: false })
    .filter({ hasText: /^All/ })
    .click();
  await ownerPage
    .getByPlaceholder(/search/i)
    .first()
    .fill(RUN);
  const row = ownerPage.locator('tr').filter({ hasText: PRODUCT });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('2×');
  // 2 × £17.49 + £3.00 standard delivery (0102; goods under the £50 free-delivery bar).
  await expect(row).toContainText('£37.98');
  await shot(ownerPage, '04-online-orders');
});

test('5. a guest cannot buy a vape online', async ({ page }) => {
  const res = await owner.request.get(`${API}/admin/products`);
  const list = (await res.json()) as any[];
  const vape = list.find((p) => p.kind === 'vape' && p.active !== false);
  test.skip(!vape, 'no vape in the catalogue');
  await page.goto(`/shop/${vape.slug}`);
  await shot(page, '05-vape-page');
  await expect(page.getByRole('button', { name: 'Add to bag' })).toHaveCount(0);
});
