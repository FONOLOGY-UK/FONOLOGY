/**
 * A customer's account, the way a person uses it, with the real emails read out of Mailpit:
 *
 *  1. register  → "check your inbox", and a sign-in BEFORE confirming is refused
 *  2. confirm   → the emailed link signs them in and lands on /account
 *  3. sign out, then sign back in with the password
 *  4. a wrong password is refused with a message, not a crash
 *  5. forgot password → emailed link → new password → the old one no longer works
 *  6. a used reset link is refused
 *
 * Needs Mailpit (local stack, :8025) — `E2E_MAILPIT_URL` to point elsewhere.
 * The account is `<run>-…@e2e.fonology.test`; e2e-cleanup removes it.
 * Page errors, console errors and 5xx responses fail each test; every step is photographed.
 */
import { test, expect, type Page } from '@playwright/test';
import { runTag } from '../lib/env';

const RUN = runTag();
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
const EMAIL = `${RUN.toLowerCase()}-acct@e2e.fonology.test`;
const NAME = `${RUN} Customer`;
const PASSWORD_1 = 'First-Pass-1!';
const PASSWORD_2 = 'Second-Pass-2!';

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

/** The newest link to `path` in an email to this customer, waiting for delivery. */
async function emailedLink(path: string, notBefore = ''): Promise<string> {
  const pattern = new RegExp(`(https?://[^\\s"'<>]*${path}\\?token=[A-Za-z0-9_%-]+)`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL}"`)}&limit=5`,
    );
    const found = (await search.json()) as { messages?: { ID: string }[] };
    for (const { ID } of found.messages ?? []) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${ID}`)).json()) as {
        HTML?: string;
        Text?: string;
      };
      const match = pattern.exec(`${message.HTML ?? ''} ${message.Text ?? ''}`);
      if (match?.[1] && match[1] !== notBefore) return match[1].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email with a ${path} link arrived for ${EMAIL}`);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#li-email').fill(email);
  await page.locator('#li-password').fill(password);
  await page
    .locator('form')
    .getByRole('button', { name: /sign in/i })
    .click();
}

let confirmLink = '';
let resetLink = '';

test('1. a customer registers, and cannot sign in until the email is confirmed', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/register');
  await shot(page, '01-register-form');
  await page.locator('#re-name').fill(NAME);
  await page.locator('#re-email').fill(EMAIL);
  await page.locator('#re-password').fill(PASSWORD_1);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByText(EMAIL)).toBeVisible();
  await expect(page.getByText(/confirmation link/i)).toBeVisible();
  await shot(page, '02-check-your-inbox');

  // Unconfirmed: the password is right, and still no way in.
  await signIn(page, EMAIL, PASSWORD_1);
  await expect(page.locator('form [role="alert"]')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await shot(page, '03-unconfirmed-refused');

  expect(problems, problems.join('\n')).toEqual([]);
});

test('2. the emailed link confirms the address and signs them in', async ({ page }) => {
  const problems = watch(page);
  confirmLink = await emailedLink('/auth/confirm');
  await page.goto(confirmLink);
  await expect(page).toHaveURL(/\/account/, { timeout: 30_000 });
  await expect(page.getByText(NAME.split(' ')[0]!).first()).toBeVisible();
  await shot(page, '04-account-after-confirm');
  expect(problems, problems.join('\n')).toEqual([]);
});

test('3. sign out, then sign back in with the password', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, EMAIL, PASSWORD_1);
  await expect(page).toHaveURL(/\/account/, { timeout: 30_000 });
  await page.locator('.nav__account').click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page.locator('.nav__account-word')).toHaveText(/sign in/i);
  await shot(page, '05-signed-out');
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login/);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('4. a wrong password is refused with a message', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, EMAIL, 'definitely-wrong-1');
  await expect(page.locator('form [role="alert"]')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await shot(page, '06-wrong-password');
  // A refusal is a 401, not a crash.
  expect(
    problems.filter((p) => !/\b401\b/.test(p)),
    problems.join('\n'),
  ).toEqual([]);
});

test('5. forgot password: the emailed link sets a new one, and the old one stops working', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/forgot-password');
  await page.waitForLoadState('networkidle');
  await page.locator('#fp-email').fill(EMAIL);
  const sent = page.waitForResponse(
    (r) => r.url().includes('/auth/password-reset') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /send reset link/i }).click();
  expect((await sent).status(), 'the reset request is accepted').toBe(204);
  await expect(page.getByText(/check your inbox/i)).toBeVisible();
  await shot(page, '07-reset-link-sent');

  resetLink = await emailedLink('/reset-password');
  await page.goto(resetLink);
  await page.locator('#rp-password').fill(PASSWORD_2);
  await page.locator('#rp-confirm').fill(PASSWORD_2);
  await shot(page, '08-new-password-form');
  await page.getByRole('button', { name: /update password/i }).click();
  await expect(page.getByText(/password updated/i).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '08b-password-updated');
  await page.getByRole('button', { name: /back to sign in/i }).click();
  await expect(page).toHaveURL(/\/login/);

  // New password works; the old one does not.
  await page.context().clearCookies();
  await signIn(page, EMAIL, PASSWORD_1);
  await expect(page.locator('form [role="alert"]')).toBeVisible();
  await signIn(page, EMAIL, PASSWORD_2);
  await expect(page).toHaveURL(/\/account/, { timeout: 30_000 });
  await shot(page, '09-signed-in-new-password');
  expect(
    problems.filter((p) => !/\b401\b/.test(p)),
    problems.join('\n'),
  ).toEqual([]);
});

test('6. a reset link works once', async ({ page }) => {
  await page.goto(resetLink);
  await expect(page.getByText(/link didn.t work/i)).toBeVisible({ timeout: 30_000 });
  await shot(page, '10-used-link-refused');
});
