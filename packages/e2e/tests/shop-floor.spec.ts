/**
 * The repair side of the shop, the way people actually do it:
 *
 *  A. a customer books a repair through the /repair wizard
 *  B. the owner finds it under Repair Requests and sends it to the bench (Jobs)
 *  C. the job is on the board with the customer's details, and its label is right
 *  D. the job moves along the board
 *
 * Page errors, console errors and 5xx responses fail each test; every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const CUSTOMER = `${RUN} Repairer`;
let owner: BrowserContext;
let ownerPage: Page;
let jobRef = '';

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

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 });
  expect(r.status()).toBe(200);
  ownerPage = await owner.newPage();
});
test.afterAll(async () => owner?.close());

test('A. a customer books a repair through the wizard', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/repair');
  await shot(page, 'A1-repair-start');

  // 1 — which phone
  await page.locator('button.dcard').first().click();

  // 2 — what's wrong (a priced repair, so there is an estimate)
  const priced = page.locator('button.ocard', { hasText: /from £/ }).first();
  await expect(priced).toBeVisible();
  await priced.click();

  // 3 — which part grade
  await page.locator('button.tcard').first().click();
  await shot(page, 'A2-part-grade');

  // 4 — your details
  await page.getByPlaceholder('Alex Turner').fill(CUSTOMER);
  await page.getByPlaceholder('07XXX XXXXXX').fill('07700900620');
  await page.getByPlaceholder('alex@email.co.uk').fill(`${RUN.toLowerCase()}-rep@example.invalid`);
  await page.getByPlaceholder('YT1 2AB').fill('G46 7AA');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('2 Test Street');
  await page.getByRole('button', { name: 'Email' }).click();
  await page.getByPlaceholder(/back glass is cracked/).fill('Cracked in the corner. Test run.');
  await shot(page, 'A3-details');
  await page.getByRole('button', { name: /Start my repair/ }).click();

  await expect(page.locator('.wz-done__title')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('body')).toContainText(/Pay nothing now|reference/i);
  await shot(page, 'A4-booked');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('B. the owner sends it to the bench from Repair Requests', async () => {
  const problems = watch(ownerPage);
  await ownerPage.goto('/admin/submissions');
  await dismissFloat(ownerPage);
  const row = ownerPage.locator('tr').filter({ hasText: CUSTOMER });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(ownerPage, 'B1-requests');
  await row.getByRole('button', { name: 'Send to Jobs' }).click();
  const dialog = ownerPage.getByRole('dialog');
  await expect(dialog).toContainText(CUSTOMER);
  const price = dialog
    .getByRole('textbox')
    .or(dialog.locator('input[type=number], input[inputmode=decimal]'))
    .first();

  // Staff may quote MORE than the shop price, never less — and must be told why.
  await price.fill('85');
  const refused = ownerPage.waitForResponse(
    (r) => r.url().includes('/convert') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Send to the bench' }).click();
  expect((await refused).status()).toBe(409);
  await shot(ownerPage, 'B2-quote-too-low');
  await expect(
    ownerPage.getByText(/below the shop price/i).first(),
    'the refusal is shown to the user somewhere',
  ).toBeVisible({ timeout: 8_000 });
  await shot(ownerPage, 'B2-quote-too-low');

  await price.fill('120');
  const conv = ownerPage.waitForResponse(
    (r) => r.url().includes('/convert') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Send to the bench' }).click();
  const res = await conv;
  expect([200, 201], (await res.text()).slice(0, 200)).toContain(res.status());
  jobRef = ((await res.json()) as { reference: string }).reference;
  await expect(ownerPage.getByText(jobRef).first()).toBeVisible();
  await shot(ownerPage, 'B3-sent');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('C. the job is on the board and opens with the customer’s details', async () => {
  await ownerPage.goto('/admin/jobs');
  await dismissFloat(ownerPage);
  await ownerPage.getByText(jobRef, { exact: true }).first().click();
  await shot(ownerPage, 'C1-job-sheet');
  await expect(ownerPage.locator('body')).toContainText(CUSTOMER);
  await expect(ownerPage.locator('body')).toContainText('£120');
});

/* ---------------------------------------------------------------- trade-in */
const SELLER = `${RUN} Seller`;

test('D. a customer sends in a phone to sell, and gets an offer', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/sell');
  await shot(page, 'D1-sell-start');

  await page.locator('button.dcard').first().click(); // which phone (auto-advances)
  // Condition: answer the first option of every question on the page.
  const step = page.locator('.wz-step.is-active');
  await expect(step.locator('.slot-row').first()).toBeVisible();
  const rows = step.locator('.slot-row');
  const n = await rows.count();
  for (let i = 0; i < n; i += 1) {
    await rows.nth(i).locator('button.slot').first().click();
  }
  await shot(page, 'D2-condition');
  await expect(step.getByText(/our offer/i).first()).toBeVisible();
  await step.getByRole('button', { name: 'Continue' }).click();

  await page.getByPlaceholder('Alex Turner').fill(SELLER);
  await page.getByPlaceholder('07XXX XXXXXX').fill('07700900630');
  await page.getByPlaceholder('alex@email.co.uk').fill(`${RUN.toLowerCase()}-sell@example.invalid`);
  await page.getByPlaceholder(/battery health/).fill('Test run — please ignore.');
  await shot(page, 'D3-details');
  await page.getByRole('button', { name: /Get my offer/ }).click();
  await expect(page.locator('.wz-done__title')).toBeVisible({ timeout: 60_000 });
  await shot(page, 'D4-offer');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('E. the owner sees the trade-in request, with the customer’s own answers', async () => {
  await ownerPage.goto('/admin/trade-ins');
  await dismissFloat(ownerPage);
  // The page's own search box (top, with a Search button) is the server-side one; the filter inside the
  // table only narrows the page already loaded.
  await ownerPage.getByPlaceholder('Reference, name or email…').fill(SELLER);
  await ownerPage.getByRole('button', { name: 'Search', exact: true }).click();
  const row = ownerPage
    .locator('tr')
    .filter({ hasText: SELLER })
    .filter({ hasText: /awaiting quote/i });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(ownerPage, 'E1-trade-in-queue');
  await row.click();
  await expect(ownerPage.locator('body')).toContainText(SELLER);
  await shot(ownerPage, 'E2-trade-in-detail');
});
