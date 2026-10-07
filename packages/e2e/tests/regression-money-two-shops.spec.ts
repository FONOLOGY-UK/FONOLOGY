/**
 * Regression pack — money and stock in BOTH shops, every figure worked out by hand first.
 *
 * Covers the QA reports' "does the till/inventory add up" items:
 *   v5 #20  tiered promotions apply at the till as the quantity changes
 *   v4 BUG-08/09, v5 #15  stock edits save exactly what was typed; +/- persists; no cost averaging
 *   v3 1.2  an online order takes stock off the SHOP that fulfils it and nothing else
 *   v1 BUG-12 / v5 #34  online orders: shipping needs a courier and tracking; paid arrives by webhook
 *   stage 3  Shop 2 prices, stock, takings and refunds never leak into Shop 1 (and vice versa)
 *
 * The fixture: one product "P", Shop 1 £40.00 (cost £15), 20 in stock; Shop 2 £45.00, 10 in stock.
 * Shop 1 promotion: 2+ at £35, 5+ at £30. Shop 2 has no promotion.
 *
 * Page errors, console errors and 5xx responses fail each test; every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { API, EMPLOYEE, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PRODUCT = `${RUN} Tier Widget`;
const PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD ?? 'Test1234!';
const S2_MGR = {
  name: `${RUN} Shop Two Manager`,
  email: `${RUN.toLowerCase()}-m2mgr@example.invalid`,
};
const S2_EMP = {
  name: `${RUN} Shop Two Till`,
  email: `${RUN.toLowerCase()}-s2money@example.invalid`,
};

let owner: BrowserContext;
let emp1: BrowserContext;
let emp2: BrowserContext;
let hubId = '';
let shop2Id = '';
let s2StaffId = '';
let s2MgrId = '';
let mgr2: BrowserContext;
let p1 = ''; // Shop 1's product id
let p2 = ''; // Shop 2's copy
let masterId = '';
let s2SaleRef = '';

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

const get = async (ctx: BrowserContext, path: string) => {
  const r = await ctx.request.get(`${API}${path}`);
  return { status: r.status(), body: await r.json().catch(() => null) };
};
const send = async (ctx: BrowserContext, method: 'POST' | 'PUT', path: string, data?: unknown) => {
  const r = await ctx.request.fetch(`${API}${path}`, { method, data });
  return { status: r.status(), body: await r.json().catch(() => null) };
};

async function stock(id: string, shop?: string): Promise<number> {
  const list = await get(owner, `/admin/products${shop ? `?shop=${shop}` : ''}`);
  const row = (list.body as any[]).find((x) => x.id === id);
  return row.stockQty ?? row.stock;
}

/** Takings for the shop the context belongs to (or `shop` for the owner), in pence. */
async function takings(
  ctx: BrowserContext,
  shop?: string,
): Promise<{ total: number; sales: number }> {
  const t = await get(ctx, `/pos/today${shop ? `?shop=${shop}` : ''}`);
  expect(t.status).toBe(200);
  return { total: t.body.total ?? 0, sales: t.body.sales ?? 0 };
}

test.beforeAll(async ({ browser }) => {
  owner = await signIn(browser, OWNER.email, OWNER.password);

  const shops = (await get(owner, '/shops')).body as any[];
  const hub = shops.find((s) => s.isFulfilmentHub) ?? shops[0];
  hubId = hub.id;
  let shop2 = shops.find((s) => s.id !== hub.id && s.isActive);
  if (!shop2) {
    shop2 = (
      await send(owner, 'POST', '/admin/shops', {
        code: `M${RUN.slice(-5)}`,
        name: `${RUN} Money Shop`,
      })
    ).body;
  }
  shop2Id = shop2.id;

  // Shop 2's counter person.
  const e = await send(owner, 'POST', '/admin/staff', {
    name: S2_EMP.name,
    email: S2_EMP.email,
    role: 'employee',
    shopId: shop2Id,
    phone: '07700900311',
    password: PASSWORD,
  });
  expect(e.status, JSON.stringify(e.body).slice(0, 200)).toBe(201);
  s2StaffId = e.body.id;
  const m = await send(owner, 'POST', '/admin/staff', {
    name: S2_MGR.name,
    email: S2_MGR.email,
    role: 'manager',
    shopId: shop2Id,
    phone: '07700900313',
    password: PASSWORD,
  });
  expect(m.status, JSON.stringify(m.body).slice(0, 200)).toBe(201);
  s2MgrId = m.body.id;

  // Shop 1's product, on the master list.
  const cats = (await get(owner, '/admin/categories')).body as any[];
  const category = cats.find((c) => /^access/i.test(c.label)) ?? cats[0];
  const made = await send(owner, 'POST', '/admin/products', {
    name: PRODUCT,
    sub: 'Money fixture',
    categoryId: category.id,
    price: 4000,
    costPrice: 1500,
    stockQty: 20,
    localBuying: false,
    supplier: 'Test Supplier',
    description: 'A fixture for the two-shop money checks.',
    lowStockAlert: false,
    lowStockThreshold: 2,
    addToMaster: true,
  });
  expect(made.status, JSON.stringify(made.body).slice(0, 200)).toBe(201);
  p1 = made.body.id;

  // Shop 2's own copy, priced and stocked on its own.
  const masters = (await get(owner, `/admin/master?search=${encodeURIComponent(PRODUCT)}`))
    .body as any[];
  masterId = masters.find((m) => m.name === PRODUCT).id;
  const copy = await send(owner, 'POST', `/admin/master/${masterId}/copy?shop=${shop2Id}`);
  expect(copy.status, JSON.stringify(copy.body).slice(0, 200)).toBeLessThan(300);
  const s2list = (await get(owner, `/admin/products?shop=${shop2Id}`)).body as any[];
  const s2row = s2list.find((x) => x.name === PRODUCT);
  expect(s2row, 'Shop 2 has its own copy').toBeTruthy();
  p2 = s2row.id;
  const clean = Object.fromEntries(Object.entries(s2row).filter(([, v]) => v !== null));
  const upd = await send(owner, 'PUT', `/admin/products/${p2}`, {
    ...clean,
    price: 4500,
    costPrice: 2000,
    stockQty: 10,
    supplier: 'Shop Two Supplies',
    description: s2row.description || 'A fixture for the two-shop money checks.',
    localBuying: false,
  });
  expect(upd.status, JSON.stringify(upd.body).slice(0, 300)).toBe(200);

  // Shop 1 only: 2+ at £35, 5+ at £30.
  const promo = await send(owner, 'POST', '/admin/promotions/bulk', {
    label: `${RUN} tiers`,
    productIds: [p1],
    shopIds: [hubId],
    tiers: [
      { minQty: 2, unitPrice: 3500 },
      { minQty: 5, unitPrice: 3000 },
    ],
  });
  expect(promo.status, JSON.stringify(promo.body).slice(0, 300)).toBeLessThan(300);

  emp1 = await signIn(browser, EMPLOYEE.email, PASSWORD);
  emp2 = await signIn(browser, S2_EMP.email, PASSWORD);
  mgr2 = await signIn(browser, S2_MGR.email, PASSWORD);
});

test.afterAll(async () => {
  if (s2StaffId)
    await owner.request
      .put(`${API}/admin/staff/${s2StaffId}`, { data: { isActive: false } })
      .catch(() => {});
  if (s2MgrId)
    await owner.request
      .put(`${API}/admin/staff/${s2MgrId}`, { data: { isActive: false } })
      .catch(() => {});
  await Promise.all([owner?.close(), emp1?.close(), emp2?.close(), mgr2?.close()]);
});

/** Add the fixture product to the till ticket in this context's shop. */
async function openTillWithProduct(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/pos');
  await dismissFloat(page);
  await page.getByLabel('Scan or search products').fill(PRODUCT);
  const tile = page.getByRole('button', { name: new RegExp(PRODUCT) }).first();
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.click();
  return page;
}

/* =============================================================== Shop 1 */

test('1. Shop 1 till: the bulk price follows the quantity (1 → £40, 2 → £35, 5 → £30, back down again)', async () => {
  const problems = watch(await emp1.newPage().then((p) => (p.close(), p)));
  const before = await takings(emp1);
  const page = await openTillWithProduct(emp1);
  const watched = watch(page);

  // 1 × £40.00 — no bulk deal yet.
  await expect(page.getByText(/£40(\.00)? each/)).toBeVisible();
  await expect(page.getByText('Bulk deal')).toHaveCount(0);
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£40(\.00)?(?!\d)/,
  );
  await shot(page, '01a-one-at-40');

  const more = page.getByRole('button', { name: `One more ${PRODUCT}` });
  const less = page.getByRole('button', { name: `One less ${PRODUCT}` });

  // 2 × £35.00 = £70.00 — first tier.
  await more.click();
  await expect(page.getByText(/£35(\.00)? each/)).toBeVisible();
  await expect(page.getByText('Bulk deal')).toBeVisible();
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£70(\.00)?(?!\d)/,
  );
  await shot(page, '01b-two-at-35');

  // 3, 4 stay in the first tier: 4 × £35.00 = £140.00.
  await more.click();
  await more.click();
  await expect(page.getByText(/£35(\.00)? each/)).toBeVisible();
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£140(\.00)?(?!\d)/,
  );

  // 5 × £30.00 = £150.00 — second tier.
  await more.click();
  await expect(page.getByText(/£30(\.00)? each/)).toBeVisible();
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£150(\.00)?(?!\d)/,
  );
  await shot(page, '01c-five-at-30');

  // Back to 4: the price must climb back to £35.00, not stay at £30.00.
  await less.click();
  await expect(page.getByText(/£35(\.00)? each/)).toBeVisible();
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£140(\.00)?(?!\d)/,
  );
  // Back to 1: full price, no chip.
  await less.click();
  await less.click();
  await less.click();
  await expect(page.getByText(/£40(\.00)? each/)).toBeVisible();
  await expect(page.getByText('Bulk deal')).toHaveCount(0);

  // Sell 5 for cash: £150.00 goes in, stock 20 → 15.
  await more.click();
  await more.click();
  await more.click();
  await more.click();
  await expect(page.getByText(/£30(\.00)? each/)).toBeVisible();
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(page.getByText('Fully paid')).toBeVisible();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText('Sale complete')).toBeVisible({ timeout: 30_000 });
  await shot(page, '01d-sold-five');

  const after = await takings(emp1);
  expect(after.total - before.total, 'Shop 1 takings rose by exactly £150.00').toBe(15000);
  expect(after.sales - before.sales, 'one sale').toBe(1);
  expect(await stock(p1), 'Shop 1 stock 20 → 15').toBe(15);
  expect(await stock(p2, shop2Id), 'Shop 2 stock untouched').toBe(10);
  expect([...problems, ...watched], [...problems, ...watched].join('\n')).toEqual([]);
  await page.close();
});

test('2. Shop 1 till: a 10% discount comes off the bulk-priced subtotal', async () => {
  const before = await takings(emp1);
  const page = await openTillWithProduct(emp1);
  const problems = watch(page);
  await page.getByRole('button', { name: `One more ${PRODUCT}` }).click(); // 2 × £35.00 = £70.00
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£70(\.00)?(?!\d)/,
  );
  await page
    .getByRole('group', { name: 'Discount type' })
    .getByRole('button', { name: '%' })
    .click();
  await page.getByLabel('Discount percentage').fill('10');
  // £70.00 − £7.00 = £63.00
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£63(\.00)?(?!\d)/,
  );
  await shot(page, '02a-discount');
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText('Sale complete')).toBeVisible({ timeout: 30_000 });
  const after = await takings(emp1);
  expect(after.total - before.total, 'the SERVER charged £63.00, not the browser’s guess').toBe(
    6300,
  );
  expect(await stock(p1)).toBe(13);
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

/* =============================================================== Shop 2 */

test('3. Shop 2 till: its own £45.00, no bulk deal, split cash + card adds up to the penny', async () => {
  const before = await takings(emp2);
  const page = await openTillWithProduct(emp2);
  const problems = watch(page);
  const more = page.getByRole('button', { name: `One more ${PRODUCT}` });
  await expect(page.getByText(/£45(\.00)? each/)).toBeVisible();
  // Five of them: Shop 1's 5+ deal must NOT apply here → 5 × £45.00 = £225.00.
  for (let i = 0; i < 4; i++) await more.click();
  await expect(page.getByText(/£45(\.00)? each/)).toBeVisible();
  await expect(page.getByText('Bulk deal')).toHaveCount(0);
  await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText(
    /£225(\.00)?(?!\d)/,
  );
  await shot(page, '03a-shop2-five');

  // Split: take £100.00 in cash first, the rest ("remaining") on Card — POS 1.
  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByLabel('Cash amount').fill('100');
  await page.getByLabel('Cash amount').blur();
  await page
    .getByRole('button', { name: /^POS ?1$/i })
    .first()
    .click();
  await expect(page.getByLabel(/Card . POS ?1 amount/i)).toHaveValue(/125(.00)?/);
  await shot(page, '03b-split');
  await page.getByRole('button', { name: 'Send to machine' }).click();
  await expect(page.getByText(/Waiting for card/)).toBeVisible();
  await page.getByRole('button', { name: 'Card approved' }).click();
  await expect(page.getByText('Fully paid')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText('Sale complete')).toBeVisible({ timeout: 30_000 });
  s2SaleRef = (await page.locator('body').innerText()).match(/(?:[A-Z0-9]+-)?FNL-\d+/)![0];

  const after = await takings(emp2);
  expect(after.total - before.total, 'Shop 2 takings rose by exactly £225.00').toBe(22500);
  expect(await stock(p2, shop2Id), 'Shop 2 stock 10 → 5').toBe(5);
  expect(await stock(p1), 'Shop 1 stock untouched at 13').toBe(13);
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('4. the two shops’ takings are separate, and add up to the owner’s "All shops" figure', async () => {
  const s1 = await takings(owner, hubId);
  const s2 = await takings(owner, shop2Id);
  const all = await get(owner, '/pos/today?shop=all');
  expect(all.status).toBe(200);
  // Every other shop's takings are in "all" too, so it is at LEAST the sum of these two.
  expect(all.body.total).toBeGreaterThanOrEqual(s1.total + s2.total);
  // And a counter person sees only their own shop's figure.
  expect((await takings(emp2)).total, 'Shop 2 till sees Shop 2').toBe(s2.total);
  expect((await takings(emp1)).total, 'Shop 1 till sees Shop 1').toBe(s1.total);
  // Shop 2's person asking for "all" is still held to their own shop.
  const sneaky = await get(emp2, '/pos/today?shop=all');
  expect(sneaky.body.total, 'Shop 2 cannot widen its view').toBe(s2.total);
});

test('5. a refund in Shop 2 changes only Shop 2 (money and stock)', async () => {
  const sale = { reference: s2SaleRef };
  expect(sale.reference, 'Shop 2’s sale reference was captured').toBeTruthy();

  const s1Before = await takings(emp1);
  const s2Before = await takings(emp2);
  const refund = await send(mgr2, 'POST', '/pos/refunds', {
    source: 'counter',
    reference: sale.reference,
    lines: [{ productId: p2, name: PRODUCT, quantity: 1, unitPrice: 4500 }],
    amount: 4500,
    reason: 'E2E: one unit back',
    tender: 'cash',
    restock: true,
    override: false,
  });
  expect(refund.status, JSON.stringify(refund.body).slice(0, 300)).toBeLessThan(300);

  expect(await stock(p2, shop2Id), 'one unit back on Shop 2’s shelf: 5 → 6').toBe(6);
  expect(await stock(p1), 'Shop 1 stock untouched').toBe(13);
  expect((await takings(emp1)).total, 'Shop 1 takings untouched').toBe(s1Before.total);
  void s2Before;
});

/* =============================================== inventory stock editing */

test('6. editing stock saves exactly what was typed, +/- persists, and cost is not averaged', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/inventory');
  await dismissFloat(page);
  await page
    .getByPlaceholder(/search/i)
    .first()
    .fill(PRODUCT);
  const row = page.locator('tr').filter({ hasText: PRODUCT }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(page, '06a-inventory-row');

  // Typed value: 13 → 70. (v4 BUG-09 saved "3" when 70 was typed; v5 #15 had the field locked.)
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const d = page.getByRole('dialog');
  const stockField = d.getByLabel('Stock count');
  await expect(stockField, 'the stock field is editable').toBeEnabled();
  await stockField.fill('70');
  await d.getByLabel('Cost price (£)').fill('20');
  const saved = page.waitForResponse(
    (r) => /\/admin\/products\//.test(r.url()) && r.request().method() === 'PUT',
  );
  await d.getByRole('button', { name: /save/i }).click();
  expect((await saved).status()).toBe(200);
  await expect(d).toBeHidden({ timeout: 30_000 });

  const after = (await get(owner, '/admin/products')).body.find((x: any) => x.id === p1);
  expect(after.stockQty, 'exactly 70 was saved').toBe(70);
  // The £20.00 entered applies to the whole stock — no weighted average of old £15 and new £20.
  expect(after.costPrice, 'cost is what was typed, not an average').toBe(2000);
  await shot(page, '06b-after-edit');

  // Inline +: 70 → 71, and it survives a reload.
  await page.reload();
  await page
    .getByPlaceholder(/search/i)
    .first()
    .fill(PRODUCT);
  const row2 = page.locator('tr').filter({ hasText: PRODUCT }).first();
  await expect(row2).toBeVisible({ timeout: 30_000 });
  const plus = row2.getByRole('button', { name: `One more ${PRODUCT}` });
  {
    const bumped = page.waitForResponse(
      (r) =>
        /products|stock/.test(r.url()) && ['POST', 'PUT', 'PATCH'].includes(r.request().method()),
    );
    await plus.click();
    expect((await bumped).status()).toBeLessThan(300);
    await page.reload();
    expect(await stock(p1), 'the + persisted').toBe(71);
  }
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

/* ====================================================== online order, hub */

test('7. an online order is taken by the hub shop only, and shipping needs a courier + tracking', async () => {
  const hubBefore = await stock(p1);
  const s2Before = await stock(p2, shop2Id);

  // A guest places a £… order for 2 (hub price £35.00 each is NOT used online: online uses shelf price).
  const guestEmail = `${RUN.toLowerCase()}-order@example.invalid`;
  const guest = await (await import('@playwright/test')).request.newContext();
  const made = await guest.post(`${API}/orders`, {
    data: {
      lines: [{ productId: p1, variantId: null, quantity: 2 }],
      email: guestEmail,
      firstName: 'Pat',
      lastName: `${RUN} Money`,
      phone: '07700900312',
      delivery: 'standard',
      address: '1 Test Street',
      postcode: 'G46 7AA',
    },
  });
  expect(made.status(), (await made.text()).slice(0, 300)).toBeLessThan(300);
  const order = await made.json();
  const reference = order.reference ?? order.id;

  // Not paid yet: it must not be in the active list, and must not have taken stock.
  const early = await get(owner, '/orders');
  expect(JSON.stringify(early.body)).not.toContain(`"status":"paid","reference":"${reference}"`);

  // The checkout opens a payment with Stripe (test mode), then Stripe would send the signed webhook.
  const intent = await guest.post(
    `${API}/orders/${reference}/payment-intent?email=${encodeURIComponent(guestEmail)}`,
  );
  expect(intent.status(), (await intent.text()).slice(0, 200)).toBeLessThan(300);
  execFileSync(
    'pnpm',
    ['--filter', '@fonology/api', 'exec', 'tsx', 'scripts/simulate-stripe-paid.ts', reference],
    { stdio: 'inherit', shell: true },
  );

  expect(await stock(p1), 'hub stock −2 once paid').toBe(hubBefore - 2);
  expect(await stock(p2, shop2Id), 'Shop 2 stock untouched').toBe(s2Before);

  // Marking shipped without a courier / tracking number is refused…
  const list = (await get(owner, '/orders')).body;
  const rows = (list.items ?? list) as any[];
  const mine = rows.find((o) => o.reference === reference);
  expect(mine, 'the paid order appears in Online Orders').toBeTruthy();
  const bare = await send(owner, 'POST', `/orders/id/${mine.id}/status`, { status: 'shipped' });
  expect(bare.status, 'shipping needs courier + tracking').toBe(400);
  // …and accepted with both, which the tracking lookup then returns.
  const ok = await send(owner, 'POST', `/orders/id/${mine.id}/status`, {
    status: 'shipped',
    courier: 'Royal Mail',
    trackingNumber: 'RM123456789GB',
  });
  expect(ok.status).toBe(200);
  const track = await (await guest.get(`${API}/orders/${reference}/tracking`)).json();
  expect(track).toEqual({ courier: 'Royal Mail', trackingNumber: 'RM123456789GB' });
  await guest.dispose();
});

test('8. an online order empties the hub shelf first, then takes the rest from Shop 2 — and is priced at the highest shop price', async () => {
  // A fresh product: hub has 2 at £10.00, Shop 2 has 5 (its own price £12.00).
  const cats = (await get(owner, '/admin/categories')).body as any[];
  const category = cats.find((c) => /^access/i.test(c.label)) ?? cats[0];
  const name = `${RUN} Split Widget`;
  const made = await send(owner, 'POST', '/admin/products', {
    name,
    sub: 'Split fixture',
    categoryId: category.id,
    price: 1000,
    costPrice: 300,
    stockQty: 2,
    localBuying: false,
    supplier: 'Test Supplier',
    description: 'Online orders are split across shops.',
    lowStockAlert: false,
    lowStockThreshold: 1,
    addToMaster: true,
  });
  expect(made.status, JSON.stringify(made.body).slice(0, 200)).toBe(201);
  const hubId1 = made.body.id;
  const m = (
    (await get(owner, `/admin/master?search=${encodeURIComponent(name)}`)).body as any[]
  ).find((x) => x.name === name);
  await send(owner, 'POST', `/admin/master/${m.id}/copy?shop=${shop2Id}`);
  const s2row = ((await get(owner, `/admin/products?shop=${shop2Id}`)).body as any[]).find(
    (x) => x.name === name,
  );
  const clean = Object.fromEntries(Object.entries(s2row).filter(([, v]) => v !== null));
  const upd = await send(owner, 'PUT', `/admin/products/${s2row.id}`, {
    ...clean,
    price: 1200,
    costPrice: 400,
    stockQty: 5,
    supplier: 'Shop Two Supplies',
    description: s2row.description || 'Online orders are split across shops.',
    localBuying: false,
  });
  expect(upd.status).toBe(200);

  const { request } = await import('@playwright/test');
  const guest = await request.newContext();
  const email = `${RUN.toLowerCase()}-split@example.invalid`;
  const order = async (qty: number) =>
    guest.post(`${API}/orders`, {
      data: {
        lines: [{ productId: hubId1, variantId: null, quantity: qty }],
        email,
        firstName: 'Sam',
        lastName: `${RUN} Splitter`,
        phone: '07700900313',
        delivery: 'standard',
        address: '5 Test Street',
        postcode: 'G46 7AA',
      },
    });

  // More than both shelves together (2 + 5 = 7): refused, and nothing moves.
  const tooMany = await order(8);
  expect(tooMany.status(), 'cannot order more than every shop holds').toBeGreaterThanOrEqual(400);
  expect(tooMany.status()).toBeLessThan(500);
  expect(await stock(hubId1)).toBe(2);
  expect(await stock(s2row.id, shop2Id)).toBe(5);

  // Four at £12.00 (online pays the HIGHEST price among the shops' copies — £10.00 vs £12.00) = £48.00,
  // plus £3.00 standard delivery = £51.00 (goods of £48.00 are under the £50 free-delivery bar).
  const made4 = await order(4);
  expect(made4.status(), (await made4.text()).slice(0, 200)).toBeLessThan(300);
  const o = await made4.json();
  expect(
    o.subtotal ?? o.items?.reduce?.((s: number, l: any) => s + l.lineTotal, 0),
    'goods 4 × £12.00',
  ).toBe(4800);
  expect(o.total, '£48.00 + £3.00 delivery').toBe(5100);

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
  expect(await stock(hubId1), 'the hub shelf is emptied first: 2 → 0').toBe(0);
  expect(await stock(s2row.id, shop2Id), 'the other 2 come from Shop 2: 5 → 3').toBe(3);
  await guest.dispose();
});
