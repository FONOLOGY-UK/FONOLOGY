/**
 * Regression pack — things the shop configures, and that customers then see (and pay for).
 *
 *   v4 FEAT-01          Device Models: add / edit / switch off a phone; the Repair and Sell forms follow at once
 *   v5 #33 / C-3        Repair Types + Device Models: a repair is a definition; each phone has its own price per
 *                       sub-type, a blank price is "not offered", and the price shown is the price booked
 *   v5 #16              Variations: options, own stock and price adjustment; the page, the bag and the stock all agree
 *   v5 #12              the signed buy-in form is saved against the product and can be downloaded again
 *   v1 BUG-12, v2 #2–#6, v4 BUG-11   Online orders: "Unfulfilled", To fulfill / All, a date filter, View details, no
 *                       "Ready to collect", no "Awaiting payment", and shipping asks for courier + tracking
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
import { execFileSync } from 'node:child_process';
import { API, OWNER, runTag } from '../lib/env';
import { solidPng } from '../lib/png';

const RUN = runTag();
const DEVICE = `${RUN} Zphone Mk2`;
const REPAIR = `${RUN} Speaker crackle`;

let owner: BrowserContext;
let accessoriesId = '';

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

const get = async (path: string) => {
  const r = await owner.request.get(`${API}${path}`);
  return { status: r.status(), body: await r.json().catch(() => null) };
};
const send = async (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown) => {
  const r = await owner.request.fetch(`${API}${path}`, { method, data });
  return { status: r.status(), body: await r.json().catch(() => null) };
};

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  expect(
    (await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 })).status(),
  ).toBe(200);
  accessoriesId = ((await get('/admin/categories')).body as any[]).find(
    (c) => c.slug === 'accessories',
  ).id;
});
test.afterAll(async () => owner?.close());

test('1. Device Models: add a phone — the Repair and Sell pages show it at once; switch it off and it goes', async ({
  page,
}) => {
  const admin = await owner.newPage();
  const problems = watch(admin);
  await admin.goto('/admin/devices');
  await dismissFloat(admin);
  await admin
    .getByRole('button', { name: /Add device/ })
    .first()
    .click();
  const d = admin.getByRole('dialog');
  await d.locator('#dv-name').fill(DEVICE);
  await d.locator('#dv-brand').selectOption('samsung');
  await shot(admin, '01a-add-device');
  const made = admin.waitForResponse(
    (r) => /\/admin\/devices/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Add device' }).click();
  expect((await made).status()).toBeLessThan(300);
  await expect(admin.getByText(DEVICE).first()).toBeVisible({ timeout: 15_000 });

  // Customers see it, on both forms, with no deploy.
  for (const path of ['/repair', '/sell']) {
    await page.goto(path);
    await expect(
      page.locator('button.dcard', { hasText: DEVICE }),
      `${path} lists the new phone`,
    ).toBeVisible({
      timeout: 20_000,
    });
  }
  const pub = (await (await owner.request.get(`${API}/repair/devices`)).json()) as any[];
  const listed = pub.find((x) => x.name === DEVICE);
  expect(listed, 'the public device list has it').toBeTruthy();
  expect('priceMultiplier' in listed, 'no multiplier since 0109 — prices are per device').toBe(
    false,
  );
  await shot(page, '01b-customer-sees-it');

  // Switch it off.
  const card = admin.locator('article').filter({ hasText: DEVICE });
  await card
    .getByRole('button', { name: /Deactivate|Hide|Disable/i })
    .first()
    .click();
  await expect
    .poll(
      async () =>
        ((await (await owner.request.get(`${API}/repair/devices`)).json()) as any[]).some(
          (x) => x.name === DEVICE,
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(false);
  await page.goto('/repair');
  await expect(page.locator('button.dcard').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('button.dcard', { hasText: DEVICE })).toHaveCount(0);
  await shot(admin, '01c-switched-off');

  // Back on for the pricing test that follows.
  await card
    .getByRole('button', { name: /Activate|Show|Enable/i })
    .first()
    .click();
  await expect
    .poll(
      async () =>
        ((await (await owner.request.get(`${API}/repair/devices`)).json()) as any[]).some(
          (x) => x.name === DEVICE,
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  expect(problems, problems.join('\n')).toEqual([]);
  await admin.close();
});

test('2. Repair Types + Device Models: a new repair priced Original £120 / OEM £90 on the Zphone, Copy left blank — the wizard offers exactly those, books £120, and an edit changes it', async ({
  page,
}) => {
  const admin = await owner.newPage();
  const problems = watch(admin);

  // The repair itself is a definition only: no prices on this screen (C-3).
  await admin.goto('/admin/repair-types');
  await dismissFloat(admin);
  await admin
    .getByRole('button', { name: /Add repair/ })
    .first()
    .click();
  const d = admin.getByRole('dialog');
  await d.locator('#rt-name').fill(REPAIR);
  await d.locator('#rt-desc').fill('Crackly or silent speaker');
  await d.locator('#rt-time').fill('30–45 min');
  await expect(d.locator('#rt-original')).toHaveCount(0);
  await shot(admin, '02a-add-repair');
  const made = admin.waitForResponse(
    (r) => /repair-types/.test(r.url()) && r.request().method() === 'POST',
  );
  await d
    .getByRole('button', { name: /^(Add repair|Save)/ })
    .last()
    .click();
  expect((await made).status()).toBeLessThan(300);
  await expect(admin.getByText(REPAIR).first()).toBeVisible({ timeout: 15_000 });

  // Its prices are typed on the phone: Original £120, OEM £90, Copy blank = not offered.
  const priceDevice = async (prices: Record<string, string>) => {
    await admin.goto('/admin/devices');
    await dismissFloat(admin);
    await admin.getByRole('button', { name: `Edit ${DEVICE} and its prices` }).click();
    const grid = admin.getByRole('dialog').getByRole('group', { name: `${REPAIR} prices` });
    await expect(grid).toBeVisible({ timeout: 15_000 });
    for (const [grade, value] of Object.entries(prices)) {
      await grid.getByLabel(grade, { exact: true }).fill(value);
    }
    await shot(admin, '02b-device-prices');
    const saved = admin.waitForResponse(
      (r) => /\/admin\/devices/.test(r.url()) && ['PUT', 'PATCH'].includes(r.request().method()),
    );
    await admin.getByRole('dialog').getByRole('button', { name: 'Save device' }).click();
    expect((await saved).status()).toBeLessThan(300);
  };
  await priceDevice({ Original: '120', OEM: '90', Copy: '' });

  // The customer picks the Zphone and the new problem: two grades, at the phone's own prices.
  await page.goto('/repair');
  await page.locator('button.dcard', { hasText: DEVICE }).click();
  await page.locator('button.ocard', { hasText: REPAIR }).click();
  const grades = page.locator('button.tcard');
  await expect(grades.first()).toBeVisible({ timeout: 15_000 });
  await expect(grades, 'Copy has no price on this phone, so it is not offered').toHaveCount(2);
  const text = (await grades.allInnerTexts()).join(' | ');
  expect(text).toMatch(/£120/);
  expect(text).toMatch(/£90/);
  await shot(page, '02c-device-prices-on-the-wizard');

  // Original (£120): fill the form and book it.
  await grades.filter({ hasText: '£120' }).first().click();
  await page.getByPlaceholder('Alex Turner').fill(`${RUN} Price Check`);
  await page.getByPlaceholder('07XXX XXXXXX').fill('07700900941');
  await page
    .getByPlaceholder('alex@email.co.uk')
    .fill(`${RUN.toLowerCase()}-price@example.invalid`);
  await page.getByPlaceholder('YT1 2AB').fill('G46 7AA');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('5 Test Street');
  await page.getByRole('button', { name: 'Email' }).click();
  await page
    .getByPlaceholder(/back glass is cracked|what.s wrong/i)
    .fill('Speaker crackles on calls. Test run.');
  await expect(page.locator('body')).toContainText('£120');
  const booked = page.waitForResponse(
    (r) => /\/repair\/bookings/.test(r.url()) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Start my repair/ }).click();
  const res = await booked;
  expect(res.status(), (await res.text()).slice(0, 200)).toBeLessThan(300);
  expect((await res.json()).price, 'the server booked the phone’s own £120.00').toBe(12000);
  await shot(page, '02d-booked');

  // Edit the phone's Original price to £150: the wizard follows.
  await priceDevice({ Original: '150' });
  await page.goto('/repair');
  await page.locator('button.dcard', { hasText: DEVICE }).click();
  await page.locator('button.ocard', { hasText: REPAIR }).click();
  await expect(page.locator('button.tcard').filter({ hasText: '£150' }).first()).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, '02e-edited-price');
  expect(problems, problems.join('\n')).toEqual([]);
  await admin.close();
});

test('3. Variations: the swatches, each variation’s own price, the stock, the bag and the order all agree', async ({
  page,
}) => {
  // The product (0107): Colour Black / White / Red. Black £20 (stock 4, the default),
  // White £23 (stock 5), Red £25 (stock 0).
  const prod = await send('POST', '/admin/products', {
    name: `${RUN} Cable`,
    sub: 'Variant fixture',
    categoryId: accessoriesId,
    price: 2000,
    costPrice: 0,
    stockQty: 0,
    localBuying: false,
    supplier: 'Test Supplier',
    description: 'A cable that comes in several colours.',
    lowStockAlert: false,
    lowStockThreshold: 2,
    addToMaster: true,
    variations: {
      types: [
        {
          name: 'Colour',
          values: [
            { value: 'Black', swatchHex: '#111111' },
            { value: 'White', swatchHex: '#f5f5f5' },
            { value: 'Red', swatchHex: '#d42a1c' },
          ],
        },
      ],
      newVariations: { stockQty: 4, price: 2000, costPrice: 700 },
    },
  });
  expect(prod.status, JSON.stringify(prod.body).slice(0, 200)).toBe(201);
  const pid = prod.body.id as string;
  const slug = prod.body.slug as string;
  const list = (await get(`/admin/products/${pid}/variations`)).body.variants as any[];
  const byColour = (c: string) => list.find((v) => v.options.Colour === c);
  const black = byColour('Black');
  const white = byColour('White');
  const red = byColour('Red');
  expect(black.isDefault, 'the first combination is the default').toBe(true);
  for (const [v, edit] of [
    [white, { price: 2300, stockQty: 5 }],
    [red, { price: 2500, stockQty: 0 }],
  ] as const) {
    const r = await send('PATCH', `/admin/products/${pid}/variations/${v.id}`, edit);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  }

  const problems = watch(page);
  await page.goto(`/shop/${slug}`);
  const colours = page.getByRole('group', { name: 'Colour' });
  await expect(colours).toBeVisible({ timeout: 20_000 });
  const price = page.locator('.pdp__price');
  // Opens on the default; the sold-out colour is offered but says so.
  await expect(price).toHaveText(/^£20(.00)?$/);
  await expect(colours.getByRole('button', { name: 'Red — out of stock' })).toBeVisible();
  await expect(colours.getByRole('button', { name: 'Black', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await colours.getByRole('button', { name: 'Red — out of stock' }).click();
  await expect(price).toHaveText(/^£25(.00)?$/);
  await expect(page.locator('.pdp__oos')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Out of Stock', exact: true }).first(),
  ).toBeDisabled();

  await colours.getByRole('button', { name: 'White', exact: true }).click();
  await expect(price, 'White’s own price').toHaveText(/^£23(.00)?$/);
  await shot(page, '03a-white-selected');

  // Two of the White ones go in the bag: £46.00.
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.locator('.pdp__buy .qty__num')).toHaveText('2');
  await page.getByRole('button', { name: 'Add to bag' }).first().click();
  await page.getByRole('button', { name: /^bag/i }).first().click();
  const bag = page.getByRole('complementary', { name: 'Shopping bag' });
  await expect(bag).toContainText(/£46(.00)?(?!d)/, { timeout: 15_000 });
  await expect(bag).toContainText('White');
  await shot(page, '03b-bag');

  // The same through the real order path: each variation's own price, stock off that one only.
  const guest = await pwRequest.newContext();
  const email = `${RUN.toLowerCase()}-var@example.invalid`;
  const parentOnly = await guest.post(`${API}/orders`, {
    data: {
      lines: [{ productId: pid, variantId: null, quantity: 1 }],
      email,
      firstName: 'Vi',
      lastName: `${RUN} Variant`,
      phone: '07700900942',
      delivery: 'standard',
      address: '6 Test Street',
      postcode: 'G46 7AA',
    },
  });
  expect(parentOnly.status(), 'the parent itself can never be ordered').toBe(400);
  const order = await guest.post(`${API}/orders`, {
    data: {
      lines: [{ productId: pid, variantId: white.id, quantity: 2 }],
      email,
      firstName: 'Vi',
      lastName: `${RUN} Variant`,
      phone: '07700900942',
      delivery: 'standard',
      address: '6 Test Street',
      postcode: 'G46 7AA',
    },
  });
  expect(order.status(), (await order.text()).slice(0, 200)).toBeLessThan(300);
  const o = await order.json();
  expect(o.total, '2 × £23.00 + £3.00 delivery').toBe(4600 + 300);
  const ref = o.reference as string;
  const intent = await guest.post(
    `${API}/orders/${ref}/payment-intent?email=${encodeURIComponent(email)}`,
  );
  expect(intent.status()).toBeLessThan(300);
  execFileSync(
    'pnpm',
    ['--filter', '@fonology/api', 'exec', 'tsx', 'scripts/simulate-stripe-paid.ts', ref],
    {
      stdio: 'inherit',
      shell: true,
    },
  );
  const vs = (await get(`/admin/products/${pid}/variations`)).body.variants as any[];
  expect(vs.find((v) => v.id === white.id).stockQty, 'White 5 → 3').toBe(3);
  expect(vs.find((v) => v.id === black.id).stockQty, 'Black untouched').toBe(4);
  await guest.dispose();
  expect(problems, problems.join('\n')).toEqual([]);
});

test('4. the signed buy-in form is saved with a locally-bought product and can be downloaded again', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  const NAME = `${RUN} Local Buy`;
  await page.goto('/admin/inventory');
  await dismissFloat(page);
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(NAME);
  await d.getByLabel('Short line').fill('Bought from a customer');
  await expect.poll(() => d.locator('#p-category option').count()).toBeGreaterThan(1);
  await d.locator('#p-category').selectOption(accessoriesId);
  await d.locator('#p-price').fill('15');
  await d.locator('#p-cost').fill('5');
  await d.locator('#p-qty').fill('2');
  await d.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type('A locally bought item with its paperwork on file.');
  await d.getByRole('checkbox', { name: /Bought locally/ }).check();

  // No form yet: saving is refused.
  await d.locator('button[type=submit]').click();
  await expect(d.getByText(/Upload the signed buy-in form/)).toBeVisible();
  await shot(page, '04a-form-required');

  await d
    .locator('#p-buyin')
    .setInputFiles({ name: 'buy-in.png', mimeType: 'image/png', buffer: solidPng(400, 300) });
  await expect(d.getByText('Form on file')).toBeVisible({ timeout: 30_000 });
  const saved = page.waitForResponse(
    (r) => /\/admin\/products$/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.locator('button[type=submit]').click();
  expect((await saved).status()).toBe(201);

  // Reopen: still on file, and Download works.
  const row = ((await get('/admin/products')).body as any[]).find((p) => p.name === NAME);
  const link = await get(`/admin/products/${row.id}/buy-in-form`);
  expect(link.status, JSON.stringify(link.body)).toBe(200);
  expect(link.body.signedUrl).toMatch(/^https?:\/\//);
  const file = await owner.request.get(link.body.signedUrl);
  expect(file.status(), 'the stored form can be fetched through its signed link').toBe(200);

  await page.goto('/admin/inventory');
  await page
    .getByPlaceholder(/search/i)
    .first()
    .fill(NAME);
  const tr = page
    .locator('tr')
    .filter({ hasText: NAME })
    .filter({ hasNotText: 'Nothing matches' })
    .first();
  await expect(tr).toBeVisible({ timeout: 30_000 });
  await tr.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByText('Form on file')).toBeVisible();
  await expect(edit.getByRole('button', { name: 'Download' })).toBeVisible();
  await shot(page, '04b-reopened');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('5. Online orders: Unfulfilled, To fulfill / All, a date filter, View details, shipping asks courier + tracking, no "Ready to collect"', async () => {
  // A real paid order to look at.
  const pub = await pwRequest.newContext();
  const email = `${RUN.toLowerCase()}-ord@example.invalid`;
  const prod = await send('POST', '/admin/products', {
    name: `${RUN} Order Widget`,
    sub: 'Orders fixture',
    categoryId: accessoriesId,
    price: 1100,
    costPrice: 300,
    stockQty: 5,
    localBuying: false,
    supplier: 'Test Supplier',
    description: 'A product for the online orders screen checks.',
    lowStockAlert: false,
    lowStockThreshold: 1,
    addToMaster: true,
  });
  const made = await pub.post(`${API}/orders`, {
    data: {
      lines: [{ productId: prod.body.id, variantId: null, quantity: 1 }],
      email,
      firstName: 'Olive',
      lastName: `${RUN} Orders`,
      phone: '07700900943',
      delivery: 'standard',
      address: '7 Order Road, Glasgow',
      postcode: 'G46 7AA',
    },
  });
  expect(made.status(), (await made.text()).slice(0, 200)).toBeLessThan(300);
  const ref = (await made.json()).reference as string;
  expect(
    (
      await pub.post(`${API}/orders/${ref}/payment-intent?email=${encodeURIComponent(email)}`)
    ).status(),
  ).toBeLessThan(300);
  execFileSync(
    'pnpm',
    ['--filter', '@fonology/api', 'exec', 'tsx', 'scripts/simulate-stripe-paid.ts', ref],
    {
      stdio: 'inherit',
      shell: true,
    },
  );
  await pub.dispose();

  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/orders');
  await dismissFloat(page);
  await expect(page.getByText('Unfulfilled', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('body')).not.toContainText('Needs packing or handover');
  await expect(page.locator('body')).not.toContainText(/awaiting payment/i);

  // Filters: exactly "To fulfill" and "All".
  const filter = page.getByRole('group', { name: 'Order filter' });
  await expect(filter.getByRole('button')).toHaveCount(2);
  await expect(filter.getByRole('button', { name: /^To fulfill/ })).toBeVisible();
  await expect(filter.getByRole('button', { name: 'All', exact: true })).toBeVisible();
  for (const gone of ['paid', 'ready', 'unpaid', 'to fulfil']) {
    await expect(filter.getByRole('button', { name: new RegExp(`^${gone}$`, 'i') })).toHaveCount(0);
  }
  // Clicking each must not freeze the page (v3 1.1).
  await filter.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('tr').filter({ hasText: ref })).toBeVisible({ timeout: 20_000 });
  await filter.getByRole('button', { name: /^To fulfill/ }).click();
  // Oldest first and paged, so a brand-new order may be on a later page — what matters is that it loads.
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await filter.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('tr').filter({ hasText: ref })).toBeVisible({ timeout: 20_000 });
  await shot(page, '05a-orders');

  // A date range: today finds it; a range in the past does not.
  const from = page.getByLabel('From date');
  const to = page.getByLabel('To date');
  await expect(from).toBeVisible();
  await from.fill('2020-01-01');
  await to.fill('2020-01-31');
  await expect(page.locator('tr').filter({ hasText: ref })).toHaveCount(0, { timeout: 15_000 });
  await from.fill('2020-01-01');
  await to.fill('2099-12-31');
  await expect(page.locator('tr').filter({ hasText: ref })).toBeVisible({ timeout: 15_000 });

  const row = page.locator('tr').filter({ hasText: ref });
  // Only forward moves that a real shop makes: no "Ready to collect".
  await expect(row.getByRole('button', { name: /ready to collect|mark ready/i })).toHaveCount(0);
  await expect(row.getByRole('button', { name: /mark as paid|mark paid/i })).toHaveCount(0);

  // View details: full address and email.
  await row.click();
  const details = page.getByRole('dialog');
  await expect(details).toContainText('7 Order Road');
  await expect(details).toContainText(email);
  await shot(page, '05b-details');
  await page.keyboard.press('Escape');

  // Mark as shipped needs both fields.
  await row.getByRole('button', { name: /ship/i }).first().click();
  const ship = page.getByRole('dialog').filter({ hasText: 'Mark as shipped' });
  await expect(ship.getByRole('button', { name: /^(Mark|Confirm|Ship)/ }).last()).toBeDisabled();
  await ship.locator('#ship-courier').fill('Royal Mail');
  await expect(
    ship.getByRole('button', { name: /^(Mark|Confirm|Ship)/ }).last(),
    'tracking number still missing',
  ).toBeDisabled();
  await ship.locator('#ship-tracking').fill('RM00112233GB');
  await shot(page, '05c-ship-dialog');
  const shipped = page.waitForResponse(
    (r) => /\/status/.test(r.url()) && r.request().method() === 'POST',
  );
  await ship
    .getByRole('button', { name: /^(Mark|Confirm|Ship)/ })
    .last()
    .click();
  expect((await shipped).status()).toBe(200);
  const track = await (await owner.request.get(`${API}/orders/${ref}/tracking`)).json();
  expect(track).toEqual({ courier: 'Royal Mail', trackingNumber: 'RM00112233GB' });
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});
