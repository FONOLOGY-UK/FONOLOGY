/**
 * Regression pack — the last few report items that needed their own fixtures.
 *
 *   v3 1.3   Returns: searching for a real online order number finds it and fills the items in
 *   v3 5.2   the product page image area is a square, and shows the picture without distorting it
 *   v5 #18   clicking a product photo opens a full-screen gallery you can step through and close
 *   v5 #29   the card form at checkout has no Country box (the shop is UK only)
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
const PRODUCT = `${RUN} Gallery Widget`;

let owner: BrowserContext;
let slug = '';
let productId = '';
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

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  expect(
    (await owner.request.post(`${API}/staff/signin`, { data: OWNER, timeout: 120_000 })).status(),
  ).toBe(200);

  // Two real photos, uploaded through the same endpoint the product form uses.
  const urls: string[] = [];
  for (const [w, h, rgb] of [
    [900, 600, [200, 60, 40]],
    [700, 700, [40, 120, 200]],
  ] as const) {
    const up = await owner.request.post(`${API}/admin/products/images`, {
      multipart: {
        file: {
          name: `p${w}.png`,
          mimeType: 'image/png',
          buffer: solidPng(w, h, [...rgb] as [number, number, number]),
        },
      },
    });
    expect(up.status(), (await up.text()).slice(0, 200)).toBe(201);
    urls.push((await up.json()).url);
  }
  const cats = (await (await owner.request.get(`${API}/admin/categories`)).json()) as any[];
  const made = await owner.request.post(`${API}/admin/products`, {
    data: {
      name: PRODUCT,
      sub: 'Gallery fixture',
      categoryId: cats.find((c) => c.slug === 'accessories').id,
      price: 1800,
      costPrice: 600,
      stockQty: 6,
      localBuying: false,
      supplier: 'Test Supplier',
      description: 'A product with two photos for the gallery checks.',
      lowStockAlert: false,
      lowStockThreshold: 2,
      addToMaster: true,
      images: urls,
    },
  });
  expect(made.status(), (await made.text()).slice(0, 200)).toBe(201);
  const p = await made.json();
  slug = p.slug;
  productId = p.id;

  // A paid online order for the Returns search.
  const pub = await pwRequest.newContext();
  const email = `${RUN.toLowerCase()}-ret@example.invalid`;
  const order = await pub.post(`${API}/orders`, {
    data: {
      lines: [{ productId, variantId: null, quantity: 2 }],
      email,
      firstName: 'Rita',
      lastName: `${RUN} Returner`,
      phone: '07700900961',
      delivery: 'standard',
      address: '10 Returns Road',
      postcode: 'G46 7AA',
    },
  });
  expect(order.status(), (await order.text()).slice(0, 200)).toBeLessThan(300);
  orderRef = (await order.json()).reference;
  expect(
    (
      await pub.post(`${API}/orders/${orderRef}/payment-intent?email=${encodeURIComponent(email)}`)
    ).status(),
  ).toBeLessThan(300);
  execFileSync(
    'pnpm',
    ['--filter', '@fonology/api', 'exec', 'tsx', 'scripts/simulate-stripe-paid.ts', orderRef],
    {
      stdio: 'inherit',
      shell: true,
    },
  );
  await pub.dispose();
});
test.afterAll(async () => owner?.close());

test('1. Returns: an online order number is found, and its items are filled in', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/returns');
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (
    await notNow.waitFor({ state: 'visible', timeout: 4_000 }).then(
      () => true,
      () => false,
    )
  )
    await notNow.click();
  await page
    .getByRole('group', { name: 'Return source' })
    .getByRole('button', { name: 'Online order' })
    .click();
  // Typed in lower case with spaces round it: still found.
  await page.locator('#ret-ref').fill(`  ${orderRef.toLowerCase()}  `);
  await page.getByRole('button', { name: 'Find order' }).click();
  await expect(
    page.getByText(/No order found/i),
    'a real order is not reported missing',
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('main')).toContainText(PRODUCT, { timeout: 15_000 });
  // Nothing has come back yet, so nothing is offered; picking both units (2 × £18.00) offers £36.00.
  await expect(page.locator('#ret-amount')).toHaveValue(/^0(.00)?$/);
  const more = page.getByRole('button', { name: 'One more' }).first();
  await more.click();
  await more.click();
  await expect(page.locator('#ret-amount')).toHaveValue(/36(\.00)?/, { timeout: 15_000 });
  await shot(page, '01-returns-found-order');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. the product page shows the photo in a square, undistorted', async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/shop/${slug}`);
  const stage = page.locator('.pdp__stage');
  await expect(stage).toBeVisible({ timeout: 30_000 });
  const box = (await stage.boundingBox())!;
  expect(Math.abs(box.width - box.height), 'the image area is square (1:1)').toBeLessThanOrEqual(2);
  const img = stage.locator('img').first();
  await expect(img).toBeVisible();
  // Fitted, not stretched or cropped to a rectangle: object-fit is contain/cover on a square stage and the
  // natural image is never scaled to a different aspect than the box.
  const fit = await img.evaluate((el) => getComputedStyle(el).objectFit);
  expect(['contain', 'cover', 'scale-down']).toContain(fit);
  await shot(page, '02-pdp-square-stage');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('3. clicking the photo opens a full-screen gallery: step with Next/Previous, close with Escape', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto(`/shop/${slug}`);
  await page.locator('.pdp__stage').click();
  const gallery = page.getByRole('dialog', { name: /image 1 of 2/i });
  await expect(gallery).toBeVisible({ timeout: 15_000 });
  await shot(page, '03a-lightbox');
  await gallery.getByRole('button', { name: 'Next image' }).click();
  await expect(page.getByRole('dialog', { name: /image 2 of 2/i })).toBeVisible();
  await page
    .getByRole('dialog', { name: /image 2 of 2/i })
    .getByRole('button', { name: 'Previous image' })
    .click();
  await expect(page.getByRole('dialog', { name: /image 1 of 2/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /image \d of 2/i })).toHaveCount(0);
  // And the Close button works too.
  await page.locator('.pdp__stage').click();
  await page
    .getByRole('dialog', { name: /image 1 of 2/i })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(page.getByRole('dialog', { name: /image \d of 2/i })).toHaveCount(0);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('4. the card form at checkout has no Country box', async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/shop/${slug}`);
  await page.getByRole('button', { name: 'Add to bag' }).first().click();
  await page.goto('/checkout');
  await page.getByLabel('Email').fill(`${RUN.toLowerCase()}-country@example.invalid`);
  await page.getByLabel('First name').fill('Cory');
  await page.getByLabel('Last name').fill(`${RUN} Country`);
  await page.getByLabel('Phone').fill('07700900962');
  await page.getByPlaceholder('4 Cherry Lane, Yourtown').fill('11 Country Lane');
  await page.getByPlaceholder('YT1 2AB').fill('G46 7AA');
  await page.getByRole('button', { name: 'Continue' }).first().click();
  await page.waitForTimeout(8_000); // Stripe's frame keeps the network busy
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
  await expect(
    cardFrame!.getByText(/country|territory/i),
    'no Country / Territory selector',
  ).toHaveCount(0);
  await shot(page, '04-card-form');
  expect(problems, problems.join('\n')).toEqual([]);
});
