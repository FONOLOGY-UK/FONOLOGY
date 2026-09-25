/**
 * The 14 items of the September 2026 POS/Admin change request, in a real
 * Chromium, against the DEPLOYED site.
 *
 * Fixtures are created through the API (fast, deterministic); every item is
 * then exercised and asserted THROUGH THE UI — what a person at the till or
 * in the admin actually sees and clicks. Every fixture is named with the run
 * tag, and global-teardown removes exactly those rows afterwards.
 *
 * WHY THIS SUITE EXISTS
 *
 * Its first run found two real bugs that lint, typecheck, 488 pgTAP
 * assertions and the API-level scripts had all passed straight through:
 *
 *   item 11  Editing a handset ERASED its IMEI. The edit form opened with the
 *            field blank and the save sent imei:null. The API stored and
 *            returned the IMEI perfectly — the loss was entirely in the form.
 *   item 4   After a PIN switch the till had NOTHING TO SELL. The block that
 *            keeps PIN sessions out of Admin also refused the till's own
 *            catalogue, which lives under /admin.
 *
 * The second one passed this suite's own first draft too: the item 4 test
 * asserted the catalogue 403 as the security property. It was caught by
 * looking at the screenshot. Hence screenshots on every test, and the rule
 * worth keeping: a green run is not proof until the pictures agree.
 */
import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { API, EMPLOYEE, OWNER, runTag } from '../lib/env';

const RUN = runTag();

let ctx: BrowserContext;
let page: Page;
let miscSaleRef: string | null = null;

type ApiResult = { status: number; body: any };

async function api(method: string, path: string, data?: unknown): Promise<ApiResult> {
  const r = await page.request.fetch(`${API}${path}`, { method, data, timeout: 120_000 });
  let body: any;
  try {
    body = await r.json();
  } catch {
    body = await r.text();
  }
  return { status: r.status(), body };
}

async function publicApi(): Promise<APIRequestContext> {
  return pwRequest.newContext();
}

/** A named screenshot, attached to the HTML report. */
async function shot(name: string, target: { screenshot: Page['screenshot'] } = page) {
  const file = test.info().outputPath(`${name}.png`);
  await target.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

/** The till greets a new session with a float prompt. Get it out of the way. */
async function dismissFloatPrompt() {
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.isVisible({ timeout: 4_000 }).catch(() => false)) await notNow.click();
}

function ean13Ok(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

async function newJob(extra: Record<string, unknown>) {
  const j = await api('POST', '/jobs', {
    source: 'walk_in',
    phone: '07700900600',
    deviceDescription: 'Pixel 8',
    problemDescription: 'Battery swap',
    ...extra,
  });
  expect(j.status, `job created: ${JSON.stringify(j.body).slice(0, 120)}`).toBe(201);
  return j.body as { id: string; reference: string };
}

/** Board cards show reference, device and problem — not the customer's name. */
async function openJobSheet(reference: string) {
  await page.goto('/admin/jobs');
  await page.getByText(reference, { exact: true }).first().click();
}

/** Rows open for editing from their ⋮ menu, not by clicking the name. */
async function openProductEditor(name: string) {
  await page.goto('/admin/inventory');
  const row = page.locator('tr').filter({ hasText: name });
  await row.getByRole('button').last().click();
  await page
    .getByRole('menuitem', { name: 'Edit' })
    .or(page.getByRole('button', { name: 'Edit', exact: true }))
    .first()
    .click();
  return page.getByRole('dialog');
}

async function repairFixtures() {
  const pub = await publicApi();
  const devices = await (await pub.get(`${API}/repair/devices`)).json();
  const types = await (await pub.get(`${API}/repair/types`)).json();
  await pub.dispose();
  const priced = types.find((t: { base?: unknown }) => t.base);
  expect(priced, 'staging needs at least one priced repair type').toBeTruthy();
  return { device: devices[0], priced };
}

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  // Through the site's own /api-proxy, so the cookies land on the web origin
  // exactly as a real sign-in leaves them. No password typed into a form.
  const r = await ctx.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 });
  expect(r.status(), `sign in as ${OWNER.email}`).toBe(200);
  page = await ctx.newPage();
});

test.afterAll(async () => {
  await ctx?.close();
});

/* ------------------------------------------------------------------ 1 */
test('Item 1 — bench label carries the note and walk-in/mail-in', async () => {
  const job = await newJob({ customerName: `${RUN} Label`, notes: `${RUN}-NOTE passcode 1234` });

  await openJobSheet(job.reference);
  const label = page.locator('.print-area').filter({ hasText: `${RUN}-NOTE` });
  await expect(label).toContainText('WALK-IN — COLLECT IN SHOP');
  await expect(label).toContainText(`${RUN}-NOTE passcode 1234`);

  // The label is print-only on screen (`hidden print:block`). Switch the
  // browser to print media and photograph exactly what the printer gets.
  await page.emulateMedia({ media: 'print' });
  await shot('01-label-as-printed', label);
  await page.emulateMedia({ media: 'screen' });
});

/* ------------------------------------------------------------------ 2 */
test('Item 2 — a repair request goes to the bench without re-typing', async () => {
  const { device, priced } = await repairFixtures();
  const pub = await publicApi();
  const b = await pub.post(`${API}/repair/bookings`, {
    data: {
      deviceId: device.id,
      repairId: priced.id,
      tierId: 'original',
      name: `${RUN} Convert`,
      phone: '07700900602',
      email: `${RUN.toLowerCase()}@example.invalid`,
      address: '1 Test Street',
      postcode: 'SW1A 1AA',
      preferredContact: 'email',
      notes: 'Cracked top-left',
    },
    timeout: 120_000,
  });
  expect(b.status(), `booking: ${(await b.text()).slice(0, 120)}`).toBe(201);
  await pub.dispose();

  await page.goto('/admin/submissions');
  await page
    .locator('tr')
    .filter({ hasText: `${RUN} Convert` })
    .getByRole('button', { name: 'Send to Jobs' })
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Everything the customer gave is shown, not asked for again.
  await expect(dialog).toContainText(`${RUN} Convert`);
  await shot('02a-send-to-jobs-dialog');

  await dialog
    .getByRole('textbox')
    .or(dialog.locator('input[type=number], input[inputmode=decimal]'))
    .first()
    .fill('150');
  const conv = page.waitForResponse(
    (r) => r.url().includes('/convert') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Send to the bench' }).click();
  const res = await conv;
  expect([200, 201], `convert: ${(await res.text()).slice(0, 160)}`).toContain(res.status());
  const job = (await res.json()) as { reference: string };

  await expect(page.getByText(job.reference).first()).toBeVisible();
  await shot('02b-request-shows-its-job');

  // The mail-in half of item 1: a converted request is a mail-in job.
  await openJobSheet(job.reference);
  await expect(page.locator('.print-area').filter({ hasText: job.reference })).toContainText(
    'MAIL-IN — POST BACK',
  );
});

/* ------------------------------------------------------------------ 3 */
test('Item 3 — generate a barcode for a product with none', async () => {
  await page.goto('/admin/inventory');
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
  const input = dialog.locator('#p-barcode');
  await expect(input).toHaveValue(/^2\d{12}$/);
  const code = await input.inputValue();
  expect(ean13Ok(code), `valid EAN-13 check digit: ${code}`).toBe(true);
  await shot('03-barcode-generated');
  await page.keyboard.press('Escape');
});

/* ------------------------------------------------------------------ 5 */
test('Item 5 — card machine limits: six optional fields that bite', async () => {
  // Whatever staging has configured is put back afterwards, even on failure:
  // a limit left behind would refuse real card payments on staging.
  const before = (await api('GET', '/admin/settings')).body?.card1DailyLimit ?? null;
  const restore = before == null ? '' : (before / 100).toFixed(2);

  await page.goto('/admin/settings');
  for (const id of [
    'card1Daily',
    'card1Weekly',
    'card1Monthly',
    'card2Daily',
    'card2Weekly',
    'card2Monthly',
  ]) {
    await expect(page.locator(`#set-${id}Limit`)).toBeVisible();
    await expect(page.locator(`#set-${id}Limit`)).toHaveAttribute('placeholder', 'No limit');
  }
  const form = page.locator('form').filter({ has: page.locator('#set-card1DailyLimit') });
  const save = async () => {
    const done = page.waitForResponse(
      (r) => r.url().includes('/admin/settings') && r.request().method() === 'PATCH',
    );
    await form.locator('button[type=submit]').click();
    expect((await done).status()).toBe(200);
  };

  try {
    await page.locator('#set-card1DailyLimit').fill('50');
    await save();
    await shot('05-limit-set');

    const over = await api('POST', '/pos/card-limits/check', { tender: 'pos1', amount: 6000 });
    expect(over.body.allowed, JSON.stringify(over.body)).toBe(false);
    const card2 = await api('POST', '/pos/card-limits/check', { tender: 'pos2', amount: 6000 });
    expect(card2.body.allowed, 'Card 2 is unaffected').toBe(true);
  } finally {
    await page.reload();
    await page.locator('#set-card1DailyLimit').fill(restore);
    await save();
  }
});

/* ------------------------------------------------------------------ 6 */
test('Item 6 — a quote below the shop price is refused', async () => {
  const { device, priced } = await repairFixtures();

  await page.goto('/admin/jobs');
  await page
    .getByRole('button', { name: /add job/i })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#job-repair-search').fill(`${device.name} ${priced.name}`);
  await dialog
    .getByRole('button', { name: new RegExp(priced.name, 'i') })
    .first()
    .click();
  // The tier button's accessible name carries its price: "Original £100".
  await dialog.getByRole('button', { name: /^Original/ }).click();

  await dialog.getByLabel(/Quote/).fill('1');
  await expect(dialog).toContainText('shop price for this repair');
  await expect(dialog.locator('button[type=submit]')).toBeDisabled();
  await shot('06-quote-under-floor-refused');
  await page.keyboard.press('Escape');
});

/* ------------------------------------------------------------------ 8 */
test('Item 8 — the date presets, and "Last month" means last month', async () => {
  await page.goto('/admin');
  for (const label of [
    'Today',
    'Yesterday',
    '7 days',
    'Last week',
    'This month',
    'Last month',
    '30 days',
    '12 months',
    'Custom',
  ]) {
    await expect(page.getByRole('button', { name: label, exact: true }).first()).toBeVisible();
  }
  const now = new Date();
  const from = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0)).toISOString().slice(0, 10);
  const req = page.waitForRequest(
    (r) =>
      r.url().includes('/reports/analytics') &&
      r.url().includes(`from=${from}`) &&
      r.url().includes(`to=${to}`),
  );
  await page.getByRole('button', { name: 'Last month', exact: true }).first().click();
  await req;
  await shot('08-last-month');
});

/* ------------------------------------------------------------------ 9 */
test('Item 9 — "Customer accepted" works on a quoted trade-in', async () => {
  const pub = await publicApi();
  const sr = await pub.post(`${API}/sell/requests`, {
    data: {
      deviceOther: 'iPhone 13 128GB',
      condition: {
        storage: '128GB',
        screen: 'good',
        body: 'good',
        powersOn: true,
        network: 'unlocked',
        accessories: [],
      },
      name: `${RUN} Seller`,
      phone: '07700900609',
      email: `${RUN.toLowerCase()}-sell@example.invalid`,
      preferredContact: 'email',
    },
    timeout: 120_000,
  });
  expect(sr.status()).toBe(201);
  const request = (await sr.json()) as { id: string };
  await pub.dispose();

  expect((await api('POST', `/sell/requests/${request.id}/quote`, { amount: 10000 })).status).toBe(
    200,
  );

  await page.goto(`/admin/trade-ins/${request.id}`);
  await expect(page.getByText('Quoted', { exact: true }).first()).toBeVisible();
  const res = page.waitForResponse((r) => r.url().includes(`/sell/requests/${request.id}/status`));
  await page.getByRole('button', { name: 'Customer accepted', exact: true }).click();
  expect((await res).status(), 'the click that used to 400').toBe(200);
  await expect(page.getByText(/Currently\s+Customer accepted/)).toBeVisible();
  await shot('09-customer-accepted');
});

/* ----------------------------------------------------------------- 10 */
test('Item 10 — a Misc line at the till, and its cost filled in later', async () => {
  await page.goto('/pos');
  await dismissFloatPrompt();
  await page.getByRole('button', { name: /Misc/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#misc-name').fill(`${RUN} misc cable`);
  await dialog.locator('#misc-price').fill('5');
  await dialog.getByRole('button', { name: 'Add to ticket' }).click();
  await expect(page.getByText(`${RUN} misc cable`).first()).toBeVisible();
  await shot('10a-misc-on-ticket');

  await page.getByRole('button', { name: 'Cash', exact: true }).first().click();
  const sale = page.waitForResponse(
    (r) => /\/pos\/sales?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Complete sale/ }).click();
  const saleRes = await sale;
  expect(saleRes.status(), `sale: ${(await saleRes.text()).slice(0, 160)}`).toBe(201);
  miscSaleRef = ((await saleRes.json()) as { reference: string }).reference;

  await page.goto('/admin/misc-costs');
  const row = page.locator('li').filter({ hasText: `${RUN} misc cable` });
  await expect(row).toBeVisible();
  await shot('10b-waiting-for-a-cost');
  await row.locator('input').first().fill('1.50');
  const cost = page.waitForResponse(
    (r) => r.url().includes('/pos/misc-lines') && r.request().method() !== 'GET',
  );
  await row.getByRole('button', { name: 'Save' }).click();
  expect((await cost).status()).toBeLessThan(300);
  await expect(page.getByText(`${RUN} misc cable`)).toHaveCount(0);
});

/* ----------------------------------------------------------------- 13 */
test('Item 13 — a same-day receipt can be reprinted', async () => {
  expect(miscSaleRef, 'item 10 must have produced a sale').toBeTruthy();
  await page.goto('/pos/day');
  await dismissFloatPrompt();
  const btn = page.getByRole('button', { name: `Reprint the receipt for ${miscSaleRef}` });
  await expect(btn).toBeVisible();
  const enq = page.waitForResponse(
    (r) => r.url().includes('/print/jobs') && r.request().method() === 'POST',
  );
  await btn.click();
  const res = await enq;
  expect(res.status()).toBeLessThan(300);
  expect(((await res.json()) as { status: string }).status).toBe('queued');
  await shot('13-reprint');
});

/* ------------------------------------------------------------------ 7 */
test('Item 7 — End day prints a summary without closing the till', async () => {
  await page.goto('/pos/day');
  await dismissFloatPrompt();
  await expect(page.getByText('Doesn’t close the till')).toBeVisible();
  const enq = page.waitForResponse(
    (r) => r.url().includes('/print/jobs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /End day — print summary/ }).click();
  const res = await enq;
  expect(res.status()).toBeLessThan(300);
  expect(JSON.parse(res.request().postData() || '{}').kind).toBe('day_report');
  await shot('07-end-day');
});

/* ----------------------------------------------------------------- 11 */
test('Item 11 — IMEI kept for staff, never shown to a customer, survives an edit', async () => {
  const cats = (await api('GET', '/admin/categories')).body as { id: string; label: string }[];
  const category = cats.find((c) => /^access/i.test(c.label)) ?? cats[0];
  const imei = '352099001761481';
  const p = await api('POST', '/admin/products', {
    name: `${RUN} Handset`,
    sub: 'Verification fixture',
    categoryId: category.id,
    price: 19900,
    costPrice: 10000,
    stockQty: 0,
    // A supplier, so this isn't a local buy-in: those demand a signed buy-in
    // form before the edit dialog will save at all.
    localBuying: false,
    supplier: 'Test Supplier',
    description: 'A verification fixture for the IMEI check.',
    lowStockAlert: false,
    lowStockThreshold: 5,
    imei,
  });
  expect(p.status, JSON.stringify(p.body).slice(0, 160)).toBe(201);

  const dialog = await openProductEditor(`${RUN} Handset`);
  await expect(dialog.locator('#p-imei'), 'the edit form loads the stored IMEI').toHaveValue(imei);
  await shot('11a-imei-in-admin');

  // THE REGRESSION. Saving an unrelated edit used to send imei:null and
  // erase it, because the form opened with the field blank.
  await dialog.locator('#p-price').fill('205');
  const put = page.waitForResponse(
    (r) => r.url().includes(`/admin/products/${p.body.id}`) && r.request().method() === 'PUT',
  );
  await dialog.locator('button[type=submit]').click();
  const saved = await put;
  expect(saved.status()).toBe(200);
  expect(JSON.parse(saved.request().postData() || '{}').imei, 'the save sends the IMEI back').toBe(
    imei,
  );
  const after = (await api('GET', '/admin/products')).body as { id: string; imei: string | null }[];
  expect(after.find((x) => x.id === p.body.id)?.imei, 'IMEI survives an unrelated edit').toBe(imei);

  // The customer's view of the same product.
  await page.goto(`/shop/${p.body.slug}`);
  await expect(page.getByText(`${RUN} Handset`).first()).toBeVisible();
  const html = await page.content();
  expect(html.includes(imei), 'IMEI absent from the storefront HTML').toBe(false);
  expect(html.includes('176148'), 'not even a fragment of it').toBe(false);
  await shot('11b-storefront-no-imei');
});

/* ----------------------------------------------------------------- 12 */
test('Item 12 — create a product and its promotion in one go', async () => {
  await page.goto('/admin/inventory');
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const d = page.getByRole('dialog');
  await d.locator('#p-name').fill(`${RUN} Promo`);
  await d.locator('#p-sub').fill('Verification fixture');
  // Read the options only once the category list has arrived — before that
  // the select holds just the "Choose a category…" placeholder.
  await expect.poll(() => d.locator('#p-category option').count()).toBeGreaterThan(1);
  const category = await d
    .locator('#p-category option')
    .evaluateAll((opts) =>
      (opts as HTMLOptionElement[]).map((o) => o.value).find((v) => /^[0-9a-f-]{36}$/.test(v)),
    );
  await d.locator('#p-category').selectOption(category!);
  await d.locator('#p-price').fill('12');
  await d.locator('#p-cost').fill('4');
  await d.locator('#p-qty').fill('0');
  // The form insists on a supplier and a description; the description is a
  // rich-text editor, not a labelled input.
  await d.getByPlaceholder('e.g. Northline Trade Ltd').fill('Test Supplier');
  await d.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type('A verification fixture for the inline promotion check.');

  await d.getByText('Run a promotion on this straight away').click();
  await d.locator('#promo-label').fill(`${RUN} 3 for £30`);
  await d.locator('#promo-min-qty').fill('3');
  await d.locator('#promo-unit').fill('10');
  await shot('12a-product-with-promotion');

  const made = page.waitForResponse(
    (r) => r.url().endsWith('/admin/products') && r.request().method() === 'POST',
  );
  await d.locator('button[type=submit]').click();
  const res = await made;
  expect(res.status(), `create: ${(await res.text()).slice(0, 160)}`).toBe(201);

  await page.goto('/admin/promotions');
  await expect(page.getByText(`${RUN} 3 for £30`).first()).toBeVisible();
  await shot('12b-in-promotions-tab');
});

/* ----------------------------------------------------------------- 14 */
test('Item 14 — an unpaid device cannot be marked collected', async () => {
  const job = await newJob({ customerName: `${RUN} Unpaid`, quotedPrice: 12000 });
  const pay = await api('POST', `/jobs/${job.id}/payments`, {
    kind: 'deposit',
    amount: 2000,
    tender: 'cash',
  });
  expect(pay.status, JSON.stringify(pay.body).slice(0, 120)).toBeLessThan(300);
  for (const status of ['in_progress', 'done']) {
    const s = await api('POST', `/jobs/${job.id}/status`, { status });
    expect(s.status, `${status}: ${JSON.stringify(s.body).slice(0, 120)}`).toBe(200);
  }

  await openJobSheet(job.reference);
  // The board card and the open sheet both carry this button; the sheet's is
  // the later one in the document.
  await page.getByTitle(`Move ${job.reference} to Collected`).last().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Still owes' });
  // Whole pounds render without pence: "£100".
  await expect(dialog).toContainText('Still owes £100');
  await expect(dialog).toContainText('£120 quoted, £20 taken');
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await shot('14-still-owes-confirm-disabled');
});

/* ------------------------------------------------------------------ 4 */
// LAST, on purpose: a switch ENDS the outgoing session, and sessions are per
// account, so every context signed in as the owner loses it at once.
test('Item 4 — PIN switching: the new person can sell, Admin stays shut', async () => {
  await page.goto('/pos');
  await dismissFloatPrompt();

  // Accessible name is its text ("Lock till"); the long wording is its title.
  await page.getByTitle(/Lock the till/).click();
  const lock = page.getByRole('dialog', { name: /Session locked/ });
  await expect(lock).toBeVisible();
  await lock.getByRole('button', { name: 'Someone else taking over?' }).click();
  await lock.getByRole('button', { name: EMPLOYEE.name, exact: true }).click();
  await expect(lock).toContainText('Switching to');
  await shot('04a-switching');

  // A sentinel on window proves the document was genuinely replaced: it
  // survives any in-page update and dies only with a real reload.
  await page.evaluate(() => {
    (window as unknown as { __e2eProbe?: string }).__e2eProbe = 'before';
  });
  const reloaded = page.waitForEvent('load', { timeout: 90_000 });
  for (const digit of EMPLOYEE.pin)
    await lock.getByRole('button', { name: digit, exact: true }).click();
  await reloaded;
  await page.waitForLoadState('domcontentloaded');
  expect(
    await page.evaluate(
      () => (window as unknown as { __e2eProbe?: string }).__e2eProbe ?? 'reloaded',
    ),
    'the page reloaded as the incoming person',
  ).toBe('reloaded');
  await dismissFloatPrompt();
  await expect(page.getByText(EMPLOYEE.name).first()).toBeVisible();

  // THE CHECK THE FIRST DRAFT LACKED. The switch used to leave the grid
  // empty — the till reads its catalogue from /admin/products and the PIN
  // block refused it. The incoming person must be able to sell.
  const grid = await api('GET', '/admin/products');
  expect(grid.status, 'the till catalogue read is allowed for a PIN session').toBe(200);
  const firstActive = (grid.body as { name: string; isActive?: boolean }[]).find(
    (x) => x.isActive !== false,
  );
  expect(firstActive, 'staging needs at least one active product').toBeTruthy();
  await expect(
    page.getByText(firstActive!.name).first(),
    'the till grid shows products after a switch',
  ).toBeVisible();
  // The new session's float prompt can arrive a few seconds after the
  // reload; clear it so the screenshot shows the grid it is evidence of.
  await dismissFloatPrompt();
  await shot('04b-grid-after-switch');

  // …and the DASHBOARD stays shut. The PIN message (not a permission one)
  // proves it is the switch doing the refusing.
  const settings = await api('GET', '/admin/settings');
  expect(settings.status).toBe(403);
  expect(String(settings.body.error)).toContain('unlocked with a PIN');
  const edit = await api('PUT', `/admin/products/${grid.body[0].id}`, {});
  expect(edit.status, 'editing a product is refused').toBe(403);
  expect(String(edit.body.error)).toContain('unlocked with a PIN');
  const reports = await api('GET', '/reports/analytics?from=2026-09-01&to=2026-09-30');
  expect(reports.status, 'reports are refused').toBe(403);
});
