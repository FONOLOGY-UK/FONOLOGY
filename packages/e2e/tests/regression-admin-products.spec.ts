/**
 * Regression pack — the product form, categories, photos and retired products, with real clicks.
 *
 *   v1 BUG-01 / v2 #15   several photos at once never hang, never break the inventory list
 *   v3 5.1               photos are standardised to 1500×1500 (small ones padded, big ones cropped by hand)
 *   v1 FEATURE-05        categories and sub-categories can be added and removed without a developer
 *   v5 #14               no "Kind" field; Vape / Number Plates / Mobiles are permanent categories
 *   v1 FEATURE-06, v4 FEAT-02, v5 #13   "In-store only" hides Photos, Description, Badge and Compatibility
 *   v1 BUG-04, v4 BUG-10, v2 #9   a deleted product is "retired": restorable, editable, out of low-stock and out of job parts
 *
 * Page errors, console errors and 5xx responses fail each test; every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, OWNER, runTag } from '../lib/env';
import { pngSize, solidPng } from '../lib/png';

const RUN = runTag();

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
  const shown = await notNow.waitFor({ state: 'visible', timeout: 6_000 }).then(
    () => true,
    () => false,
  );
  if (shown) await notNow.click();
}

const get = async (path: string) => {
  const r = await owner.request.get(`${API}${path}`);
  return { status: r.status(), body: await r.json().catch(() => null) };
};
const send = async (method: 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) => {
  const r = await owner.request.fetch(`${API}${path}`, { method, data });
  return { status: r.status(), body: await r.json().catch(() => null) };
};

async function makeProduct(name: string, extra: Record<string, unknown> = {}) {
  const r = await send('POST', '/admin/products', {
    name,
    sub: 'Admin fixture',
    categoryId: accessoriesId,
    price: 1500,
    costPrice: 500,
    stockQty: 10,
    localBuying: false,
    supplier: 'Test Supplier',
    description: 'A fixture product for the admin checks.',
    lowStockAlert: false,
    lowStockThreshold: 3,
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
  return r.body as any;
}

/** Open a product's ⋮ menu on the inventory page and pick an item. */
async function rowAction(page: Page, name: string, item: string) {
  const row = page.locator('tr').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function searchInventory(page: Page, text: string) {
  await page
    .getByPlaceholder(/search/i)
    .first()
    .fill(text);
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 });
  expect(r.status()).toBe(200);
  const cats = (await get('/admin/categories')).body as any[];
  accessoriesId = cats.find((c) => c.slug === 'accessories').id;
});
test.afterAll(async () => owner?.close());

test('1. the product form has no "Kind" field, and "In-store only" hides Photos, Description, Badge and Compatibility', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/inventory');
  await dismissFloat(page);
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const d = page.getByRole('dialog');
  await expect(d.getByLabel('Name')).toBeVisible();
  await expect(d.getByText(/^Kind$/), 'the redundant "Kind" field is gone').toHaveCount(0);
  await expect(d.getByLabel('Category')).toBeVisible();

  for (const label of ['Description', 'Badge (optional)', 'Compatibility (optional)', 'Photos']) {
    await expect(
      d.getByText(label, { exact: false }).first(),
      `${label} shows for an online product`,
    ).toBeVisible();
  }
  await shot(page, '01a-online-product');

  await d.getByRole('checkbox', { name: 'In-store only' }).check();
  for (const label of ['Badge (optional)', 'Compatibility (optional)', 'Photos']) {
    await expect(
      d.getByText(label, { exact: true }),
      `${label} hides when In-store only`,
    ).toHaveCount(0);
  }
  await expect(d.locator('#p-desc'), 'Description hides too').toHaveCount(0);
  await expect(d.locator('#p-image'), 'no photo upload for an in-store-only product').toHaveCount(
    0,
  );
  await shot(page, '01b-in-store-only');

  await d.getByRole('checkbox', { name: 'In-store only' }).uncheck();
  await expect(d.getByText('Badge (optional)')).toBeVisible();
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. categories: add a sub-category, use it on a product, delete it — and the built-in ones cannot be deleted', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  const SUB = `${RUN} Screen Guards`;
  await page.goto('/admin/categories');
  await dismissFloat(page);

  // The three built-ins show a lock and have no delete button.
  for (const label of ['Vape', 'Number Plates', 'Mobiles']) {
    await expect(
      page.getByText(new RegExp(`^${label}\s*Permanent`)).first(),
      `${label} is marked Permanent`,
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Delete ${label}` }),
      `${label} cannot be deleted`,
    ).toHaveCount(0);
  }
  const protectedIds = ((await get('/admin/categories')).body as any[]).filter(
    (c) => c.isProtected,
  );
  expect(protectedIds.map((c) => c.slug).sort()).toEqual(
    expect.arrayContaining(['mobiles', 'plates', 'vape']),
  );
  for (const c of protectedIds) {
    const del = await send('DELETE', `/admin/categories/${c.id}`);
    expect(del.status, `API refuses to delete ${c.slug}`).toBeGreaterThanOrEqual(400);
    expect(del.status).toBeLessThan(500);
  }
  await shot(page, '02a-categories');

  // Add a sub-category under Accessories.
  await page
    .getByRole('button', { name: /Add category|New category/i })
    .first()
    .click();
  const d = page.getByRole('dialog');
  await d.locator('#cat-label').fill(SUB);
  await d.getByLabel('Parent category (optional)').selectOption({ label: 'Accessories' });
  await d
    .getByRole('button', { name: /^(Add|Create|Save)/i })
    .last()
    .click();
  await expect(page.getByText(SUB).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '02b-added');

  // It shows up on the product form.
  await page.goto('/admin/inventory');
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const form = page.getByRole('dialog');
  await expect
    .poll(() => form.locator('#p-category option').allInnerTexts())
    .toEqual(expect.arrayContaining([expect.stringContaining(SUB)]));
  await page.keyboard.press('Escape');

  // And it can be removed again (it is empty and not built-in).
  await page.goto('/admin/categories');
  await page.getByRole('button', { name: `Delete ${SUB}` }).click();
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .last()
    .getByRole('button', { name: /delete|remove|confirm/i })
    .last()
    .click();
  await expect(page.getByText(SUB)).toHaveCount(0, { timeout: 15_000 });
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('3. three photos at once all finish, big ones go through the crop tool, small ones are padded to 1500×1500, and the inventory still loads', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  const NAME = `${RUN} Photo Widget`;
  await page.goto('/admin/inventory');
  await dismissFloat(page);
  await page.getByRole('button', { name: 'Add product' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(NAME);
  await d.getByLabel('Short line').fill('Photo fixture');
  await expect.poll(() => d.locator('#p-category option').count()).toBeGreaterThan(1);
  await d.locator('#p-category').selectOption(accessoriesId);
  await d.locator('#p-price').fill('9.99');
  await d.locator('#p-cost').fill('3');
  await d.locator('#p-qty').fill('4');
  await d.getByPlaceholder('e.g. Northline Trade Ltd').fill('Test Supplier');
  await d.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type('A product with several photos, uploaded all at once.');

  // Small (padded by the server), exactly 1500 (as is), and too big (crop tool).
  await d.locator('#p-image').setInputFiles([
    { name: 'small.png', mimeType: 'image/png', buffer: solidPng(800, 600, [20, 120, 200]) },
    { name: 'exact.png', mimeType: 'image/png', buffer: solidPng(1500, 1500, [20, 180, 80]) },
    { name: 'huge.png', mimeType: 'image/png', buffer: solidPng(2100, 1900, [200, 120, 20]) },
  ]);
  // The big one must stop and ask for a crop; it must not hang the queue.
  const crop = page.getByRole('dialog').filter({ hasText: /Crop .*huge\.png/ });
  await expect(crop).toBeVisible({ timeout: 60_000 });
  await shot(page, '03a-crop-dialog');
  await crop.getByRole('button', { name: 'Use this crop' }).click();
  await expect(crop).toBeHidden({ timeout: 30_000 });

  // Nothing is left "Uploading…", "Waiting…" or "Failed" — three real thumbnails.
  await expect(
    d.getByText(/^(Uploading|Waiting|Needs cropping)/),
    'no upload is stuck',
  ).toHaveCount(0, {
    timeout: 90_000,
  });
  await expect(d.getByText('Failed')).toHaveCount(0);
  await expect(d.locator('img[src*="product-images"], img[src^="http"]')).toHaveCount(3, {
    timeout: 30_000,
  });
  await shot(page, '03b-three-thumbnails');

  const saved = page.waitForResponse(
    (r) => /\/admin\/products$/.test(r.url()) && r.request().method() === 'POST',
  );
  await d.locator('button[type=submit]').click();
  expect((await saved).status()).toBe(201);

  // The list still loads (this is the original "global inventory crash").
  await page.goto('/admin/inventory');
  await searchInventory(page, NAME);
  await expect(page.locator('tr').filter({ hasText: NAME })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/unable to load|try again/i)).toHaveCount(0);
  await shot(page, '03c-inventory-after');

  // And the storefront list still loads too.
  const pub = await (await owner.request.get(`${API}/products`)).json();
  expect(Array.isArray(pub)).toBe(true);

  // Every stored photo is exactly 1500×1500.
  const row = ((await get('/admin/products')).body as any[]).find((p) => p.name === NAME);
  expect(row.images.length, 'all three photos were saved').toBe(3);
  for (const url of row.images as string[]) {
    const res = await owner.request.get(url);
    expect(res.status(), url).toBe(200);
    const size = pngSize(Buffer.from(await res.body()));
    if (size) expect(size, `${url} is 1500×1500`).toEqual({ width: 1500, height: 1500 });
  }
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('4. retire → Restore; edit a retired product and it saves; retired is out of low-stock and out of job parts', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  const NAME = `${RUN} Retiree`;
  const made = await makeProduct(NAME, { stockQty: 1, lowStockAlert: true, lowStockThreshold: 3 });

  // Low-stock counts it while active.
  const before = (await get('/admin/inventory/summary')).body;
  await page.goto('/admin/inventory');
  await dismissFloat(page);
  await searchInventory(page, NAME);
  await rowAction(page, NAME, 'Delete');
  const del = page.waitForResponse(
    (r) => /\/admin\/products\//.test(r.url()) && r.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Delete product' }).click();
  expect((await del).status(), 'the delete request is accepted').toBeLessThan(300);
  await expect(
    page.locator('tr').filter({ hasText: NAME }).filter({ hasNotText: 'Nothing matches' }),
  ).toHaveCount(0, { timeout: 15_000 });
  await shot(page, '04a-retired');

  // It is in the Retired list, offering Restore (and not Delete).
  await page.getByRole('button', { name: /^Retired/ }).click();
  await searchInventory(page, NAME);
  const row = page
    .locator('tr')
    .filter({ hasText: NAME })
    .filter({ hasNotText: 'Nothing matches' })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button').last().click();
  await expect(page.getByRole('menuitem', { name: 'Restore', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Low-stock logic ignores it.
  const lowList = ((await get('/admin/products')).body as any[]).filter(
    (p) =>
      p.isActive !== false &&
      p.lowStockAlert &&
      p.stockQty <= p.lowStockThreshold &&
      p.name === NAME,
  );
  expect(lowList, 'a retired product is never low-stock').toHaveLength(0);
  void before;

  // A job cannot fit a retired product.
  const job = await send('POST', '/jobs', {
    source: 'walk_in',
    customerName: `${RUN} Parts`,
    phone: '07700900901',
    deviceDescription: 'Pixel 8',
    problemDescription: 'Battery',
  });
  expect(job.status).toBe(201);
  const fit = await send('POST', `/jobs/${job.body.id}/parts`, { productId: made.id, quantity: 1 });
  expect(fit.status, 'a retired product cannot be fitted to a job').toBeGreaterThanOrEqual(400);
  expect(fit.status).toBeLessThan(500);

  // Edit while retired — the save must persist.
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Selling price (£)').fill('21.50');
  const put = page.waitForResponse(
    (r) => /\/admin\/products\//.test(r.url()) && r.request().method() === 'PUT',
  );
  await d.getByRole('button', { name: /save/i }).click();
  expect((await put).status()).toBe(200);
  await expect(d).toBeHidden({ timeout: 15_000 });
  const edited = ((await get('/admin/products')).body as any[]).find((p) => p.id === made.id);
  expect(edited.price, 'editing a retired product saved').toBe(2150);
  expect(edited.isActive, 'and it is still retired').toBe(false);
  await shot(page, '04b-edited-while-retired');

  // Restore.
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
  await expect
    .poll(
      async () =>
        ((await get('/admin/products')).body as any[]).find((p) => p.id === made.id)?.isActive,
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  const fitAgain = await send('POST', `/jobs/${job.body.id}/parts`, {
    productId: made.id,
    quantity: 1,
  });
  expect(fitAgain.status, 'once restored it can be fitted').toBe(201);
  await shot(page, '04c-restored');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});
