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
 * Reuses one pre-existing dev-only fixture created during this connect-and-
 * test pass: the owner account `ui-proof-owner@example.invalid`. If that
 * account doesn't exist in your dev project, create it once via:
 *   POST /admin/staff  { name, email: "ui-proof-owner@example.invalid",
 *     password: "UiProofOwner-2026!", role: "owner", phone }
 * (using any existing owner session), then re-run this script.
 */

const API = process.env.E2E_API_BASE ?? 'http://127.0.0.1:4000';
const RUN_ID = Date.now().toString(36);

const OWNER_EMAIL = 'ui-proof-owner@example.invalid';
const OWNER_PASSWORD = 'UiProofOwner-2026!';
// Pre-existing B6 fixture: employee template minus analytics/reports/costs/payments/settings/staff.
const EMPLOYEE_EMAIL = 'b6-employee-proof@example.invalid';
const EMPLOYEE_PASSWORD = 'Correct-Horse-Battery-Staple-9';

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
  section('1. Customer registers and signs in');
  const customerEmail = `e2e-customer-${RUN_ID}@example.invalid`;
  const signup = await customer.post('/auth/customer/signup', {
    name: 'E2E Test Customer',
    email: customerEmail,
    password: 'E2E-Test-Password-9',
  });
  assertEqual(signup.status, 201, `customer signup (${customerEmail})`);

  const custSession = await customer.get('/auth/session');
  assertEqual(custSession.status, 200, 'customer session readable after signup');
  assertEqual(
    custSession.body?.email,
    customerEmail,
    'session email matches the account just created',
  );
  assertEqual(custSession.body?.kind, 'customer', 'session kind is customer');

  // ---------------------------------------------------------------------
  section('Owner signs in (pre-existing dev fixture)');
  const ownerSignin = await owner.post('/staff/signin', {
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
  });
  assertEqual(ownerSignin.status, 200, `owner signs in (${OWNER_EMAIL})`);

  // ---------------------------------------------------------------------
  section('2. Product exists with real stock received at a real cost');
  const productCreate = await owner.post('/admin/products', {
    name: `E2E Shop Widget ${RUN_ID}`,
    sub: 'E2E fixture',
    category: 'power',
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
    category: 'power',
    kind: 'accessory',
    price: 2000,
    costPrice: 600,
    stockQty: 0,
    localBuying: true,
    lowStockAlert: false,
    lowStockThreshold: 3,
    description: 'Created by the connect-and-test E2E script to prove weighted-average cost.',
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

  const receive2 = await owner.post(`/admin/products/${productB.id}/receive`, {
    quantity: 10,
    unitCost: 1000,
  });
  const expectedWeightedAvg = Math.round((10 * 600 + 10 * 1000) / 20);
  assertEqual(receive2.status, 200, 'second stock receipt: 10 units @ 1000p');
  assertEqual(
    receive2.body?.costPrice,
    expectedWeightedAvg,
    `cost price after second receipt is the weighted average (10x600 + 10x1000) / 20 = ${expectedWeightedAvg}p`,
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
