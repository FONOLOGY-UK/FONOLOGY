/**
 * Regression pack — the customer's website, the way QA reports v2–v5 describe it, with real clicks.
 *
 *   v3 4.1 / v4 BUG-03  stock is checked when an item is added to the bag; the postcode is checked on entry
 *   v3 4.1 / v4 BUG-04  no Promo Code field         v4 BUG-06  no "Click & collect"
 *   v4 BUG-05           every valid UK postcode is accepted (and delivery is quoted for it)
 *   v5 #30  "Save my information" is not shown to guests
 *   v5 #7   a Staff / Owner login cannot place an order (or send a repair / sell request) — and says why
 *   v5 #9   search finds plurals and partial words      v5 #10 sub-category pills under a category
 *   v5 #17  PDP shows the badge and "Compatible with"; the description sits in Details
 *   v5 #23  "Where's my order?" asks for the Order ID only, and returns courier + tracking only
 *   v5 #28  toasts show clean text (no raw HTML)        v3 5.2 / v5 #18 product page image handling
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

const RUN = runTag();
const CHARGER = `${RUN} Charger`;
const CASE = `${RUN} Sleeve`;
const TAG = 'Best seller';
const COMPAT = 'iPhone 13, iPhone 14';
const DESCRIPTION = 'A sturdy braided charging cable that lasts. Details paragraph for the PDP.';

let owner: BrowserContext;
let chargerSlug = '';
let chargerId = '';
let caseId = '';
let accessoriesId = '';
let casesId = '';

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

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 });
  expect(r.status()).toBe(200);

  const cats = (await (await owner.request.get(`${API}/admin/categories`)).json()) as any[];
  accessoriesId = cats.find((c) => c.slug === 'accessories').id;
  casesId = cats.find((c) => c.slug === 'cases').id;

  const mk = async (name: string, categoryId: string, extra: Record<string, unknown>) => {
    const res = await owner.request.post(`${API}/admin/products`, {
      data: {
        name,
        sub: 'Storefront fixture',
        categoryId,
        price: 1299,
        costPrice: 400,
        stockQty: 2,
        localBuying: false,
        supplier: 'Test Supplier',
        lowStockAlert: false,
        lowStockThreshold: 2,
        description: DESCRIPTION,
        addToMaster: true,
        ...extra,
      },
    });
    expect(res.status(), (await res.text()).slice(0, 200)).toBe(201);
    return (await res.json()) as any;
  };
  const charger = await mk(CHARGER, accessoriesId, { tag: TAG, compatibility: COMPAT });
  chargerId = charger.id;
  chargerSlug = charger.slug;
  const sleeve = await mk(CASE, casesId, {});
  caseId = sleeve.id;
});

test.afterAll(async () => {
  await owner?.close();
});

test('1. search finds plurals and partial words ("chargers", "charg", "Charger")', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/shop');
  const box = page.getByPlaceholder('Search products…');
  for (const q of [`${RUN} chargers`, `${RUN} charg`, `${RUN} CHARGER`]) {
    await box.fill(q);
    await expect(
      page.locator(`a[href^="/shop/"]`).filter({ hasText: CHARGER }).first(),
      `"${q}" finds it`,
    ).toBeVisible({
      timeout: 15_000,
    });
  }
  await shot(page, '01-search-plural');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('2. choosing a category shows its sub-category pills, and a pill narrows the list', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/shop');
  await page.getByRole('tab', { name: 'Accessories', exact: true }).click();
  const pills = page.getByRole('tab', { name: 'Cases', exact: true });
  await expect(pills.first(), 'a Cases sub-category pill appears under Accessories').toBeVisible({
    timeout: 15_000,
  });
  await shot(page, '02a-accessories');
  await pills.first().click();
  await page.getByPlaceholder('Search products…').fill(RUN);
  await expect(page.locator('a[href^="/shop/"]').filter({ hasText: CASE }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.locator('a[href^="/shop/"]').filter({ hasText: CHARGER }),
    'the charger is not a Case, so the pill removes it',
  ).toHaveCount(0);
  await shot(page, '02b-cases-only');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('3. the product page shows the badge and compatibility; the description is in Details', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto(`/shop/${chargerSlug}`);
  await expect(page.getByRole('heading', { name: CHARGER })).toBeVisible();
  await expect(page.locator('.pdp__title-badge')).toHaveText(TAG);
  await expect(page.getByText('Compatible with')).toBeVisible();
  await expect(page.locator('body')).toContainText('iPhone 13');
  await expect(page.locator('body')).toContainText('iPhone 14');
  // The description is under "Details", not beside the buy box.
  const details = page
    .locator('section, div')
    .filter({ has: page.getByRole('heading', { name: 'Details' }) })
    .last();
  await expect(details).toContainText('sturdy braided charging cable');
  const buyBox = page.locator('.pdp__info, .pdp__buy, [class*="pdp__right"]').first();
  if (await buyBox.count()) await expect(buyBox).not.toContainText('sturdy braided charging cable');
  // Customers never see a stock count.
  await expect(page.locator('body')).not.toContainText(/\b2 (in stock|left)\b/i);
  await shot(page, '03-pdp');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('4. you cannot put more in the bag than we have, and the toast is clean text', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto(`/shop/${chargerSlug}`);
  // Stock is 2. Since the bag-limit change (dca09ba, BUG-001) every "+" is checked against the
  // stock of every shop, so asking for a third is refused at the "+" itself — the earliest
  // possible moment — and the number stays at 2.
  const up = page.getByRole('button', { name: 'Increase quantity' });
  const qtyNum = page.locator('.pdp__buy .qty__num');
  // A click before the page has hydrated does nothing, so click until the number moves.
  await expect(async () => {
    if ((await qtyNum.innerText()) !== '2') await up.click();
    await expect(qtyNum).toHaveText('2', { timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await up.click();
  const sorry = page.getByText(/that.s all the .* we have/i).first();
  await expect(sorry, 'told straight away, not at the last checkout step').toBeVisible({
    timeout: 15_000,
  });
  await expect(qtyNum, 'the number does not go past the stock').toHaveText('2');
  await shot(page, '04a-too-many');
  expect(
    await page
      .locator('[role="status"], [data-sonner-toast], .toast')
      .allInnerTexts()
      .then((t) => t.join(' ')),
  ).not.toMatch(/<\/?\w+>/);

  // Two is fine, and the "added" toast has no tags in it.
  await shot(page, '04a2-qty-two');
  await page.getByRole('button', { name: 'Add to bag' }).first().click();
  const added = page.getByText('added to your bag').first();
  await expect(added).toBeVisible({ timeout: 15_000 });
  const toastText = (await added.innerText()) + (await added.evaluate((el) => el.innerHTML));
  expect(toastText, 'no raw HTML tags in the toast').not.toMatch(/&lt;|<strong>|<\/?b>/);
  await shot(page, '04b-added');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('5. checkout: Standard + Next day only, no promo code, no "Save my information" for a guest, postcode checked on entry', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto(`/shop/${chargerSlug}`);
  await page.getByRole('button', { name: 'Add to bag' }).first().click();
  await page.goto('/checkout');
  await page.getByLabel('Email').fill(`${RUN.toLowerCase()}-guest@example.invalid`);
  await page.getByLabel('First name').fill('Pat');
  await page.getByLabel('Last name').fill(`${RUN} Guest`);
  await page.getByLabel('Phone').fill('07700900801');
  await shot(page, '05a-details');

  await expect(page.getByText(/click\s*(&|and)\s*collect/i), 'no Click & collect').toHaveCount(0);
  await expect(page.getByText(/standard/i).first()).toBeVisible();
  await expect(page.getByText(/next[- ]day/i).first()).toBeVisible();
  await expect(page.getByLabel(/promo/i), 'no promo code field').toHaveCount(0);
  await expect(page.getByPlaceholder(/promo|discount code/i)).toHaveCount(0);
  await expect(
    page.getByText(/save my information/i),
    'a guest has nothing to save it to',
  ).toHaveCount(0);

  // The postcode is checked as soon as you leave the field.
  const postcode = page.getByPlaceholder('YT1 2AB');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('1 Test Street');
  await postcode.fill('NOT A POSTCODE');
  await postcode.blur();
  await expect(page.getByText(/valid UK postcode/i)).toBeVisible({ timeout: 5_000 });
  await shot(page, '05b-bad-postcode');
  await postcode.fill('G46 7RX');
  await postcode.blur();
  await expect(page.getByText(/valid UK postcode/i)).toHaveCount(0);
  await shot(page, '05c-good-postcode');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('6. delivery is quoted for every valid UK postcode shape (the server accepts what the form accepts)', async () => {
  const pub = await pwRequest.newContext();
  const lines = [{ productId: chargerId, variantId: null, quantity: 1 }];
  const quote = async (postcode: string) => {
    const r = await pub.post(`${API}/orders/delivery-quote`, {
      data: { lines, delivery: 'standard', postcode },
    });
    return { status: r.status(), body: await r.json().catch(() => null) };
  };
  for (const pc of [
    'G46 7RX',
    'g467rx',
    'EC1A 1BB',
    'W1A 0AX',
    'M1 1AE',
    'B33 8TH',
    'CR2 6XH',
    'DN55 1PT',
    'SW1A 2AA',
    'EH1 1YZ',
  ]) {
    const q = await quote(pc);
    expect(q.status, `${pc}: ${JSON.stringify(q.body)}`).toBe(200);
    expect(q.body.deliveryFee, `${pc} has the mainland standard fee`).toBe(300);
  }
  // Islands, Northern Ireland and the Channel Islands are the remote zone, by design (0102),
  // and get standard delivery only.
  for (const pc of ['KA27 8AB', 'BT1 1AA', 'IM1 1AA', 'ZE1 0AA', 'JE2 3AB', 'bt11aa']) {
    const remote = await quote(pc);
    expect(remote.status, pc).toBe(200);
    expect(remote.body.deliveryFee, `${pc} costs the remote rate`).toBe(550);
    expect(
      remote.body.options.find((o: { method: string }) => o.method === 'next-day')?.available,
      `${pc} is not offered next-day`,
    ).toBe(false);
  }
  // Next-day to a remote postcode is refused when an order is placed, not just hidden.
  const remoteNextDay = await pub.post(`${API}/orders/delivery-quote`, {
    data: { lines, delivery: 'next-day', postcode: 'IV1 1AA' },
  });
  expect((await remoteNextDay.json()).methodAvailable, 'remote next-day').toBe(false);
  // Goods over £50 make mainland standard free; next-day is still charged.
  const big = [{ productId: chargerId, variantId: null, quantity: 4 }];
  const free = await pub.post(`${API}/orders/delivery-quote`, {
    data: { lines: big, delivery: 'standard', postcode: 'G46 7RX' },
  });
  expect((await free.json()).deliveryFee, 'over £50, mainland standard is free').toBe(0);
  const fast = await pub.post(`${API}/orders/delivery-quote`, {
    data: { lines: big, delivery: 'next-day', postcode: 'G46 7RX' },
  });
  expect((await fast.json()).deliveryFee, 'next-day is still charged over £50').toBe(550);
  await pub.dispose();
});

test('7. "Where’s my order?" takes the Order ID only, and gives back courier + tracking only', async ({
  page,
}) => {
  // An order that has really shipped.
  const pub = await pwRequest.newContext();
  const email = `${RUN.toLowerCase()}-track@example.invalid`;
  const made = await pub.post(`${API}/orders`, {
    data: {
      lines: [{ productId: caseId, variantId: null, quantity: 1 }],
      email,
      firstName: 'Tracy',
      lastName: `${RUN} Tracker`,
      phone: '07700900802',
      delivery: 'standard',
      address: '2 Test Street',
      postcode: 'G46 7AA',
    },
  });
  expect(made.status(), (await made.text()).slice(0, 200)).toBeLessThan(300);
  const reference = (await made.json()).reference as string;
  const intent = await pub.post(
    `${API}/orders/${reference}/payment-intent?email=${encodeURIComponent(email)}`,
  );
  expect(intent.status()).toBeLessThan(300);
  execFileSync(
    'pnpm',
    ['--filter', '@fonology/api', 'exec', 'tsx', 'scripts/simulate-stripe-paid.ts', reference],
    {
      stdio: 'inherit',
      shell: true,
    },
  );
  const orders = (await (await owner.request.get(`${API}/orders`)).json()) as any;
  const rows = (orders.items ?? orders) as any[];
  const mine = rows.find((o) => o.reference === reference);
  expect(mine, 'paid order is in the admin list').toBeTruthy();
  const ship = await owner.request.post(`${API}/orders/id/${mine.id}/status`, {
    data: { status: 'shipped', courier: 'Evri', trackingNumber: 'EV9988776655' },
  });
  expect(ship.status()).toBe(200);
  await pub.dispose();

  const problems = watch(page);
  await page.goto('/track');
  await expect(page.getByLabel('Order ID')).toBeVisible();
  await expect(page.getByLabel(/email/i), 'no email field any more').toHaveCount(0);
  await page.getByLabel('Order ID').fill(reference);
  await page.getByRole('button', { name: /^Track/ }).click();
  await expect(page.getByText('Evri')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('EV9988776655')).toBeVisible();
  // No internal status timeline.
  await expect(page.getByText(/out for delivery|being packed|processing|confirmed/i)).toHaveCount(
    0,
  );
  await shot(page, '07-track');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('8. a signed-in Owner is stopped at the final step — and told why — for orders, repairs and sell requests', async () => {
  // The owner's cookie is on this context. Browsing is fine; submitting is not.
  const order = await owner.request.post(`${API}/orders`, {
    data: {
      lines: [{ productId: caseId, variantId: null, quantity: 1 }],
      email: `${RUN.toLowerCase()}-staff@example.invalid`,
      firstName: 'Staff',
      lastName: 'Buyer',
      phone: '07700900803',
      delivery: 'standard',
      address: '3 Test Street',
      postcode: 'G46 7AA',
    },
  });
  expect(
    order.status(),
    'an order cannot be placed while signed in as staff',
  ).toBeGreaterThanOrEqual(400);
  expect(order.status()).toBeLessThan(500);
  expect(await order.text()).toMatch(/staff|owner|signed in|log(ged)? ?out/i);

  const devices = (await (await owner.request.get(`${API}/repair/devices`)).json()) as any[];
  const types = (await (await owner.request.get(`${API}/repair/types`)).json()) as any[];
  const booking = await owner.request.post(`${API}/repair/bookings`, {
    data: {
      deviceId: devices[0].id,
      repairId: (types.find((t) => t.base) ?? types[0]).id,
      tierId: 'copy',
      name: `${RUN} Staff Booker`,
      phone: '07700900804',
      email: `${RUN.toLowerCase()}-sb@example.invalid`,
      address: '4 Test Street',
      postcode: 'G46 7AA',
      preferredContact: 'email',
      notes: 'staff attempt',
    },
  });
  expect(
    booking.status(),
    'a repair request cannot be sent while signed in as staff',
  ).toBeGreaterThanOrEqual(400);
  expect(booking.status()).toBeLessThan(500);
  expect(await booking.text()).toMatch(/staff|owner|signed in|log(ged)? ?out/i);
});
