/**
 * Fonology — two-shop isolation pass over the real HTTP API.
 * =========================================================
 * pgTAP proves a shop cannot touch another shop's rows inside the database
 * (supabase/tests/037_shop_isolation.sql). This proves the same through the API a browser
 * uses: sessions, `?shop=` scoping, who may write where, per-device till sessions.
 *
 * Needs the API running on localhost:4000 against the local stack, and the standing dev
 * accounts from seed-dev. It adds a second shop `TEST2` and two accounts (shop2-emp@ / shop2-mgr@fonology.test,
 * password in this file), switches them on for the run and off again afterwards, so the
 * script is re-runnable. Products it creates are retired afterwards.
 *
 * Run:  DATABASE_URL=... pnpm --filter @fonology/api exec tsx scripts/e2e-shops.ts
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertTestWritesAllowed } from '../src/config.js';
import { db, pool } from '../src/lib/db.js';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'),
});

const API = process.env.E2E_API_BASE ?? 'http://localhost:4000';
const RUN_ID = Date.now().toString(36);
const PASSWORD = 'Test1234!';
const OWNER = { email: 'owner@fonology.test', password: 'Test1234!' };
const EMP2 = { email: 'shop2-emp@fonology.test', name: 'Shop Two Employee', phone: '07700900201' };
const MGR2 = { email: 'shop2-mgr@fonology.test', name: 'Shop Two Manager', phone: '07700900202' };

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

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

class Client {
  private cookies = new Map<string, string>();

  async request(method: string, p: string, body?: unknown): Promise<{ status: number; body: any }> {
    const cookieHeader = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${p}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const raw =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of raw) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq !== -1) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }
  get(p: string) {
    return this.request('GET', p);
  }
  post(p: string, body?: unknown) {
    return this.request('POST', p, body ?? {});
  }
  put(p: string, body?: unknown) {
    return this.request('PUT', p, body);
  }
  patch(p: string, body?: unknown) {
    return this.request('PATCH', p, body);
  }
}

async function signIn(who: { email: string }, password = PASSWORD): Promise<Client> {
  const c = new Client();
  const r = await c.post('/staff/signin', { email: who.email, password });
  if (r.status !== 200) throw new Error(`sign-in failed for ${who.email}: ${r.status}`);
  return c;
}

async function main() {
  assertTestWritesAllowed('e2e-shops');

  // ---------------------------------------------------------------------
  section('0. Setup — a second shop and two accounts in it');
  let shop2 = await db
    .selectFrom('shops')
    .select('id')
    .where('code', '=', 'TEST2')
    .executeTakeFirst();
  if (!shop2) {
    shop2 = await db
      .insertInto('shops')
      .values({ code: 'TEST2', name: 'Test Shop Two', sort_order: 99 })
      .returning('id')
      .executeTakeFirstOrThrow();
  }
  await db.updateTable('shops').set({ is_active: true }).where('id', '=', shop2.id).execute();
  const S2 = shop2.id;
  const shop1 = await db
    .selectFrom('shops')
    .select('id')
    .where('is_fulfilment_hub', '=', true)
    .executeTakeFirstOrThrow();
  const S1 = shop1.id;
  assert(S1 !== S2, 'two distinct shops exist');

  const owner = await signIn(OWNER);

  for (const [who, role, shopId] of [
    [EMP2, 'employee', S2],
    [MGR2, 'manager', S1],
  ] as const) {
    const made = await owner.post('/admin/staff', {
      name: who.name,
      email: who.email,
      role,
      shopId,
      phone: who.phone,
      password: PASSWORD,
    });
    if (made.status === 201) {
      assertEqual(made.body?.shopId, shopId, `${role} created in the right shop`);
    } else {
      // Already there from an earlier run: make sure it is active and in the right shop.
      const row = await db
        .selectFrom('staff')
        .select('id')
        .where('email', '=', who.email)
        .executeTakeFirstOrThrow();
      await db
        .updateTable('staff')
        .set({ is_active: true, shop_id: shopId, role })
        .where('id', '=', row.id)
        .execute();
      assert(true, `${role} account already exists — reset to its shop`);
    }
  }
  const mgrRow = await db
    .selectFrom('staff')
    .select('id')
    .where('email', '=', MGR2.email)
    .executeTakeFirstOrThrow();
  const mgrPerms = await db
    .selectFrom('staff_permissions')
    .select('permission')
    .where('staff_id', '=', mgrRow.id)
    .execute();
  assert(
    mgrPerms.some((p) => p.permission === 'analytics.view') &&
      !mgrPerms.some((p) => p.permission === 'staff.manage'),
    'a manager starts with analytics but not staff management',
  );

  // Returns are not an everyday employee permission; this account needs it for section 7.
  const empRow = await db
    .selectFrom('staff')
    .select('id')
    .where('email', '=', EMP2.email)
    .executeTakeFirstOrThrow();
  await db
    .insertInto('staff_permissions')
    .values({ staff_id: empRow.id, permission: 'returns.manage' })
    .onConflict((oc) => oc.doNothing())
    .execute();

  const emp = await signIn(EMP2);
  const mgr = await signIn(MGR2);

  const categories = await owner.get('/admin/categories');
  const categoryId: string = categories.body?.[0]?.id;
  assert(Boolean(categoryId), 'a category is available');

  const newProduct = (name: string, stockQty: number) => ({
    name,
    sub: 'E2E shops fixture',
    categoryId,
    kind: 'accessory',
    price: 1500,
    costPrice: 700,
    stockQty,
    localBuying: true,
    lowStockAlert: false,
    lowStockThreshold: 3,
    description: 'Created by e2e-shops.',
  });

  // ---------------------------------------------------------------------
  section('1. Products belong to a shop');
  const p1r = await owner.post('/admin/products', newProduct(`Shops A ${RUN_ID}`, 10));
  assertEqual(p1r.status, 201, 'owner creates a product (in their own shop, Shop 1)');
  const p1 = p1r.body;
  const p2r = await owner.post(`/admin/products?shop=${S2}`, newProduct(`Shops B ${RUN_ID}`, 10));
  assertEqual(p2r.status, 201, 'owner creates a product in Shop 2 by naming it');
  const p2 = p2r.body;
  const rows = await db
    .selectFrom('products')
    .select(['id', 'shop_id'])
    .where('id', 'in', [p1.id, p2.id])
    .execute();
  assertEqual(rows.find((r) => r.id === p1.id)?.shop_id, S1, 'product 1 is in Shop 1');
  assertEqual(rows.find((r) => r.id === p2.id)?.shop_id, S2, 'product 2 is in Shop 2');

  const empList = await emp.get('/admin/products');
  const empIds = new Set((empList.body as any[]).map((p) => p.id));
  assert(empIds.has(p2.id), 'a Shop 2 employee sees their own product');
  assert(!empIds.has(p1.id), 'and does NOT see a Shop 1 product');

  const ownerList = await owner.get('/admin/products');
  const ownerIds = new Set((ownerList.body as any[]).map((p) => p.id));
  assert(ownerIds.has(p1.id) && !ownerIds.has(p2.id), 'the owner defaults to their own shop');
  const allList = await owner.get('/admin/products?shop=all');
  const allIds = new Set((allList.body as any[]).map((p) => p.id));
  assert(allIds.has(p1.id) && allIds.has(p2.id), '?shop=all shows every shop to the owner');
  const empAll = await emp.get('/admin/products?shop=all');
  assert(
    !(empAll.body as any[]).some((p) => p.id === p1.id),
    '?shop=all does nothing for an employee',
  );

  const empEdit = await emp.put(`/admin/products/${p1.id}`, newProduct('Hacked', 1));
  assertEqual(empEdit.status, 404, 'a Shop 2 employee cannot edit a Shop 1 product');
  const empStock = await emp.post(`/admin/products/${p1.id}/stock`, { delta: 5 });
  assertEqual(empStock.status, 404, 'nor adjust its stock');
  const empVariants = await emp.get(`/admin/products/${p1.id}/variants`);
  assertEqual(empVariants.status, 404, 'nor read its variants');

  // ---------------------------------------------------------------------
  section('2. The public site sells the hub shop only');
  const pub = await new Client().get('/products');
  const pubNames = (pub.body as any[]).map((p) => p.name);
  assert(pubNames.includes(`Shops A ${RUN_ID}`), 'the Shop 1 product is on the public site');
  assert(!pubNames.includes(`Shops B ${RUN_ID}`), 'the Shop 2 product is NOT');
  const guestOrder = await new Client().post('/orders', {
    lines: [{ productId: p2.id, quantity: 1 }],
    email: `e2e-shops-${RUN_ID}@example.invalid`,
    firstName: 'E2E',
    lastName: 'Shops',
    phone: '07700900555',
    delivery: 'collect',
  });
  assert(guestOrder.status >= 400, 'an online order for a Shop 2 product is refused');

  // ---------------------------------------------------------------------
  section("3. The till sells its own shop's stock only");
  const todayBefore2 = (await emp.get('/pos/today')).body;
  const todayBefore1 = (await owner.get('/pos/today')).body;
  const wrong = await emp.post('/pos/sales', {
    lines: [{ productId: p1.id, quantity: 1 }],
    discount: 0,
    payments: [{ tender: 'cash', amount: 1500 }],
  });
  assert(wrong.status >= 400, 'a Shop 2 till cannot ring up a Shop 1 product');
  const sale2 = await emp.post('/pos/sales', {
    lines: [{ productId: p2.id, quantity: 1 }],
    discount: 0,
    payments: [{ tender: 'cash', amount: 1500 }],
  });
  assertEqual(sale2.status, 201, 'a Shop 2 till rings up a Shop 2 product');
  const todayAfter2 = (await emp.get('/pos/today')).body;
  const todayAfter1 = (await owner.get('/pos/today')).body;
  assertEqual(todayAfter2.total - todayBefore2.total, 1500, "Shop 2's takings rose by the sale");
  assertEqual(todayAfter1.total, todayBefore1.total, "Shop 1's takings did not move");

  // ---------------------------------------------------------------------
  section('4. Cash, day close and card limits are per shop');
  const float = await emp.post('/pos/cash', {
    kind: 'float-open',
    amount: 10000,
    note: 'e2e float',
  });
  assert(
    float.status === 201 || float.status === 409,
    'Shop 2 opens its own float (or already has)',
  );
  const cashEmp = await emp.get('/pos/cash');
  const cashOwner = await owner.get('/pos/cash');
  const empCashIds = new Set((cashEmp.body as any[]).map((c) => c.id));
  assert(
    (cashOwner.body as any[]).every((c) => !empCashIds.has(c.id)),
    "Shop 1's cash list shares no entry with Shop 2's",
  );
  const close = await emp.post('/pos/day-close', { countedAmount: 11500, note: 'e2e' });
  assert(
    close.status === 201 || close.status === 409,
    'Shop 2 closes its own day (or already did)',
  );
  const closesEmp = await emp.get('/pos/day-close');
  assert(
    (closesEmp.body as any[]).every((c) => c.id),
    'Shop 2 can read its day closes',
  );
  const dc = await db
    .selectFrom('day_close')
    .select(['shop_id'])
    .where(
      'id',
      'in',
      (closesEmp.body as any[]).map((c) => c.id),
    )
    .execute();
  assert(
    dc.length === 0 || dc.every((d) => d.shop_id === S2),
    "Shop 2 only sees Shop 2's day closes",
  );

  const setLimit = await owner.patch(`/admin/settings?shop=${S2}`, { card1DailyLimit: 100 });
  assertEqual(setLimit.status, 200, 'owner sets a card limit on Shop 2');
  const check2 = await emp.post('/pos/card-limits/check', { tender: 'pos1', amount: 5000 });
  assertEqual(check2.body?.allowed, false, "Shop 2's card limit blocks a £50 payment");
  const own1 = await owner.get('/admin/settings');
  assert(own1.body?.card1DailyLimit !== 100, "Shop 1's own card limit is not Shop 2's");
  await owner.patch(`/admin/settings?shop=${S2}`, { card1DailyLimit: null });

  // ---------------------------------------------------------------------
  section('5. Jobs and reports');
  const job1 = await owner.post('/jobs', {
    source: 'walk_in',
    customerName: `Shops Customer ${RUN_ID}`,
    deviceDescription: 'Phone',
    problemDescription: 'Screen',
    quotedPrice: 5000,
  });
  assertEqual(job1.status, 201, 'a Shop 1 job is created');
  const job2 = await emp.post('/jobs', {
    source: 'walk_in',
    customerName: `Shops Customer ${RUN_ID} S2`,
    deviceDescription: 'Phone',
    problemDescription: 'Screen',
    quotedPrice: 5000,
  });
  assertEqual(job2.status, 201, 'a Shop 2 job is created');
  const jobRows = await db
    .selectFrom('jobs')
    .select(['id', 'shop_id'])
    .where('id', 'in', [job1.body.id, job2.body.id])
    .execute();
  assertEqual(jobRows.find((j) => j.id === job1.body.id)?.shop_id, S1, 'job 1 is in Shop 1');
  assertEqual(jobRows.find((j) => j.id === job2.body.id)?.shop_id, S2, 'job 2 is in Shop 2');
  assertEqual(
    (await emp.get(`/jobs/${job1.body.id}`)).status,
    404,
    'Shop 2 cannot open a Shop 1 job',
  );
  const pay = await emp.post(`/jobs/${job1.body.id}/payments`, {
    kind: 'deposit',
    amount: 1000,
    tender: 'cash',
  });
  assertEqual(pay.status, 404, 'nor pay on it');
  const empJobs = await emp.get('/jobs?limit=100');
  const empJobIds = ((empJobs.body?.items ?? empJobs.body?.data ?? []) as any[]).map((j) => j.id);
  assert(
    empJobIds.includes(job2.body.id) && !empJobIds.includes(job1.body.id),
    'job lists are per shop',
  );

  const today = new Date().toISOString().slice(0, 10);
  const rep = (c: Client, q: string) => c.get(`/reports/analytics?from=${today}&to=${today}${q}`);
  const repS2 = await rep(mgr, `&shop=${S2}`);
  const repS1 = await rep(mgr, `&shop=${S1}`);
  const repAll = await rep(mgr, '&shop=all');
  assertEqual(repS2.status, 200, 'a manager can read Shop 2 reports');
  assertEqual(
    repAll.body?.revenue,
    (repS1.body?.revenue ?? 0) + (repS2.body?.revenue ?? 0),
    'combined revenue is the sum of the two shops',
  );
  assert((repS2.body?.revenue ?? 0) >= 1500, "Shop 2's revenue includes its sale");

  // ---------------------------------------------------------------------
  section('6. Managers read everywhere, write at home');
  const mgrAll = await mgr.get('/admin/products?shop=all');
  const mgrIds = new Set((mgrAll.body as any[]).map((p) => p.id));
  assert(mgrIds.has(p1.id) && mgrIds.has(p2.id), 'a manager sees both shops');
  assertEqual(
    (await mgr.put(`/admin/products/${p2.id}`, newProduct('Nope', 1))).status,
    404,
    'a Shop 1 manager cannot edit a Shop 2 product',
  );
  assertEqual(
    (await mgr.post(`/admin/products?shop=${S2}`, newProduct(`Nope ${RUN_ID}`, 1))).status,
    403,
    'nor create stock in Shop 2',
  );

  // ---------------------------------------------------------------------
  section('7. A cross-shop refund');
  const sale1 = await owner.post('/pos/sales', {
    lines: [{ productId: p1.id, quantity: 1 }],
    discount: 0,
    payments: [{ tender: 'cash', amount: 1500 }],
  });
  assertEqual(sale1.status, 201, 'a Shop 1 sale to refund');
  const stockBefore = (
    await db
      .selectFrom('products')
      .select('stock_qty')
      .where('id', '=', p1.id)
      .executeTakeFirstOrThrow()
  ).stock_qty;
  const refund = await emp.post('/pos/refunds', {
    source: 'counter',
    reference: sale1.body.reference,
    lines: [{ productId: p1.id, variantId: null, name: p1.name, quantity: 1, unitPrice: 1500 }],
    amount: 1500,
    reason: 'e2e cross-shop return',
    tender: 'cash',
    restock: true,
    override: false,
  });
  assertEqual(refund.status, 201, 'Shop 2 refunds a Shop 1 sale');
  const rrow = await db
    .selectFrom('refunds')
    .select(['shop_id', 'original_shop_id'])
    .where('id', '=', refund.body.id)
    .executeTakeFirstOrThrow();
  assertEqual(rrow.shop_id, S2, 'the cash left the refunding shop');
  assertEqual(rrow.original_shop_id, S1, 'the refund remembers the original shop');
  const stockAfter = (
    await db
      .selectFrom('products')
      .select('stock_qty')
      .where('id', '=', p1.id)
      .executeTakeFirstOrThrow()
  ).stock_qty;
  assertEqual(stockAfter, stockBefore, "Shop 1's stock is not restocked by another shop");

  // ---------------------------------------------------------------------
  section('8. Till sessions belong to a device');
  const deviceA = await signIn(EMP2);
  const deviceB = await signIn(EMP2);
  const sa = await deviceA.get('/auth/session');
  const sb = await deviceB.get('/auth/session');
  assert(
    sa.body?.staffSessionId &&
      sb.body?.staffSessionId &&
      sa.body.staffSessionId !== sb.body.staffSessionId,
    'two devices signed in as one person get separate sessions',
  );
  await deviceA.post('/staff/session/lock');
  const sa2 = await deviceA.get('/auth/session');
  const sb2 = await deviceB.get('/auth/session');
  assertEqual(sa2.body?.locked, true, 'locking one device locks it');
  assertEqual(sb2.body?.locked, false, 'and leaves the other device unlocked');
  const again = await new Client();
  void again;

  // ---------------------------------------------------------------------
  section('9. Printing follows the shop');
  const printed = await emp.post('/print/jobs', {
    kind: 'day_report',
    dedupeKey: `e2e-shops-${RUN_ID}`,
  });
  assert(printed.status === 201 || printed.status === 200, 'a day report is queued');
  const pj = await db
    .selectFrom('print_jobs')
    .select('shop_id')
    .where('dedupe_key', '=', `e2e-shops-${RUN_ID}`)
    .executeTakeFirst();
  assertEqual(pj?.shop_id, S2, "the print job belongs to the requester's shop");

  // ---------------------------------------------------------------------
  section('Cleanup');
  for (const id of [p1.id, p2.id]) {
    await db.updateTable('products').set({ is_active: false }).where('id', '=', id).execute();
  }
  await db
    .updateTable('jobs')
    .set({ status: 'cancelled', cancellation_reason: 'e2e-shops fixture' })
    .where('id', 'in', [job1.body.id, job2.body.id])
    .execute()
    .catch(() => undefined);
  await db
    .deleteFrom('print_jobs')
    .where('dedupe_key', '=', `e2e-shops-${RUN_ID}`)
    .execute()
    .catch(() => undefined);
  // Left in the database but switched off, so they never show up in the real staff list or
  // shop picker. The next run switches them back on.
  await db
    .updateTable('staff')
    .set({ is_active: false })
    .where('email', 'in', [EMP2.email, MGR2.email])
    .execute();
  await db.updateTable('shops').set({ is_active: false }).where('id', '=', S2).execute();
  console.log('  products retired; test shop and accounts switched off for the next run');

  console.log(`\n=== Result ===\n  ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    for (const f of failures) console.log(`   - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
