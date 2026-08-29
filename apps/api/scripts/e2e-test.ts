/**
 * Fonology — full end-to-end connect-and-test pass.
 * =================================================
 * A repeatable script proving the fitting backend surface works together,
 * end to end, against the DEV Supabase project — not just in isolation.
 * Re-runnable before launch: every entity it creates carries a unique
 * timestamp suffix, and any once-per-day action (float-open, day-close)
 * degrades gracefully into a verification-only path on a second run within
 * the same trading day rather than failing the whole script.
 *
 * Requires the API dev server running locally (`npx tsx src/server.ts` from
 * apps/api) against the dev Supabase project. Never touches production.
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

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolved relative to this file, not the CWD the script happens to be
// invoked from (CLAUDE.md documents running it as
// `npx tsx apps/api/scripts/e2e-test.ts` from the repo root).
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'),
});

const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:4000';
const RUN_ID = Date.now().toString(36);

// Bug fix (post-"final pass" report #9a): signup no longer signs the
// customer in — it sends a real confirmation email and waits. This script
// can't read a real inbox, so it uses the service-role admin API to do
// exactly what clicking the link does (mark the address confirmed), the
// same shortcut a human tester can't take but an automated proof
// legitimately can. Never used outside this test script.
const supabaseAdminForTest = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

const OWNER_EMAIL = 'owner@fonology.test';
const OWNER_PASSWORD = 'Test1234!';
// The standing employee account: everyday counter permissions, deliberately
// without analytics/reports/settings/staff — which is what section 8 proves.
const EMPLOYEE_EMAIL = 'staff@fonology.test';
const EMPLOYEE_PASSWORD = 'Test1234!';

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
      const [pair] = line.split(';');
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

  // Supabase's own built-in dev mailer (no custom SMTP configured — see
  // AUTH-EMAIL-SETUP.md) has a very low send quota, easily exhausted by
  // repeated runs of this very script in a short window. That is an
  // environment limit, not a code failure, so it's reported and skipped
  // rather than counted as one — the real endpoint behaviour (correct
  // status, correct error shape) is still being exercised either way.
  const rateLimited = signup.status === 400 && /rate limit/i.test(String(signup.body?.error ?? ''));

  if (rateLimited) {
    log(
      '  ⚠ SKIPPED: customer signup/confirm/signin — Supabase dev mailer rate limit hit ' +
        '(expected with the built-in mailer under repeated runs; see AUTH-EMAIL-SETUP.md ' +
        'for configuring custom SMTP). Not counted as a failure.',
    );
  } else {
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

    // Simulate clicking the confirmation link — see supabaseAdminForTest's
    // own comment above for why this is the one place a shortcut is fair.
    const { data: listed } = await supabaseAdminForTest.auth.admin.listUsers();
    const pendingUser = listed?.users.find((u) => u.email === customerEmail);
    assert(Boolean(pendingUser), 'the pending signup exists in auth.users, unconfirmed');
    if (pendingUser) {
      await supabaseAdminForTest.auth.admin.updateUserById(pendingUser.id, {
        email_confirm: true,
      });
    }

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
  }

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

  const readBackCorrect = await guest.get(
    `/orders/${order.reference}?email=${encodeURIComponent(guestEmail)}`,
  );
  assertEqual(readBackCorrect.status, 200, 'order reads back with the correct email');
  assert(readBackCorrect.body !== null, 'order body is non-null for the correct email');

  const readBackWrong = await guest.get(
    `/orders/${order.reference}?email=wrong-${RUN_ID}@example.invalid`,
  );
  assertEqual(
    readBackWrong.status,
    200,
    'wrong-email lookup still responds 200 (never distinguishes wrong email from no such order)',
  );
  assertEqual(readBackWrong.body, null, 'order is null for the wrong email — refused');

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
  const tiers = await guest.get('/repair/tiers');
  assert(Array.isArray(devices.body) && devices.body.length > 0, 'at least one device exists');
  assert(
    Array.isArray(repairTypes.body) && repairTypes.body.length > 0,
    'at least one repair type exists',
  );
  assert(Array.isArray(tiers.body) && tiers.body.length > 0, 'at least one part tier exists');

  const device = devices.body[0];
  const repairType = repairTypes.body.find((r: any) => r.base !== null) ?? repairTypes.body[0];
  const tier = tiers.body[0];

  const bookingEmail = `e2e-booking-${RUN_ID}@example.invalid`;
  const booking = await guest.post('/repair/bookings', {
    deviceId: device.id,
    repairId: repairType.id,
    tierId: repairType.base ? tier.id : null,
    name: 'E2E Booking Customer',
    phone: '07700900556',
    email: bookingEmail,
    address: '1 E2E Test Lane',
    postcode: 'SW1A 1AA',
    preferredContact: 'email',
  });
  assertEqual(booking.status, 201, 'mail-in booking created');

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
      b.floatOpen + b.pettyIn - b.pettyOut + b.cashSales - b.cashRefunds - b.cashPayouts;
    assertEqual(
      handExpected,
      dayClose.body.expectedAmount,
      `hand-calculated expected cash (floatOpen ${b.floatOpen} + pettyIn ${b.pettyIn} - pettyOut ${b.pettyOut} + cashSales ${b.cashSales} - cashRefunds ${b.cashRefunds} - cashPayouts ${b.cashPayouts}) matches the server's expectedAmount`,
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
  section('Result');
  console.log(`  ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) console.log(`   - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nE2E script crashed:', err);
  process.exitCode = 1;
});
