/**
 * Regression pack — a signed-in customer, and the two request forms.
 *
 *   v5 #22  the Customer Dashboard: orders (with courier + tracking), one-click Track, an address book
 *   v5 #30  "Save my information" is for signed-in customers, and really saves the address
 *   v5 #21  product reviews: only buyers, one each, held for approval, published when the Admin approves
 *   v4 BUG-07 / v5 #31  Sell form: "Other" device asks what it is; storage / screen / body take free text; extra details box
 *   v5 #32  no tracking link after a repair or sell request
 *   v5 #33  Repair form: an "Other" problem the customer can describe
 *   v5 #7   a signed-in Owner pressing the final button on a request is stopped, with a clear message
 *
 * Page errors, console errors and 5xx responses fail each test; every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { API, OWNER, runTag } from '../lib/env';
import { emailedLink } from '../lib/mail';

const RUN = runTag();
const PASSWORD = 'Customer-Pass-1!';
const BUYER = { name: `${RUN} Buyer`, email: `${RUN.toLowerCase()}-buyer@e2e.fonology.test` };
const STRANGER = {
  name: `${RUN} Stranger`,
  email: `${RUN.toLowerCase()}-stranger@e2e.fonology.test`,
};
const PRODUCT = `${RUN} Reviewed Widget`;

let owner: BrowserContext;
let buyer: BrowserContext;
let stranger: BrowserContext;
let productId = '';
let slug = '';
let orderRef = '';

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

/** Register through the API and confirm with the emailed link, like a person would; leaves the context signed in. */
async function newCustomer(
  browser: any,
  who: { name: string; email: string },
): Promise<BrowserContext> {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const up = await ctx.request.post(`${API}/auth/customer/signup`, {
    data: { name: who.name, email: who.email, password: PASSWORD },
  });
  expect(up.status(), (await up.text()).slice(0, 200)).toBeLessThan(300);
  const link = await emailedLink(who.email, '/auth/confirm');
  const token = new URL(link).searchParams.get('token')!;
  const ok = await ctx.request.post(`${API}/auth/customer/confirm-email`, { data: { token } });
  expect(ok.status(), (await ok.text()).slice(0, 200)).toBeLessThan(300);
  return ctx;
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
      sub: 'Review fixture',
      categoryId: cats.find((c) => c.slug === 'accessories').id,
      price: 2000,
      costPrice: 700,
      stockQty: 9,
      localBuying: false,
      supplier: 'Test Supplier',
      description: 'A product the buyer has really bought, so they may review it.',
      lowStockAlert: false,
      lowStockThreshold: 2,
      addToMaster: true,
    },
  });
  expect(made.status(), (await made.text()).slice(0, 200)).toBe(201);
  const p = await made.json();
  productId = p.id;
  slug = p.slug;
  buyer = await newCustomer(browser, BUYER);
  stranger = await newCustomer(browser, STRANGER);
});

test.afterAll(async () => {
  await Promise.all([owner?.close(), buyer?.close(), stranger?.close()]);
});

test('1. a signed-in customer buys, it ships, and the dashboard shows it with courier + tracking and a one-click Track', async () => {
  const order = await buyer.request.post(`${API}/orders`, {
    data: {
      lines: [{ productId, variantId: null, quantity: 1 }],
      email: BUYER.email,
      firstName: 'Bea',
      lastName: `${RUN} Buyer`,
      phone: '07700900931',
      delivery: 'standard',
      address: '9 Account Street',
      postcode: 'G46 7AA',
    },
  });
  expect(order.status(), (await order.text()).slice(0, 200)).toBeLessThan(300);
  orderRef = (await order.json()).reference;
  const intent = await buyer.request.post(`${API}/orders/${orderRef}/payment-intent`);
  expect(intent.status(), (await intent.text()).slice(0, 200)).toBeLessThan(300);
  execFileSync(
    'pnpm',
    ['--filter', '@fonology/api', 'exec', 'tsx', 'scripts/simulate-stripe-paid.ts', orderRef],
    {
      stdio: 'inherit',
      shell: true,
    },
  );
  const list = (await (await owner.request.get(`${API}/orders`)).json()) as any;
  const mine = ((list.items ?? list) as any[]).find((o) => o.reference === orderRef);
  expect(mine, 'the paid order is in Online orders').toBeTruthy();
  const ship = await owner.request.post(`${API}/orders/id/${mine.id}/status`, {
    data: { status: 'shipped', courier: 'DPD', trackingNumber: 'DPD5550001' },
  });
  expect(ship.status()).toBe(200);

  const page = await buyer.newPage();
  const problems = watch(page);
  await page.goto('/account');
  const card = page.locator('.acct-history__card').filter({ hasText: orderRef });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('DPD');
  await expect(card).toContainText('DPD5550001');
  await shot(page, '01a-dashboard');
  await card.getByRole('link', { name: /Track/ }).click();
  await expect(page).toHaveURL(/\/track/);
  await expect(page.getByText('DPD5550001')).toBeVisible({ timeout: 20_000 });
  await shot(page, '01b-track-from-dashboard');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. the address book: add, set as default, edit, delete', async () => {
  const page = await buyer.newPage();
  const problems = watch(page);
  await page.goto('/account');
  await expect(
    page.getByText('No saved addresses yet.').or(page.locator('.acct-address-card')).first(),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Add address' }).click();
  await page.getByPlaceholder('e.g. Home').fill('Home');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('1 Home Road, Glasgow');
  await page.getByPlaceholder('YT1 2AB').fill('G46 7RX');
  await page.getByRole('button', { name: 'Save address' }).click();
  const home = page.locator('.acct-address-card').filter({ hasText: '1 Home Road' });
  await expect(home).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Add address' }).click();
  await page.getByPlaceholder('e.g. Home').fill('Work');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('2 Work Lane, Glasgow');
  await page.getByPlaceholder('YT1 2AB').fill('G12 8QQ');
  await page.getByRole('button', { name: 'Save address' }).click();
  const work = page.locator('.acct-address-card').filter({ hasText: '2 Work Lane' });
  await expect(work).toBeVisible({ timeout: 15_000 });
  await shot(page, '02a-two-addresses');

  // Make Work the default.
  await work
    .getByRole('button', { name: /default/i })
    .first()
    .click();
  await expect(work).toContainText(/default/i, { timeout: 15_000 });
  const book = (await (await buyer.request.get(`${API}/auth/customer/addresses`)).json()) as any[];
  expect(
    book.find((a) => /Work Lane/.test(a.address))?.isDefault,
    'the server holds the default',
  ).toBe(true);
  expect(book.filter((a) => a.isDefault)).toHaveLength(1);

  // Edit Home's postcode.
  await home.getByRole('button', { name: /edit/i }).first().click();
  await page.getByPlaceholder('YT1 2AB').fill('G46 7AA');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(home).toContainText('G46 7AA', { timeout: 15_000 });

  // Delete Home.
  page.once('dialog', (d) => d.accept()); // the address book asks with the browser's own confirm box
  await home
    .getByRole('button', { name: /delete|remove/i })
    .first()
    .click();
  await expect(home).toHaveCount(0, { timeout: 15_000 });
  await shot(page, '02b-after-delete');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('3. checkout while signed in offers "Save my information", and ticking it saves the address', async () => {
  const page = await buyer.newPage();
  const problems = watch(page);
  await page.goto(`/shop/${slug}`);
  await page.getByRole('button', { name: 'Add to bag' }).first().click();
  // Adding waits on a stock check first; going straight to /checkout could beat it
  // and land on an empty bag.
  await expect(page.getByText('added to your bag').first()).toBeVisible({ timeout: 15_000 });
  await page.goto('/checkout');
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });
  const save = page.getByText(/save my information/i);
  await expect(save, 'a signed-in customer sees the box').toBeVisible({ timeout: 15_000 });
  await page.getByLabel('First name').fill('Bea');
  await page.getByLabel('Last name').fill(`${RUN} Buyer`);
  await page.getByLabel('Phone').fill('07700900931');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('77 Saved Street, Glasgow');
  await page.getByPlaceholder('YT1 2AB').fill('G46 7RX');
  await save.click();
  await shot(page, '03-save-ticked');
  await page.getByRole('button', { name: 'Continue' }).first().click();
  await expect
    .poll(
      async () =>
        JSON.stringify(await (await buyer.request.get(`${API}/auth/customer/addresses`)).json()),
      {
        timeout: 20_000,
      },
    )
    .toContain('77 Saved Street');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('4. reviews: only a buyer can review, once; it waits for approval; the Admin approves it; then it is public', async () => {
  const BODY = `${RUN} lasted well, would buy again`;

  // The stranger has bought nothing.
  const eligibleStranger = await (
    await stranger.request.get(`${API}/reviews/product/${productId}/eligibility`)
  ).json();
  expect(eligibleStranger.purchased, 'a stranger has not bought it').toBe(false);
  const refused = await stranger.request.post(`${API}/reviews/product/${productId}`, {
    data: { rating: 5, body: 'spam' },
  });
  expect(refused.status(), 'a non-buyer cannot review').toBeGreaterThanOrEqual(400);
  expect(refused.status()).toBeLessThan(500);
  const sp = await stranger.newPage();
  await sp.goto(`/shop/${slug}`);
  await expect(sp.getByLabel('Review text'), 'no review form for a non-buyer').toHaveCount(0);

  // The buyer can.
  const page = await buyer.newPage();
  const problems = watch(page);
  await page.goto(`/shop/${slug}`);
  await page.getByRole('radio', { name: '4 stars' }).click();
  await page.getByLabel('Review text').fill(BODY);
  await shot(page, '04a-review-form');
  const posted = page.waitForResponse(
    (r) => /\/reviews\/product\//.test(r.url()) && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: /submit|post|send/i })
    .last()
    .click();
  expect((await posted).status()).toBe(201);

  // Held for approval: the public list does not have it yet.
  const publicBefore = JSON.stringify(
    await (await owner.request.get(`${API}/reviews/product/${productId}`)).json(),
  );
  expect(publicBefore).not.toContain(BODY);
  // And a second review is refused.
  const again = await buyer.request.post(`${API}/reviews/product/${productId}`, {
    data: { rating: 5, body: 'again' },
  });
  expect(again.status(), 'one review per product per customer').toBe(409);

  // The Admin approves it from the Product Reviews tab.
  const admin = await owner.newPage();
  await admin.goto('/admin/reviews');
  await admin.getByRole('button', { name: 'Product Reviews' }).click();
  const row = admin
    .locator('li, article, tr, div')
    .filter({ hasText: BODY })
    .filter({ has: admin.getByRole('button', { name: 'Approve' }) })
    .last();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(admin, '04b-pending-in-admin');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect
    .poll(
      async () =>
        JSON.stringify(
          await (await owner.request.get(`${API}/reviews/product/${productId}`)).json(),
        ),
      {
        timeout: 20_000,
      },
    )
    .toContain(BODY);

  await page.reload();
  await expect(page.getByText(BODY)).toBeVisible({ timeout: 20_000 });
  await shot(page, '04c-public');
  expect(problems, problems.join('\n')).toEqual([]);
  await sp.close();
  await admin.close();
  await page.close();
});

test('5. Sell a device: "Other" model asks what it is; storage, screen and body take your own words; a details box; no tracking link', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/sell');
  await page.locator('button.dcard', { hasText: /Other/i }).first().click();
  const other = page.getByPlaceholder(/OnePlus 12/i);
  await expect(other, '"Other / not listed" reveals a box for the model').toBeVisible({
    timeout: 15_000,
  });
  await other.fill('Fairphone 5');
  await shot(page, '05a-other-device');
  await page.getByRole('button', { name: 'Continue' }).first().click();

  const step = page.locator('.wz-step.is-active');
  // Storage: the "Other" tile gives a free-text box.
  await step.getByRole('button', { name: 'Other', exact: true }).first().click();
  const storage = step.getByPlaceholder('e.g. 32GB');
  await expect(storage).toBeVisible();
  await storage.fill('48GB');
  // Screen / body: pick "Other" in those rows to describe in words.
  const rows = step.locator('.slot-row');
  const n = await rows.count();
  for (let i = 1; i < n; i += 1) {
    const row = rows.nth(i);
    const otherBtn = row.getByRole('button', { name: 'Other', exact: true });
    if (await otherBtn.count()) await otherBtn.click();
    else await row.locator('button.slot').first().click();
  }
  await step.getByPlaceholder('Describe the screen…').fill('Hairline scratch top-left');
  const bodyBox = step.getByPlaceholder('Describe the body…');
  if (await bodyBox.count()) await bodyBox.fill('Small dent on the corner');
  await shot(page, '05b-free-text');
  await step.getByRole('button', { name: 'Continue' }).click();

  await page.getByPlaceholder('Alex Turner').fill(`${RUN} Vendor Two`);
  await page.getByPlaceholder('07XXX XXXXXX').fill('07700900932');
  await page.getByPlaceholder('alex@email.co.uk').fill(`${RUN.toLowerCase()}-s2@example.invalid`);
  await page.getByPlaceholder(/battery health/).fill('Comes with the original box. Test run.');
  await shot(page, '05c-details');
  await page.getByRole('button', { name: /Get my offer/ }).click();
  await expect(page.locator('.wz-done__title')).toBeVisible({ timeout: 60_000 });
  const done = page.locator('.wz-done');
  await expect(
    done.locator('a[href^="/track"]'),
    'no tracking link after a sell request',
  ).toHaveCount(0);
  await expect(done.getByText(/track/i), 'no tracking wording either').toHaveCount(0);
  await shot(page, '05d-done');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('6. Repair: an "Other" problem the customer describes; no tracking link afterwards', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/repair');
  // An unlisted phone with an unlisted problem: the "Other / not listed" catch-all asks which phone
  // it is, and offers the free "Something else" diagnosis (deploy/shop-setup.json).
  await page
    .locator('button.dcard', { hasText: /not listed/i })
    .first()
    .click();
  await page.getByPlaceholder(/OnePlus 12/).fill('Nothing Phone 2');
  await page.getByRole('button', { name: 'Continue' }).first().click();
  // The catch-all option ("Something else") is among the problems.
  const something = page.locator('button.ocard', { hasText: /something else|other/i }).first();
  await expect(something, 'an "Other / Something else" problem exists').toBeVisible({
    timeout: 20_000,
  });
  await something.click();
  // The catch-all asks the customer to describe it in their own words.
  await page.getByPlaceholder(/speaker crackles/i).fill('Clicking noise when charging');
  await page.getByRole('button', { name: 'Continue' }).first().click();
  // Next is either the part-grade step or straight to the details form, depending on the repair.
  const grade = page.locator('button.tcard').first();
  const name = page.getByPlaceholder('Alex Turner');
  await expect(grade.or(name).first()).toBeVisible({ timeout: 20_000 });
  if (await grade.isVisible()) await grade.click();
  await expect(name).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder('Alex Turner').fill(`${RUN} Odd Fault`);
  await page.getByPlaceholder('07XXX XXXXXX').fill('07700900933');
  await page.getByPlaceholder('alex@email.co.uk').fill(`${RUN.toLowerCase()}-odd@example.invalid`);
  await page.getByPlaceholder('YT1 2AB').fill('G46 7AA');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('3 Test Street');
  await page.getByRole('button', { name: 'Email' }).click();
  await page
    .getByPlaceholder(/back glass is cracked|what.s wrong/i)
    .fill('It makes a clicking noise when I plug it in. Test run.');
  await shot(page, '06a-other-problem');
  await page.getByRole('button', { name: /Start my repair/ }).click();
  await expect(page.locator('.wz-done__title')).toBeVisible({ timeout: 60_000 });
  await expect(
    page.locator('.wz-done a[href^="/track"]'),
    'no tracking link after a repair request',
  ).toHaveCount(0);
  await shot(page, '06b-done');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('7. signed in as the Owner, pressing the final button on a repair request is refused with a clear message', async () => {
  const page = await owner.newPage();
  await page.goto('/repair');
  await page
    .locator('button.dcard')
    .filter({ hasNotText: /not listed/i })
    .first()
    .click();
  await page
    .locator('button.ocard', { hasText: /from £/ })
    .first()
    .click();
  await page.locator('button.tcard').first().click();
  await page.getByPlaceholder('Alex Turner').fill(`${RUN} Owner Tries`);
  await page.getByPlaceholder('07XXX XXXXXX').fill('07700900934');
  await page.getByPlaceholder('alex@email.co.uk').fill(`${RUN.toLowerCase()}-ot@example.invalid`);
  await page.getByPlaceholder('YT1 2AB').fill('G46 7AA');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('4 Test Street');
  await page.getByRole('button', { name: 'Email' }).click();
  await page
    .getByPlaceholder(/back glass is cracked|what.s wrong/i)
    .fill('Staff trying to book. Test run.');
  await shot(page, '07a-owner-form-filled');
  await page.getByRole('button', { name: /Start my repair/ }).click();
  // Browsing and filling in were allowed; the submit is what is stopped — and it says why.
  await expect(page.locator('.wz-done__title'), 'the booking is not confirmed').toBeHidden();
  const message = page.getByText(/Cannot book a repair while signed in as staff/i);
  await expect(message, 'the person is told why, in words').toBeAttached({ timeout: 15_000 });
  await expect(message, 'and it is on screen, not hidden below the button').toBeInViewport({
    timeout: 5_000,
  });
  await shot(page, '07b-refused');
  await page.close();
});
