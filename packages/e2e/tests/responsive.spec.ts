/**
 * The same screens at phone width (390px) and tablet width (820px): nothing may scroll
 * sideways, and every screen is photographed. Staff screens are checked signed in as the
 * owner; the till as the Shop 1 employee.
 */
import { test, expect, type Page } from '@playwright/test';
import { API, EMPLOYEE, OWNER } from '../lib/env';

const PUBLIC = ['/', '/shop', '/repair', '/sell', '/cart', '/checkout', '/track', '/login', '/faq'];
const ADMIN = [
  '/admin',
  '/admin/inventory',
  '/admin/jobs',
  '/admin/orders',
  '/admin/staff',
  '/admin/shops',
  '/admin/promotions',
  '/admin/reports',
  '/admin/payments',
];
const POS = ['/pos', '/pos/jobs', '/pos/inventory'];

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
];

async function overflow(page: Page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    // The widest element that pokes out, to say WHERE the overflow is.
    culprit: (() => {
      let worst: { tag: string; cls: string; right: number } | null = null;
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1 && (!worst || r.right > worst.right)) {
          worst = {
            tag: el.tagName.toLowerCase(),
            cls: String((el as HTMLElement).className).slice(0, 60),
            right: Math.round(r.right),
          };
        }
      }
      return worst;
    })(),
  }));
}

async function sweep(
  page: Page,
  label: string,
  paths: string[],
  size: { name: string; width: number },
) {
  const bad: string[] = [];
  for (const path of paths) {
    await page.goto(path, { waitUntil: 'load', timeout: 120_000 });
    const notNow = page.getByRole('button', { name: 'Not now' });
    if (
      await notNow.waitFor({ state: 'visible', timeout: 2_500 }).then(
        () => true,
        () => false,
      )
    )
      await notNow.click();
    await page.waitForTimeout(1_200);
    const o = await overflow(page);
    const file = test.info().outputPath(`${label}-${size.name}${path.replace(/\W+/g, '_')}.png`);
    await page.screenshot({ path: file });
    await test.info().attach(`${label}-${size.name}${path.replace(/\W+/g, '_')}`, {
      path: file,
      contentType: 'image/png',
    });
    if (o.scroll > o.inner + 1)
      bad.push(
        `${path}: page is ${o.scroll}px wide in a ${o.inner}px window (widest: ${JSON.stringify(o.culprit)})`,
      );
  }
  return bad;
}

for (const size of SIZES) {
  test(`${size.name}: public pages do not scroll sideways`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
    });
    const bad = await sweep(await ctx.newPage(), 'public', PUBLIC, size);
    await ctx.close();
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test(`${size.name}: back office does not scroll sideways`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
    });
    expect((await ctx.request.post(`${API}/staff/signin`, { data: OWNER })).status()).toBe(200);
    const bad = await sweep(await ctx.newPage(), 'admin', ADMIN, size);
    await ctx.close();
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test(`${size.name}: the till does not scroll sideways`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
    });
    expect(
      (
        await ctx.request.post(`${API}/staff/signin`, {
          data: { email: EMPLOYEE.email, password: 'Test1234!' },
        })
      ).status(),
    ).toBe(200);
    const bad = await sweep(await ctx.newPage(), 'pos', POS, size);
    await ctx.close();
    expect(bad, bad.join('\n')).toEqual([]);
  });
}
