/**
 * Fonology — full end-to-end connect-and-test pass.
 * =================================================
 * A repeatable script proving the fitting backend surface works together,
 * end to end, against the local stack (docker-compose.dev.yml) — not just in isolation.
 * Re-runnable before launch: every entity it creates carries a unique
 * timestamp suffix, and any once-per-day action (float-open, day-close)
 * degrades gracefully into a verification-only path on a second run within
 * the same trading day rather than failing the whole script.
 *
 * Requires the API dev server running locally (`npx tsx src/server.ts` from
 * apps/api) against the local database, Mailpit on :8025 for the emails, and
 * the test logins from scripts/seed-dev.ts. Never touches production.
 *
 * Run:  npx tsx scripts/e2e-test.ts
 *
 * Signs in as the two standing dev accounts documented in TEST-LOGINS.md —
 * the same ones a human tester uses. This script used to depend on its own
 * throwaway fixtures (`ui-proof-owner@…`, `b6-employee-proof@…`), which meant
 * the dev Staff page could never be cleaned up without breaking the script.
 * The real accounts carry identical permission profiles (owner: 15 perms
 * including analytics.view; employee: 7, deliberately without it), so the
 * lockout assertions in section 8 prove exactly what they proved before.
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertTestWritesAllowed } from '../src/config.js';
import { db, pool } from '../src/lib/db.js';

// Resolved relative to this file, not the CWD the script happens to be
// invoked from (CLAUDE.md documents running it as
// `pnpm --filter @fonology/api exec tsx scripts/e2e-test.ts`).
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'),
});

// `localhost`, never `127.0.0.1`: WEB_APP_URL says localhost, and lib/cookies.ts
// (correctly) treats a different host as cross-site and refuses to set the
// session cookie outside production — every signed-in check would 500.
const API = process.env.E2E_API_BASE ?? 'http://localhost:4000';
const RUN_ID = Date.now().toString(36);

// Signup and password reset send real emails. Against the local stack they
// land in Mailpit, and this script follows the link in them exactly as a
// person would — the link is read out of the delivered message, not minted.
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

/** The newest link to `path` in an email to `to`, waiting briefly for delivery. */
async function linkFromEmail(to: string, path: string): Promise<string | null> {
  const pattern = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`);
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`,
    );
    const found = (await search.json()) as { messages?: { ID: string }[] };
    const id = found.messages?.[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
        HTML?: string;
        Text?: string;
      };
      const match = pattern.exec(`${message.HTML ?? ''} ${message.Text ?? ''}`);
      if (match?.[1]) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

const OWNER_EMAIL = 'owner@fonology.test';
const OWNER_PASSWORD = 'Test1234!';
// The standing employee account: everyday counter permissions, deliberately
// without analytics/reports/settings/staff — which is what section 8 proves.
const EMPLOYEE_EMAIL = 'staff@fonology.test';
const EMPLOYEE_PASSWORD = 'Test1234!';
const OWNER_PIN = '1234';

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function log(msg: string) {
  console.log(msg);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function assert(condition: boolean, message: string) {
  if (condition) {
    passCount++;
    console.log(`  ✓ ${message}`);
  } else {
    failCount++;
    failures.push(message);
    console.log(`  ✗ FAILED: ${message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

/** Minimal manual cookie jar — Node's fetch doesn't persist cookies across calls like a browser does. */
class Client {
  private cookies = new Map<string, string>();

  private applySetCookie(res: Response) {
    const raw =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const cookieHeader = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.applySetCookie(res);
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  get(path: string) {
    return this.request('GET', path);
  }
  post(path: string, body?: unknown) {
    return this.request('POST', path, body);
  }
  put(path: string, body?: unknown) {
    return this.request('PUT', path, body);
  }
  patch(path: string, body?: unknown) {
    return this.request('PATCH', path, body);
  }
  delete(path: string) {
    return this.request('DELETE', path);
  }
}

async function main() {
  // Creates customers, sales, refunds and products — never in the live shop
  // unless it is still being tested before opening.
  assertTestWritesAllowed('e2e-test');

  const guest = new Client();
  const customer = new Client();
  const owner = new Client();
  const employee = new Client();

  // ---------------------------------------------------------------------
  section('0. Health check');
  const health = await guest.get('/health');
  assertEqual(health.status, 200, '/health responds 200');

  // ---------------------------------------------------------------------
  section('1. Customer registers, confirms by email, and signs in');
  const customerEmail = `e2e-customer-${RUN_ID}@example.invalid`;
  const signup = await customer.post('/auth/customer/signup', {
    name: 'E2E Test Customer',
    email: customerEmail,
    password: 'E2E-Test-Password-9',
  });

  assertEqual(signup.status, 201, `customer signup (${customerEmail})`);
  assertEqual(
    signup.body?.verificationRequired,
    true,
    'signup reports verification required (#9a: real email verification, no auto sign-in)',
  );

  // Not signed in yet — the whole point of #9a. A session at this point
  // would mean the old auto-confirm shortcut was still in effect.
  const unconfirmedSession = await customer.get('/auth/session');
  assertEqual(
    unconfirmedSession.body,
    null,
    'no session exists before the confirmation link is used',
  );

  const earlySignin = await customer.post('/auth/customer/signin', {
    email: customerEmail,
    password: 'E2E-Test-Password-9',
  });
  assertEqual(earlySignin.status, 403, 'signing in before confirming is refused');

  const confirmToken = await linkFromEmail(customerEmail, '/auth/confirm');
  assert(Boolean(confirmToken), 'the confirmation email arrived with its link');
  const confirmed = await customer.post('/auth/customer/confirm-email', { token: confirmToken });
  assertEqual(confirmed.status, 200, 'following the confirmation link signs the customer in');
  const reused = await guest.post('/auth/customer/confirm-email', { token: confirmToken });
  assertEqual(reused.status, 401, 'a confirmation link works only once');

  const signin = await customer.post('/auth/customer/signin', {
    email: customerEmail,
    password: 'E2E-Test-Password-9',
  });
  assertEqual(signin.status, 200, 'customer can sign in once confirmed');

  const custSession = await customer.get('/auth/session');
  assertEqual(custSession.status, 200, 'customer session readable after signin');
  assertEqual(
    custSession.body?.email,
    customerEmail,
    'session email matches the account just created',
  );
  assertEqual(custSession.body?.kind, 'customer', 'session kind is customer');

  // Password reset: the emailed link sets a new password, signs the account
  // out everywhere, and only the new password works afterwards.
  const resetRequested = await guest.post('/auth/password-reset', { email: customerEmail });
  assertEqual(resetRequested.status, 204, 'password reset requested');
  const resetToken = await linkFromEmail(customerEmail, '/reset-password');
  assert(Boolean(resetToken), 'the reset email arrived with its link');
  const resetCheck = await guest.post('/auth/password-reset/check', { token: resetToken });
  assertEqual(resetCheck.body?.valid, true, 'the reset link checks as valid');
  const resetDone = await guest.post('/auth/password-reset/complete', {
    token: resetToken,
    password: 'E2E-Test-Password-10',
  });
  assertEqual(resetDone.status, 204, 'new password set from the reset link');
  const afterReset = await customer.get('/auth/session');
  assertEqual(afterReset.body, null, 'the reset signed the existing session out');
  const oldPassword = await guest.post('/auth/customer/signin', {
    email: customerEmail,
    password: 'E2E-Test-Password-9',
  });
  assertEqual(oldPassword.status, 401, 'the old password no longer works');
  const newPassword = await customer.post('/auth/customer/signin', {
    email: customerEmail,
    password: 'E2E-Test-Password-10',
  });
  assertEqual(newPassword.status, 200, 'the new password signs in');

  // ---------------------------------------------------------------------
  section('Owner signs in (pre-existing dev fixture)');
  const ownerSignin = await owner.post('/staff/signin', {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  assertEqual(ownerSignin.status, 200, `owner signs in (${OWNER_EMAIL})`);

  // FEATURE-05 (migration 0045) turned the old fixed 7-value `category` enum
  // into a real, admin-editable `categories` table, so a product is now filed
  // by `categoryId`. There is no fixed id to hardcode — an admin can rename or
  // remove any of them — so the id has to be looked up at run time. This script
  // kept sending the old `category: 'power'` string and every product create
  // 400'd, which took 26 downstream assertions with it.
  // It also creates one if the project has none, so this script still runs
  // against a freshly-cleared database rather than quietly depending on seed
  // data somebody else left behind.
  const categoriesList = await owner.get('/admin/categories');
  assertEqual(categoriesList.status, 200, 'categories list loads (for categoryId lookup)');
  let categoryId: string | undefined = categoriesList.body?.[0]?.id;
  if (!categoryId) {
    const madeCategory = await owner.post('/admin/categories', { label: `E2E Category ${RUN_ID}` });
    assertEqual(madeCategory.status, 201, 'no categories existed — created one for this run');
    categoryId = madeCategory.body?.id;
  }
  assert(Boolean(categoryId), 'a category is available to file products under');

  // ---------------------------------------------------------------------
  section('2. Product exists with real stock received at a real cost');
  const productCreate = await owner.post('/admin/products', {
    name: `E2E Shop Widget ${RUN_ID}`,
    sub: 'E2E fixture',
    categoryId,
    kind: 'accessory',
    price: 1500,
    costPrice: 700,
    stockQty: 20,
    localBuying: true,
    lowStockAlert: false,
    lowStockThreshold: 3,
    description: 'Created by the connect-and-test E2E script — safe to leave in dev.',
  });
  assertEqual(productCreate.status, 201, 'product created');
  const productA = productCreate.body;
  assertEqual(productA?.stockQty, 20, 'product created with 20 units in stock');
  assertEqual(productA?.costPrice, 700, 'product cost price is the real unit cost paid (700p)');

  // ---------------------------------------------------------------------
  section('3. Guest places an online order; paid; stock comes off; reads back');
  const guestEmail = `e2e-guest-${RUN_ID}@example.invalid`;
  const orderCreate = await guest.post('/orders', {
    lines: [{ productId: productA.id, quantity: 2 }],
    email: guestEmail,
    firstName: 'E2E',
    lastName: 'Guest',
    phone: '07700900555',
    delivery: 'collect',
  });
  assertEqual(orderCreate.status, 201, 'guest order created');
  const order = orderCreate.body;
  assertEqual(
    order?.total,
    3000,
    'order total is 2 x 1500 = 3000p (server-computed, not client-supplied)',
  );
  assertEqual(order?.status, 'pending', 'order starts pending');

  const orderPaid = await owner.post(`/orders/${order.reference}/paid`, {});
  assertEqual(orderPaid.status, 200, 'order marked paid');
  assertEqual(orderPaid.body?.status, 'paid', 'order status is now paid');

  const productList = await owner.get('/admin/products');
  const productARow = (productList.body as any[]).find((p) => p.id === productA.id);
  assertEqual(productARow?.stockQty, 18, 'stock decremented by 2 on payment (20 - 2 = 18)');

  // ---------------------------------------------------------------------
  section('4. Staff rings up a till sale with a cash + card split');
  const todayBefore = await owner.get('/pos/today');
  const takingsBefore = todayBefore.body?.total ?? 0;
  const salesBefore = todayBefore.body?.sales ?? 0;

  const sale = await owner.post('/pos/sales', {
    lines: [{ productId: productA.id, quantity: 1 }],
    discount: 0,
    payments: [
      { tender: 'cash', amount: 1000 },
      { tender: 'pos1', amount: 500 },
    ],
  });
  assertEqual(sale.status, 201, 'till sale completed with a cash + card split');
  assertEqual(sale.body?.total, 1500, 'sale total is 1500p (1000 cash + 500 card)');

  const productAfterSale = await owner.get('/admin/products');
  const productARow2 = (productAfterSale.body as any[]).find((p) => p.id === productA.id);
  assertEqual(
    productARow2?.stockQty,
    17,
    'stock decremented by 1 more on the till sale (18 - 1 = 17)',
  );

  const todayAfterSale = await owner.get('/pos/today');
  assertEqual(
    todayAfterSale.body?.total,
    takingsBefore + 1500,
    "today's takings increased by exactly the sale total",
  );
  assertEqual(todayAfterSale.body?.sales, salesBefore + 1, "today's sale count incremented by 1");

  // ---------------------------------------------------------------------
  section('5. Refund goes through, capped correctly, restocking one line');
  const refund = await owner.post('/pos/refunds', {
    source: 'counter',
    reference: sale.body.reference,
    lines: [{ productId: productA.id, name: productA.name, quantity: 1, unitPrice: 1500 }],
    amount: 1500,
    tender: 'cash',
    reason: 'E2E test refund — full amount',
    restock: true,
    override: false,
  });
  assertEqual(refund.status, 201, 'refund of the full sale amount succeeds');
  assertEqual(refund.body?.amount, 1500, 'refund amount matches the sale total');

  const productAfterRefund = await owner.get('/admin/products');
  const productARow3 = (productAfterRefund.body as any[]).find((p) => p.id === productA.id);
  assertEqual(productARow3?.stockQty, 18, 'stock restocked by 1 after the refund (17 + 1 = 18)');

  const overRefund = await owner.post('/pos/refunds', {
    source: 'counter',
    reference: sale.body.reference,
    lines: [{ productId: productA.id, name: productA.name, quantity: 1, unitPrice: 1 }],
    amount: 1,
    tender: 'cash',
    reason: 'E2E test refund — should be refused, nothing left to refund',
    restock: false,
    override: false,
  });
  assertEqual(
    overRefund.status,
    409,
    'refunding even 1p more than was paid on this sale is refused (cap enforced)',
  );

  // ---------------------------------------------------------------------
  section('6. Mail-in repair is booked and reads back');
  const devices = await guest.get('/repair/devices');
  const repairTypes = await guest.get('/repair/types');
  assert(Array.isArray(devices.body) && devices.body.length > 0, 'at least one device exists');
  assert(
    Array.isArray(repairTypes.body) && repairTypes.body.length > 0,
    'at least one repair type exists',
  );
  // 0109: a repair is booked at a price the DEVICE offers — pick the first device with one.
  let device: any = null;
  let offer: any = null;
  for (const d of devices.body) {
    const offers = await guest.get(`/repair/offers?deviceId=${d.id}`);
    if (Array.isArray(offers.body) && offers.body.length > 0) {
      device = d;
      offer = offers.body[0];
      break;
    }
  }
  assert(offer !== null, 'at least one device offers a priced repair');

  const bookingEmail = `e2e-booking-${RUN_ID}@example.invalid`;
  const booking = await guest.post('/repair/bookings', {
    deviceId: device.id,
    repairId: offer.repairId,
    subTypeId: offer.subTypeId,
    name: 'E2E Booking Customer',
    phone: '07700900556',
    email: bookingEmail,
    address: '1 E2E Test Lane',
    postcode: 'SW1A 1AA',
    preferredContact: 'email',
  });
  assertEqual(booking.status, 201, 'mail-in booking created');
  assertEqual(booking.body?.price, offer.price, 'priced from the device’s own price list (0109)');

  const bookingReadBack = await guest.get(
    `/repair/bookings/${booking.body.reference}?email=${encodeURIComponent(bookingEmail)}`,
  );
  assertEqual(bookingReadBack.status, 200, 'booking reads back by reference + email');
  assert(bookingReadBack.body !== null, 'booking body is non-null for the correct email');
  assertEqual(
    bookingReadBack.body?.reference,
    booking.body.reference,
    'read-back reference matches',
  );

  // ---------------------------------------------------------------------
  section('7. Admin receives stock — weighted-average cost updates');
  const productBCreate = await owner.post('/admin/products', {
    name: `E2E Weighted-Average Widget ${RUN_ID}`,
    sub: 'E2E fixture',
    categoryId,
    kind: 'accessory',
    price: 2000,
    costPrice: 600,
    stockQty: 0,
    localBuying: true,
    lowStockAlert: false,
    lowStockThreshold: 3,
    description: 'Created by the connect-and-test E2E script to prove receiving-cost behaviour.',
  });
  assertEqual(productBCreate.status, 201, 'second product created (0 stock)');
  const productB = productBCreate.body;

  const receive1 = await owner.post(`/admin/products/${productB.id}/receive`, {
    quantity: 10,
    unitCost: 600,
  });
  assertEqual(receive1.status, 200, 'first stock receipt: 10 units @ 600p');
  assertEqual(
    receive1.body?.costPrice,
    600,
    'cost price after first receipt is 600p (only receipt so far)',
  );
  assertEqual(receive1.body?.stockQty, 10, 'stock is 10 after first receipt');

  // Client decision #15 (post-launch): weighted-average cost was removed
  // entirely — the currently-entered cost price now applies to the whole
  // stock volume ("last cost wins"), not a blend with prior receipts. This
  // assertion used to expect a weighted average (800p); it now expects the
  // second receipt's own cost (1000p). See 0063_remove_cost_averaging.sql.
  const receive2 = await owner.post(`/admin/products/${productB.id}/receive`, {
    quantity: 10,
    unitCost: 1000,
  });
  assertEqual(receive2.status, 200, 'second stock receipt: 10 units @ 1000p');
  assertEqual(
    receive2.body?.costPrice,
    1000,
    'cost price after second receipt is the newly-entered cost, not a blend (#15: averaging removed)',
  );
  assertEqual(receive2.body?.stockQty, 20, 'stock is 20 after both receipts (10 + 10)');

  // ---------------------------------------------------------------------
  section('8. Analytics view (owner) and full employee lockout');
  const today = new Date().toISOString().slice(0, 10);
  const analyticsOwner = await owner.get(`/reports/analytics?from=${today}&to=${today}`);
  assertEqual(analyticsOwner.status, 200, 'owner can view analytics');
  assert(
    typeof analyticsOwner.body?.revenue === 'number',
    'analytics response has a numeric revenue figure',
  );

  const employeeSignin = await employee.post('/staff/signin', {
    email: EMPLOYEE_EMAIL,
    password: EMPLOYEE_PASSWORD,
  });
  assertEqual(employeeSignin.status, 200, `employee signs in (${EMPLOYEE_EMAIL})`);

  const empSession = await employee.get('/auth/session');
  assert(
    !(empSession.body?.permissions ?? []).includes('analytics.view'),
    'employee fixture genuinely lacks analytics.view (precondition for the lockout proof)',
  );

  /*
   * A PASSWORD SIGN-IN IS NEVER A POS-ONLY SESSION.
   *
   * Shipped broken and found in use as "catalogue not loading in the till".
   * /staff/signin reuses the most recent open staff_sessions row, and a PIN
   * switch marks its row pos_only (0089). So once anyone had switched into
   * an account, that account's next full email-and-password sign-in landed
   * back on the flagged row and blockPosOnlySession refused the whole admin
   * surface — including GET /admin/products, which is where the TILL reads
   * its catalogue. The grid rendered empty with nothing to explain why, and
   * signing out and back in could not clear it.
   *
   * Two assertions, because either alone would have missed it: the session
   * must not claim pos_only, and an admin read must actually succeed.
   */
  assert(
    empSession.body?.posOnly !== true,
    'a password sign-in is not marked pos_only, even after a previous PIN switch into this account',
  );

  const empCatalogue = await employee.get('/admin/products');
  assertEqual(
    empCatalogue.status,
    200,
    'employee can read the product catalogue the till renders from (GET /admin/products)',
  );

  const empAnalytics = await employee.get(`/reports/analytics?from=${today}&to=${today}`);
  assertEqual(empAnalytics.status, 403, 'employee refused /reports/analytics');

  const empTransactions = await employee.get(`/reports/transactions?from=${today}&to=${today}`);
  assertEqual(empTransactions.status, 403, 'employee refused /reports/transactions');

  const empSettings = await employee.get('/admin/settings');
  assertEqual(empSettings.status, 403, 'employee refused /admin/settings');

  const empStaff = await employee.get('/admin/staff');
  assertEqual(empStaff.status, 403, 'employee refused /admin/staff');

  const empToday = await employee.get('/pos/today');
  assertEqual(empToday.status, 200, "employee CAN still see today's takings (sales.today)");
  assert(
    typeof empToday.body?.total === 'number',
    "today's takings has a numeric total for the employee",
  );

  // ---------------------------------------------------------------------
  section('9. Day-close reconciles to a hand-calculated figure');
  const floatOpen = await owner.post('/pos/cash', {
    kind: 'float-open',
    amount: 15000,
    note: 'E2E float open',
  });
  const floatAlreadyOpen = floatOpen.status === 409;
  assert(
    floatOpen.status === 201 || floatAlreadyOpen,
    `float-open either succeeds or is correctly refused as already-open-today (got ${floatOpen.status})`,
  );

  const dayClose = await owner.post('/pos/day-close', {
    countedAmount: 0, // arbitrary — the check below verifies the server's own arithmetic, not a guess
    note: 'E2E day-close reconciliation check',
  });

  if (dayClose.status === 201) {
    const b = dayClose.body.breakdown;
    const handExpected =
      b.floatOpen +
      b.pettyIn -
      b.pettyOut +
      b.cashSales +
      (b.cashRepairs ?? 0) -
      b.cashRefunds -
      b.cashPayouts;
    assertEqual(
      handExpected,
      dayClose.body.expectedAmount,
      `hand-calculated expected cash (floatOpen ${b.floatOpen} + pettyIn ${b.pettyIn} - pettyOut ${b.pettyOut} + cashSales ${b.cashSales} + cashRepairs ${b.cashRepairs ?? 0} - cashRefunds ${b.cashRefunds} - cashPayouts ${b.cashPayouts}) matches the server's expectedAmount`,
    );
    assertEqual(
      dayClose.body.variance,
      dayClose.body.countedAmount - dayClose.body.expectedAmount,
      'variance = countedAmount - expectedAmount, exactly as the till-count formula defines it',
    );
    log(
      `  Breakdown: floatOpen=${b.floatOpen} pettyIn=${b.pettyIn} pettyOut=${b.pettyOut} cashSales=${b.cashSales} cashRefunds=${b.cashRefunds} cashPayouts=${b.cashPayouts}`,
    );
    log(
      `  expectedAmount=${dayClose.body.expectedAmount} countedAmount=${dayClose.body.countedAmount} variance=${dayClose.body.variance}`,
    );
  } else if (dayClose.status === 409) {
    log(
      '  Trading day already closed (expected on a same-day re-run) — verifying the existing record instead.',
    );
    const existing = await owner.get('/pos/day-close');
    const todayRow = (existing.body as any[])?.find((r: any) => r.date === today);
    assert(!!todayRow, 'an existing day-close record for today is found');
    if (todayRow) {
      assertEqual(
        todayRow.variance,
        todayRow.countedAmount - todayRow.expectedAmount,
        'existing record: variance = countedAmount - expectedAmount holds',
      );
    }
  } else {
    assert(
      false,
      `day-close returned an unexpected status ${dayClose.status}: ${JSON.stringify(dayClose.body)}`,
    );
  }

  // ---------------------------------------------------------------------
  /*
   * A PIN-SWITCHED TILL STAYS POS-ONLY WHEN ITS PERSON SIGNS IN ELSEWHERE.
   *
   * /staff/signin used to reuse the person's most recent open session row
   * and clear pos_only on it. When that row was a till's PIN-switched one,
   * a password sign-in on the back-office laptop handed the till — unlocked
   * on four digits — the whole admin surface. Runs last: switching ends the
   * employee's session and signs the owner in fresh.
   */
  section('10. PIN-switched till keeps its restriction');
  const till = new Client();
  const laptop = new Client();
  const ownerId = (await owner.get('/auth/session')).body?.id as string | undefined;
  const tillSignin = await till.post('/staff/signin', {
    email: EMPLOYEE_EMAIL,
    password: EMPLOYEE_PASSWORD,
  });
  assertEqual(tillSignin.status, 200, 'till signs in as the employee');
  const switched = await till.post('/staff/session/switch', { staffId: ownerId, pin: OWNER_PIN });
  assertEqual(switched.status, 200, 'till PIN-switches into the owner');
  assert(switched.body?.posOnly === true, 'the switched till session is pos_only');

  const laptopSignin = await laptop.post('/staff/signin', {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  assertEqual(laptopSignin.status, 200, 'owner signs in by password on another device');
  assert(laptopSignin.body?.posOnly !== true, 'the laptop session is not pos_only');
  assertEqual(
    (await laptop.get('/admin/settings')).status,
    200,
    'the laptop can reach Admin (owner holds settings.manage)',
  );

  const tillAfter = await till.get('/auth/session');
  assert(
    tillAfter.body?.posOnly === true,
    "the till is STILL pos_only after the owner's password sign-in elsewhere",
  );
  assertEqual((await till.get('/admin/settings')).status, 403, 'the till is still refused Admin');

  // ---------------------------------------------------------------------
  // Retire (not delete — both moved stock, and stock_movements is
  // append-only) the two products this run made. Left active they sit on the
  // staging storefront, which reads this same dev database.
  section('Cleanup');
  for (const product of [productA, productB]) {
    if (!product?.id) continue;
    const retired = await owner.delete(`/admin/products/${product.id}`);
    assertEqual(retired.status, 204, `retired fixture product ${product.name}`);
  }
  // The mail-in booking from section 6 — otherwise every run leaves another
  // "E2E Booking Customer" in staging's Repair Requests queue. By its own id,
  // so nothing else can be touched; there is no staff delete route for it.
  if (booking.body?.id) {
    const removed = await db
      .deleteFrom('bookings')
      .where('id', '=', booking.body.id as string)
      .executeTakeFirst();
    assertEqual(
      Number(removed.numDeletedRows),
      1,
      `removed fixture booking ${booking.body.reference}`,
    );
  }

  // ---------------------------------------------------------------------
  section('Result');
  console.log(`  ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`   - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\nE2E script crashed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
