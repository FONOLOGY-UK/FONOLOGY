/**
 * Regression pack — the screens that report on the shop, and the request screens.
 *
 *   v1 FEATURE-13   Counter Sales: every till sale, with exact money, filterable by payment method and staff
 *   v5 #8           Busiest periods: the heat-map runs 9am to 8pm, in 12-hour am/pm
 *   v5 #19          Reports / Payments print as a branded PDF (header, shop details, structured table)
 *   v2 #1           choosing "Custom" on a date range does not shift the filter bar
 *   v5 #35 / v4 FEAT-03  Repair Requests: "View details" shows the customer's full details
 *   v3 6.1          the homepage shows approved testimonials
 *
 * Page errors, console errors and 5xx responses fail each test; every step is photographed.
 */
import {
  test,
  expect,
  request as pwRequest,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { API, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PRODUCT = `${RUN} Ledger Widget`;
const CUSTOMER = `${RUN} Detail Customer`;

let owner: BrowserContext;
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
  const shown = await notNow.waitFor({ state: 'visible', timeout: 5_000 }).then(
    () => true,
    () => false,
  );
  if (shown) await notNow.click();
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  expect(
    (await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 })).status(),
  ).toBe(200);
  const cats = (await (await owner.request.get(`${API}/admin/categories`)).json()) as any[];
  const made = await owner.request.post(`${API}/admin/products`, {
    data: {
      name: PRODUCT,
      sub: 'Ledger fixture',
      categoryId: cats.find((c) => c.slug === 'accessories').id,
      price: 1250,
      costPrice: 400,
      stockQty: 10,
      localBuying: false,
      supplier: 'Test Supplier',
      description: 'A product to ring up for the sales ledger checks.',
      lowStockAlert: false,
      lowStockThreshold: 2,
    },
  });
  expect(made.status(), (await made.text()).slice(0, 200)).toBe(201);
  productId = (await made.json()).id;
});
test.afterAll(async () => owner?.close());

test('1. Counter Sales lists a till sale with the exact money, and the payment-method filter narrows it', async () => {
  // 2 × £12.50 = £25.00, paid in cash.
  const sale = await owner.request.post(`${API}/pos/sales`, {
    data: {
      lines: [{ productId, variantId: null, quantity: 2 }],
      discount: 0,
      payments: [{ tender: 'cash', amount: 2500 }],
    },
  });
  expect(sale.status(), (await sale.text()).slice(0, 300)).toBe(201);
  const body = await sale.json();
  expect(body.total).toBe(2500);
  saleRef = body.reference;

  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/sales');
  await dismissFloat(page);
  const row = page.locator('tr').filter({ hasText: saleRef });
  await expect(row, 'the sale is in Counter Sales').toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(/£25(\.00)?(?!\d)/);
  await shot(page, '01a-counter-sales');

  // Filter by method: Card hides it, Cash shows it.
  const methods = page.getByRole('group', { name: 'Payment method filter' });
  await methods.getByRole('button', { name: /Card . POS 1/ }).click();
  await expect(page.locator('tr').filter({ hasText: saleRef })).toHaveCount(0, { timeout: 15_000 });
  await methods.getByRole('button', { name: 'Cash' }).click();
  await expect(page.locator('tr').filter({ hasText: saleRef })).toBeVisible({ timeout: 15_000 });
  await shot(page, '01b-cash-filter');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. Busiest periods runs 9am to 8pm in 12-hour am/pm — no 24-hour times', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin');
  await dismissFloat(page);
  const card = page.locator('section, div').filter({ hasText: 'Busiest periods' }).last();
  await expect(card.getByText('Busiest periods').first()).toBeVisible({ timeout: 30_000 });
  const labels = await page
    .locator('main')
    .getByText(/^(9|10|11|12|[1-8])(am|pm)$/)
    .allInnerTexts();
  const wanted = [
    '9am',
    '10am',
    '11am',
    '12pm',
    '1pm',
    '2pm',
    '3pm',
    '4pm',
    '5pm',
    '6pm',
    '7pm',
    '8pm',
  ];
  for (const l of wanted) expect(labels, `the heat-map has ${l}`).toContain(l);
  expect(await page.locator('main').innerText()).not.toMatch(/\b(1[3-9]|2[0-3]):00\b/);
  await shot(page, '02-busiest');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('3. choosing "Custom" on the date range adds the date boxes without shifting the filter bar', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin');
  await dismissFloat(page);
  const custom = page
    .getByRole('button', { name: 'Custom', exact: true })
    .or(page.getByRole('tab', { name: 'Custom' }))
    .first();
  const today = page
    .getByRole('button', { name: 'Today', exact: true })
    .or(page.getByRole('tab', { name: 'Today' }))
    .first();
  await expect(today).toBeVisible({ timeout: 30_000 });
  const before = await today.boundingBox();
  await custom.click();
  await expect(
    page.getByLabel('From date').or(page.locator('input[type=date]').first()),
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600); // let any animation finish
  const after = await today.boundingBox();
  expect(before && after).toBeTruthy();
  expect(
    Math.abs(after!.x - before!.x),
    'the filter bar did not move sideways',
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(after!.y - before!.y), 'nor jump up or down').toBeLessThanOrEqual(2);
  await shot(page, '03-custom-range');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('4. Reports and Payments print as a branded PDF: logo, shop details, a structured table, real PDF bytes', async () => {
  for (const path of ['/admin/reports', '/admin/payments']) {
    const page = await owner.newPage();
    const problems = watch(page);
    await page.goto(path);
    await dismissFloat(page);
    await expect(page.getByRole('button', { name: /Print \/ PDF/ })).toBeVisible({
      timeout: 30_000,
    });
    await page.emulateMedia({ media: 'print' });
    const header = page.locator('.pr-header').first();
    await expect(header, `${path}: a branded header prints`).toBeVisible();
    await expect(header).toContainText('Fonology');
    await expect(header.locator('svg').first(), `${path}: with the logo`).toBeVisible();
    await expect(page.locator('.pr-footer').first()).toContainText(/Fonology/);
    // A real, shaded table header (not plain black-on-white text).
    const shaded = await page
      .locator('.pr-table thead tr')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
      .catch(() => 'none');
    expect(shaded, `${path}: the table header is shaded`).not.toMatch(
      /^(rgba\(0, 0, 0, 0\)|none|rgb\(255, 255, 255\))$/,
    );
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length, `${path}: a real PDF, with content`).toBeGreaterThan(8_000);
    await shot(page, `04-print-${path.split('/').pop()}`);
    expect(problems, problems.join('\n')).toEqual([]);
    await page.close();
  }
});

test('5. Repair Requests: "View details" opens the full request — name, phone, email, address, device and problem', async () => {
  const pub = await pwRequest.newContext();
  const devices = (await (await pub.get(`${API}/repair/devices`)).json()) as any[];
  // 0109: book something the device actually offers — its prices are its own.
  let deviceId = '';
  let offer: any = null;
  for (const d of devices) {
    const offers = (await (await pub.get(`${API}/repair/offers?deviceId=${d.id}`)).json()) as any[];
    if (offers.length > 0) {
      deviceId = d.id;
      offer = offers[0];
      break;
    }
  }
  expect(offer, 'a device with at least one priced repair').toBeTruthy();
  const made = await pub.post(`${API}/repair/bookings`, {
    data: {
      deviceId,
      repairId: offer.repairId,
      subTypeId: offer.subTypeId,
      name: CUSTOMER,
      phone: '07700900951',
      email: `${RUN.toLowerCase()}-detail@example.invalid`,
      address: '8 Details Road, Glasgow',
      postcode: 'G46 7AA',
      preferredContact: 'email',
      notes: 'Screen has a diagonal crack.',
    },
  });
  expect(made.status(), (await made.text()).slice(0, 200)).toBeLessThan(300);
  await pub.dispose();

  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/submissions');
  await dismissFloat(page);
  const row = page.locator('tr').filter({ hasText: CUSTOMER });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(page, '05a-requests');
  // The whole row opens the details (the Send to Jobs button inside it has its own action).
  await row.locator('td').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(CUSTOMER);
  await expect(dialog).toContainText('07700900951');
  await expect(dialog).toContainText(`${RUN.toLowerCase()}-detail@example.invalid`);
  await expect(dialog).toContainText('8 Details Road');
  await expect(dialog).toContainText('diagonal crack');
  await shot(page, '05b-details');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('6. an approved testimonial shows on the homepage', async ({ page }) => {
  const QUOTE = `${RUN} Fixed my phone in half an hour, brilliant.`;
  const add = await owner.request.post(`${API}/admin/reviews`, {
    data: {
      author: `${RUN} Happy Customer`,
      rating: 5,
      body: QUOTE,
      source: 'Google',
      isPublished: true,
    },
  });
  // The create body varies by build; fall back to what the screen sends if this shape is refused.
  if (add.status() >= 300) {
    const admin = await owner.newPage();
    await admin.goto('/admin/reviews');
    await admin
      .getByRole('button', { name: /Add review/ })
      .first()
      .click();
    const d = admin.getByRole('dialog');
    await d
      .getByLabel(/name|author/i)
      .first()
      .fill(`${RUN} Happy Customer`);
    await d
      .getByLabel(/review|text|quote|comment/i)
      .first()
      .fill(QUOTE);
    await d
      .getByRole('button', { name: /^(Add|Save|Create)/ })
      .last()
      .click();
    await expect(admin.getByText(QUOTE).first()).toBeVisible({ timeout: 15_000 });
    await admin.close();
  }
  const problems = watch(page);
  await page.goto('/');
  await expect(page.getByText(QUOTE).first(), 'the homepage shows the testimonial').toBeVisible({
    timeout: 30_000,
  });
  await shot(page, '06-homepage-testimonial');
  expect(problems, problems.join('\n')).toEqual([]);
});
