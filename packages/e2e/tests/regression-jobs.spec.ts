/**
 * Regression pack — the Jobs board, the way QA reports v1–v5 describe it, with real clicks.
 *
 *   v1 BUG-07/08/09, FEATURE-10   cancel a job; cancelled jobs can be collected / posted back; mail-in jobs
 *   v2 #7  no "Online" filter     #8  one search bar in list view     #10 mail-in needs no booking
 *   v2 #12 a cancelled walk-in is NOT auto-collected                  #13/#14 archive + "Cancelled" badge
 *   v3 2.1 no "link to booking"   2.2 post-back asks courier AND tracking   2.3 cancel asks only a reason
 *   v3 2.4 cancelled mail-in has "Post back" (not "Mark collected")   2.5 resolved jobs leave Cancelled
 *   v3 3.2 badge is the job TYPE only                                  3.3 no scrollbars inside board columns
 *   v4 BUG-13 no nested <button> hydration error on the Cancelled tab
 *   v5 #1  staff "Archive" stays in the staff panel   #2/#6/#5 staff Repair Requests + "Sell In Requests" tabs
 *
 * Page errors, console errors (hydration included) and 5xx responses fail each test; every step is photographed.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { API, EMPLOYEE, OWNER, runTag } from '../lib/env';

const RUN = runTag();
const PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD ?? 'Test1234!';

let owner: BrowserContext;
let staff: BrowserContext;
let walkIn: { id: string; reference: string };
let mailIn: { id: string; reference: string };
let extra: { id: string; reference: string }[] = [];

test.describe.configure({ mode: 'serial' });

async function shot(page: Page, name: string) {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

/** Every console error counts — including React's hydration warnings. */
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

async function signIn(browser: any, email: string, password: string) {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const r = await ctx.request.post(`${API}/staff/signin`, {
    data: { email, password },
    timeout: 120_000,
  });
  expect(r.status(), `sign in ${email}`).toBe(200);
  return ctx;
}

/** The board/table choice is remembered per browser; the Cancelled strip lives on the board. */
async function boardView(page: Page) {
  const board = page.getByRole('button', { name: 'Board view' });
  if ((await board.getAttribute('aria-pressed')) !== 'true') await board.click();
}

async function makeJob(source: 'walk_in' | 'mail_in', name: string) {
  const r = await owner.request.post(`${API}/jobs`, {
    data: {
      source,
      customerName: `${RUN} ${name}`,
      phone: '07700900701',
      deviceDescription: 'Pixel 8',
      problemDescription: 'Battery swap',
    },
  });
  expect(r.status(), (await r.text()).slice(0, 200)).toBe(201);
  return (await r.json()) as { id: string; reference: string };
}

test.beforeAll(async ({ browser }) => {
  owner = await signIn(browser, OWNER.email, OWNER.password);
  staff = await signIn(browser, EMPLOYEE.email, PASSWORD);
  walkIn = await makeJob('walk_in', 'Walker');
  mailIn = await makeJob('mail_in', 'Mailer');
  for (const n of ['A', 'B', 'C', 'D']) extra.push(await makeJob('walk_in', `Crowd ${n}`));
});

test.afterAll(async () => {
  await Promise.all([owner?.close(), staff?.close()]);
});

test('1. the Jobs page has one search bar in both views, and no "Online" filter', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/jobs');
  await dismissFloat(page);
  await boardView(page);
  await expect(page.getByLabel('Search jobs')).toHaveCount(1);
  const filters = page
    .getByRole('group')
    .filter({ has: page.getByRole('button', { name: 'Walk-in' }) });
  await expect(filters.first().getByRole('button', { name: 'All' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^online$/i })).toHaveCount(0);
  await shot(page, '01a-board');

  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByLabel('Search jobs'), 'still ONE search bar in list view').toHaveCount(1);
  await expect(page.getByPlaceholder(/search/i)).toHaveCount(1);
  await shot(page, '01b-list');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('2. Add job: Walk-in / Mail-in toggle, no booking picker, a mail-in job saves without a booking', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/jobs');
  await dismissFloat(page);
  await boardView(page);
  await page.getByRole('button', { name: 'Add job' }).click();
  const d = page.getByRole('dialog');
  const toggle = d.getByRole('group', { name: 'How did it come in?' });
  await expect(toggle.getByRole('button', { name: 'Walk-in' })).toBeVisible();
  await toggle.getByRole('button', { name: 'Mail-in' }).click();
  await expect(d, 'no "link to booking" anywhere in the form').not.toContainText(/booking/i);

  await d.locator('#job-name').fill(`${RUN} Posted`);
  await d.locator('#job-phone').fill('07700900702');
  await d.locator('#job-device').fill('Galaxy S23');
  await d.locator('#job-problem').fill('Cracked back glass');
  await shot(page, '02a-add-mail-in');
  const made = page.waitForResponse(
    (r) => /\/jobs$/.test(r.url()) && r.request().method() === 'POST',
  );
  await d
    .getByRole('button', { name: /^(add|create|save)/i })
    .last()
    .click();
  expect((await made).status(), 'a mail-in job is created without any booking').toBe(201);
  await expect(
    page.getByText('Galaxy S23').first(),
    'the new mail-in job is on the board',
  ).toBeVisible({ timeout: 15_000 });
  await shot(page, '02b-created');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('3. cancelling a walk-in asks only WHY, and does not mark it collected', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/jobs');
  await dismissFloat(page);
  await boardView(page);
  await page.getByText(walkIn.reference, { exact: true }).first().click();
  await page.getByTitle('Cancel this job').last().click();
  const d = page.getByRole('dialog').filter({ hasText: 'Why is it being cancelled?' });
  await expect(d.getByText('Why is it being cancelled?')).toBeVisible();
  // v3 2.3: the "where is the device?" question is gone.
  await expect(d).not.toContainText(/still with us|with the customer/i);
  await d.locator('#move-reason').fill('E2E: customer changed their mind');
  await shot(page, '03a-cancel-dialog');
  const done = page.waitForResponse(
    (r) => r.url().includes('/status') && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect((await done).status()).toBe(200);

  await page.goto('/admin/jobs');
  await boardView(page);
  const strip = page.locator('section').filter({ hasText: /Cancelled \(/ });
  const card = strip.locator('article').filter({ hasText: walkIn.reference });
  await expect(card).toBeVisible({ timeout: 15_000 });
  // Not auto-collected: it says so, and offers the Mark collected action.
  await expect(card).toContainText('Not collected');
  await expect(card.getByRole('button', { name: 'Mark collected' })).toBeVisible();
  await expect(
    card.getByRole('button', { name: 'Post back' }),
    'a walk-in cannot be posted',
  ).toHaveCount(0);
  await shot(page, '03b-cancelled-strip');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('4. cancelled walk-in → Mark collected → leaves Cancelled, lands in the Archive with a Cancelled badge', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/jobs');
  await dismissFloat(page);
  await boardView(page);
  const strip = page.locator('section').filter({ hasText: /Cancelled \(/ });
  const card = strip.locator('article').filter({ hasText: walkIn.reference });
  await card.getByRole('button', { name: 'Mark collected' }).click();
  await expect(card, 'it leaves the Cancelled strip').toHaveCount(0, { timeout: 15_000 });

  await page.goto('/admin/jobs/archive');
  const row = page.locator('tr, article, li').filter({ hasText: walkIn.reference }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row, 'a cancelled job is flagged in the archive').toContainText('Cancelled');
  await shot(page, '04-archive-cancelled-walk-in');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});

test('5. cancelled mail-in → "Post back" needs courier AND tracking → archive with Cancelled badge', async () => {
  const page = await owner.newPage();
  const problems = watch(page);
  await page.goto('/admin/jobs');
  await dismissFloat(page);
  await boardView(page);
  await page.getByText(mailIn.reference, { exact: true }).first().click();
  await page.getByTitle('Cancel this job').last().click();
  let d = page.getByRole('dialog').filter({ hasText: 'Why is it being cancelled?' });
  await d.locator('#move-reason').fill('E2E: parts unavailable');
  await d.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(d).toBeHidden({ timeout: 15_000 });

  await page.goto('/admin/jobs');
  const strip = page.locator('section').filter({ hasText: /Cancelled \(/ });
  const card = strip.locator('article').filter({ hasText: mailIn.reference });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(
    card.getByRole('button', { name: 'Mark collected' }),
    'a mail-in cannot skip the post-back',
  ).toHaveCount(0);
  await card.getByRole('button', { name: 'Post back' }).click();
  d = page.getByRole('dialog').filter({ hasText: 'Courier name' });
  await expect(d.getByText('Courier name')).toBeVisible();
  await expect(d.getByText('Return tracking number')).toBeVisible();

  // Neither field → refused with a message; courier alone → refused; both → done.
  await d.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(d.getByText(/tracking number is required/i)).toBeVisible();
  await d.getByPlaceholder(/Royal Mail/i).fill('DPD');
  await d.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(d.getByText(/tracking number is required/i)).toBeVisible();
  await d.getByPlaceholder(/AB123456789GB/i).fill('DPD0000012345');
  await shot(page, '05a-post-back-filled');
  const done = page.waitForResponse(
    (r) => r.url().includes('/status') && r.request().method() === 'POST',
  );
  await d.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect((await done).status()).toBe(200);
  await expect(card, 'it leaves the Cancelled strip').toHaveCount(0, { timeout: 15_000 });

  await page.goto('/admin/jobs/archive');
  const row = page.locator('tr, article, li').filter({ hasText: mailIn.reference }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Cancelled');
  await shot(page, '05b-archive-cancelled-mail-in');
  expect(problems, 'no hydration / nested-button errors').toEqual([]);
  await page.close();
});

test('6. job badges say the TYPE only, and board columns have no scrollbars of their own', async () => {
  const page = await owner.newPage();
  await page.goto('/admin/jobs');
  await dismissFloat(page);
  await boardView(page);
  await expect(page.getByText(extra[3]!.reference, { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  // No badge mixes type and status ("Walkin, Collected", "Mail in, Posts back").
  const body = await page.locator('main').innerText();
  expect(body).not.toMatch(/walk-?in,\s*\w+|mail[- ]in,\s*\w+/i);
  await shot(page, '06-board-with-crowd');
  // v3 3.3: with 5 new jobs a column must grow, not scroll inside itself.
  const scrollers = await page.evaluate(() =>
    [...document.querySelectorAll('main *')]
      .filter((el) => {
        const s = getComputedStyle(el);
        return /auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4;
      })
      .map((el) => `${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 60)}`),
  );
  expect(scrollers, 'no element on the board scrolls internally').toEqual([]);
  await page.close();
});

test('7. the staff panel keeps staff inside the staff panel (Archive, Repair Requests, Sell In Requests)', async () => {
  const page = await staff.newPage();
  const problems = watch(page);
  await page.goto('/pos/jobs');
  await dismissFloat(page);
  // v5 #6 / #5: the tabs exist and are named as the shop calls them.
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Repair Requests' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Sell In Requests/i })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Trade[- ]?ins?$/i })).toHaveCount(0);

  // v5 #1: Archive stays under /pos.
  await page.getByRole('link', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/pos\/jobs\/archive/);
  await shot(page, '07a-staff-archive');
  // v5 #2: Sell In Requests stays under /pos too.
  await page.goto('/pos/jobs');
  await page
    .getByRole('link', { name: /Sell In Requests/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/pos\//);
  await expect(page).not.toHaveURL(/\/admin/);
  await shot(page, '07b-staff-sell-in');
  expect(problems, problems.join('\n')).toEqual([]);
  await page.close();
});
