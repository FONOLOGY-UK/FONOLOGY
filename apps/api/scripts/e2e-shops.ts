/**
 * Fonology — two-shop isolation pass over the real HTTP API.
 * =========================================================
 * pgTAP proves a shop cannot touch another shop's rows inside the database
 * (supabase/tests/037_shop_isolation.sql). This proves the same through the API a browser
 * uses: sessions, `?shop=` scoping, who may write where, per-device till sessions.
 *
 * Needs the API running on localhost:4000 against the local stack, and the standing dev
 * accounts from seed-dev. It adds a second shop `Test Shop Two` and two accounts (shop2-emp@ / shop2-mgr@fonology.test,
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
  delete(p: string) {
    return this.request('DELETE', p);
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
  // Found by name, not code: codes are assigned by the database (F02, F03 …, 0106), and a shop
  // is never deleted, so creating a fresh one per run would use up a code every time.
  let shop2 = await db
    .selectFrom('shops')
    .select(['id', 'code'])
    .where('name', '=', 'Test Shop Two')
    .orderBy('created_at')
    .executeTakeFirst();
  if (!shop2) {
    shop2 = await db
      .insertInto('shops')
      .values({ name: 'Test Shop Two', sort_order: 99 })
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();
  }
  await db.updateTable('shops').set({ is_active: true }).where('id', '=', shop2.id).execute();
  const S2 = shop2.id;
  // [SHOP]-[PREFIX]-[DDMMYY][NNN]; NNN grows a digit after 999.
  const numbered = (shopCode: string, prefix: string) =>
    new RegExp(`^${shopCode}-${prefix}-[0-9]{9,}$`);
  const shop1 = await db
    .selectFrom('shops')
    .select(['id', 'code'])
    .where('is_fulfilment_hub', '=', true)
    .executeTakeFirstOrThrow();
  const S1 = shop1.id;
  assert(S1 !== S2, 'two distinct shops exist');
  assertEqual(shop1.code, 'F01', 'the hub is F01');

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
  const p2r = await owner.post(`/admin/products?shop=${S2}`, {
    ...newProduct(`Shops B ${RUN_ID}`, 10),
    addToMaster: false, // a till-only product
  });
  assertEqual(p2r.status, 201, 'owner creates a till-only product in Shop 2 by naming it');
  assertEqual(
    p2r.body?.masterProductId,
    null,
    'unticking "Add to Master List" keeps it off the master',
  );
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
  const empVariants = await emp.get(`/admin/products/${p1.id}/variations`);
  assertEqual(empVariants.status, 404, 'nor read its variations');

  // ---------------------------------------------------------------------
  section('2. The public site sells the hub shop only');
  const pub = await new Client().get('/products');
  const pubNames = (pub.body as any[]).map((p) => p.name);
  assert(pubNames.includes(`Shops A ${RUN_ID}`), 'the Shop 1 product is on the public site');
  assert(!pubNames.includes(`Shops B ${RUN_ID}`), 'the till-only Shop 2 product is NOT');
  assert(p1.masterProductId, 'a new product joins the master list by default');
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
  section('2b. The master list — one listing, the higher price, combined stock');
  const found = await emp.get(`/admin/master?search=${encodeURIComponent(`Shops A ${RUN_ID}`)}`);
  const hit = (found.body as any[])?.find((m) => m.id === p1.masterProductId);
  assert(Boolean(hit), 'a Shop 2 employee finds the product in the master list');
  assertEqual(hit?.inMyShop, false, '...which their shop does not hold yet');
  assert(
    hit && !('price' in hit) && !('stockQty' in hit) && !('costPrice' in hit),
    "the picker shows no other shop's price, stock or cost",
  );
  const copied = await emp.post(`/admin/master/${p1.masterProductId}/copy`);
  assertEqual(copied.status, 201, 'they copy it into their shop');
  assertEqual(
    copied.body?.masterProductId,
    p1.masterProductId,
    'the copy is linked to the same master',
  );
  assertEqual(copied.body?.stockQty, 0, '...with no stock of its own to start');
  assertEqual(
    (await emp.post(`/admin/master/${p1.masterProductId}/copy`)).status,
    409,
    'a shop cannot hold two copies',
  );
  const copyId: string = copied.body.id;
  // Each shop counts and prices its own: Shop 1 has 1 at £15, Shop 2 has 1 at £20.
  await db.updateTable('products').set({ stock_qty: 1 }).where('id', '=', p1.id).execute();
  await db
    .updateTable('products')
    .set({ stock_qty: 1, price: 2000 })
    .where('id', '=', copyId)
    .execute();

  const listing = ((await new Client().get('/products')).body as any[]).filter(
    (p) => p.name === `Shops A ${RUN_ID}`,
  );
  assertEqual(listing.length, 1, 'the website lists the product once');
  assertEqual(listing[0]?.price, 2000, "at the higher of the two shops' prices");
  assertEqual(listing[0]?.slug, p1.slug, "under the master's address");
  assertEqual(
    ((await new Client().get(`/products/${p1.slug}`)).body as any)?.price,
    2000,
    'and its page shows the same price',
  );
  const avail2 = await new Client().get(`/products/${listing[0].id}/availability?quantity=2`);
  assertEqual(avail2.body?.available, true, 'two are available although each shop holds one');
  const avail3 = await new Client().get(`/products/${listing[0].id}/availability?quantity=3`);
  assertEqual(avail3.body?.available, false, 'three are not');
  // Bug report v1, BUG-001: the bag goes as high as the shops hold together — there used to be a
  // fixed ceiling of 10, whatever the stock.
  await db.updateTable('products').set({ stock_qty: 25 }).where('id', '=', p1.id).execute();
  await db.updateTable('products').set({ stock_qty: 10 }).where('id', '=', copyId).execute();
  const avail35 = await new Client().get(`/products/${listing[0].id}/availability?quantity=35`);
  assertEqual(avail35.body?.available, true, '25 + 10 in the two shops: 35 fit in the bag');
  const avail36 = await new Client().get(`/products/${listing[0].id}/availability?quantity=36`);
  assertEqual(avail36.body?.available, false, '...36 do not');
  await db
    .updateTable('products')
    .set({ stock_qty: 1 })
    .where('id', 'in', [p1.id, copyId])
    .execute();
  const shopOwn = await emp.get('/admin/products');
  assertEqual(
    (shopOwn.body as any[]).find((p) => p.id === copyId)?.price,
    2000,
    "Shop 2's till keeps its own price",
  );
  assertEqual(
    (await owner.get('/admin/products')).body.find((p: any) => p.id === p1.id)?.price,
    1500,
    "and Shop 1's keeps £15",
  );

  const orderQ = await new Client().post('/orders', {
    lines: [{ productId: listing[0].id, quantity: 2 }],
    email: `e2e-master-${RUN_ID}@example.invalid`,
    firstName: 'E2E',
    lastName: 'Master',
    phone: '07700900555',
    delivery: 'collect',
  });
  assertEqual(orderQ.status, 201, 'an order for two is accepted');
  assertEqual(orderQ.body?.total, 4000, 'priced at the higher price: 2 x £20');
  const orderLines = await db
    .selectFrom('order_lines')
    .innerJoin('products', 'products.id', 'order_lines.product_id')
    .select(['products.shop_id', 'order_lines.quantity', 'order_lines.unit_price'])
    .where('order_lines.order_id', '=', orderQ.body.id)
    .execute();
  assertEqual(orderLines.length, 2, 'it is split into a line per supplying shop');
  assert(
    orderLines.some((l) => l.shop_id === S1) && orderLines.some((l) => l.shop_id === S2),
    "...one from each shop (Shop 1's first)",
  );
  // Bug report v1, BUG-002: the confirmation page asks this, proving it paid with the intent id.
  const intentId = `pi_e2e_${RUN_ID}`;
  await db
    .updateTable('orders')
    .set({ provider_reference: intentId })
    .where('id', '=', orderQ.body.id)
    .execute();
  const statusPath = `/orders/${orderQ.body.reference}/payment-status`;
  assertEqual(
    (await new Client().get(`${statusPath}?intent=${intentId}`)).body?.paid,
    false,
    'the confirmation page hears "not paid yet" while the order is pending',
  );
  assertEqual(
    (await new Client().get(`${statusPath}?intent=pi_someone_else`)).body,
    null,
    '...and nothing at all without the right payment intent',
  );
  const paid = await owner.post(`/orders/${orderQ.body.reference}/paid`, {});
  assertEqual(paid.status, 200, 'the hub shop marks it paid');
  assertEqual(
    (await new Client().get(`${statusPath}?intent=${intentId}`)).body?.paid,
    true,
    '...after which the confirmation page hears "paid"',
  );
  const after = await db
    .selectFrom('products')
    .select(['id', 'stock_qty'])
    .where('id', 'in', [p1.id, copyId])
    .execute();
  assert(
    after.every((p) => p.stock_qty === 0),
    'paying takes each unit from the shop it came from',
  );
  const cancelled = await owner.post(`/orders/id/${orderQ.body.id}/status`, {
    status: 'cancelled',
  });
  assertEqual(cancelled.status, 200, 'cancelling...');
  const back = await db
    .selectFrom('products')
    .select(['id', 'stock_qty'])
    .where('id', 'in', [p1.id, copyId])
    .execute();
  assert(
    back.every((p) => p.stock_qty === 1),
    '...puts each unit back where it came from',
  );

  const unlinked = await emp.delete(`/admin/products/${copyId}/master`);
  assertEqual(unlinked.status, 200, 'Shop 2 takes its copy off the master list');
  const listing2 = ((await new Client().get('/products')).body as any[]).find(
    (p) => p.name === `Shops A ${RUN_ID}`,
  );
  assertEqual(listing2?.price, 1500, "the website price falls back to Shop 1's");
  assertEqual(
    (await new Client().get(`/products/${listing[0].id}/availability?quantity=2`)).body?.available,
    false,
    "and only Shop 1's one unit is for sale",
  );

  // ---------------------------------------------------------------------
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
  assert(
    numbered(shop2.code, 'SAL').test(sale2.body?.reference),
    "its receipt number carries the shop's code",
  );
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
  assert(
    numbered(shop2.code, 'JOB').test(job2.body?.reference),
    "its job number carries the shop's code",
  );
  assert(numbered('F01', 'JOB').test(job1.body?.reference), "Shop 1's jobs carry F01");
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
  assert(numbered('F01', 'SAL').test(sale1.body?.reference), "the hub shop's receipts carry F01");
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
  assert(
    numbered(shop2.code, 'REF').test(refund.body?.refundReference),
    "the refund's own number carries Shop 2's code",
  );
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
  section('10. A promotion with a box per shop');
  await db
    .insertInto('staff_permissions')
    .values({ staff_id: empRow.id, permission: 'promotions.manage' })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const copy2 = await emp.post(`/admin/master/${p1.masterProductId}/copy`);
  assertEqual(copy2.status, 201, 'Shop 2 holds a copy again');
  const offer = {
    label: `E2E Shops Offer ${RUN_ID}`,
    productIds: [p1.id],
    tiers: [{ minQty: 2, unitPrice: 1000 }],
    active: true,
  };
  const both = await owner.post('/admin/promotions/bulk', { ...offer, shopIds: [S1, S2] });
  assertEqual(both.status, 201, 'the owner runs one offer in both shops');
  assertEqual(both.body?.productIds?.length, 2, "it holds each shop's own copy");
  assertEqual(both.body?.shopIds?.length, 2, 'and says it runs in two shops');
  assertEqual(both.body?.skipped?.length, 0, 'no shop was skipped');
  const groupId: string = both.body.groupId;
  const price2 = await emp.get('/admin/promotions');
  assert(
    (price2.body as any[]).some((p) => p.productIds?.includes(copy2.body.id)),
    "Shop 2's till sees the offer on its own copy",
  );
  assert(!(price2.body as any[]).some((p) => p.productIds?.includes(p1.id)), "and not on Shop 1's");
  const empGroups = await emp.get('/admin/promotions/groups');
  const seen = (empGroups.body as any[]).find((g) => g.groupId === groupId);
  assertEqual(seen?.shopIds?.length, 1, 'a Shop 2 employee sees only their own shop in it');
  assertEqual(
    (await emp.post('/admin/promotions/bulk', { ...offer, shopIds: [S1] })).status,
    403,
    'an employee cannot run an offer in another shop',
  );
  assertEqual(
    (await mgr.post('/admin/promotions/bulk', { ...offer, label: 'Mgr offer', shopIds: [S2] }))
      .status,
    403,
    'nor can a manager',
  );
  assertEqual(
    (await emp.delete(`/admin/promotions/group/${groupId}`)).status,
    404,
    'Shop 2 cannot delete an offer that also runs in Shop 1',
  );
  const onlyS1 = await owner.post('/admin/promotions/bulk', { ...offer, groupId, shopIds: [S1] });
  assertEqual(onlyS1.status, 200, 'unticking Shop 2 edits the offer');
  assertEqual(onlyS1.body?.productIds?.length, 1, '...and removes it from Shop 2');
  assertEqual(
    (await owner.delete(`/admin/promotions/group/${groupId}`)).status,
    204,
    'the owner deletes it',
  );

  // ---------------------------------------------------------------------
  section('11. Cost prices stay with costs.view');
  // emp is a plain employee (no costs.view); the owner has it.
  const costP = await db
    .insertInto('products')
    .values({
      slug: `e2e-cost-${RUN_ID}`,
      name: `Shops Cost ${RUN_ID}`,
      category_id: categoryId,
      price: 1000,
      cost_price: 800,
      stock_qty: 5,
      shop_id: S2,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const seenByEmp = ((await emp.get('/admin/products')).body as any[]).find(
    (p) => p.id === costP.id,
  );
  assertEqual(seenByEmp?.costPrice, 0, "an employee is not sent a product's cost price");
  const seenByOwner = ((await owner.get(`/admin/products?shop=${S2}`)).body as any[]).find(
    (p) => p.id === costP.id,
  );
  assertEqual(seenByOwner?.costPrice, 800, 'the owner is');
  const inv = await emp.get('/admin/inventory/summary');
  assertEqual(inv.body?.totalValuePence, 0, "nor the stock's value at cost");

  // Editing without being able to read the cost must not wipe it.
  const edit = await emp.put(`/admin/products/${costP.id}`, {
    ...newProduct(`Shops Cost ${RUN_ID}`, 5),
    costPrice: 0,
    price: 1100,
  });
  assertEqual(edit.status, 200, 'an employee can still edit a product');
  const afterEdit = await db
    .selectFrom('products')
    .select(['cost_price', 'price'])
    .where('id', '=', costP.id)
    .executeTakeFirstOrThrow();
  assertEqual(afterEdit.cost_price, 800, '...and the cost they could not see is untouched');
  assertEqual(afterEdit.price, 1100, '...while the price they changed is saved');

  // The below-cost warning is a server answer.
  const lineFor = (qty: number) => [
    {
      productId: costP.id,
      variantId: null,
      name: 'x',
      quantity: qty,
      unitPrice: 1100,
      listPrice: 1100,
      costPrice: 0,
      tierApplied: false,
    },
  ];
  const okTicket = await emp.post('/pos/sales/below-cost', { lines: lineFor(1), discount: 0 });
  assertEqual(okTicket.body?.belowCost, false, '£11 against a £8 cost is not below cost');
  const lowTicket = await emp.post('/pos/sales/below-cost', { lines: lineFor(1), discount: 400 });
  assertEqual(lowTicket.body?.belowCost, true, 'a £4 discount takes it to £7, below its £8 cost');
  const sold = await emp.post('/pos/sales', {
    lines: lineFor(1),
    discount: 0,
    payments: [{ tender: 'cash', amount: 1100 }],
  });
  assertEqual(sold.status, 201, 'the sale goes through');
  assertEqual(sold.body?.cost, 0, "a till operator's sale receipt carries no cost figure");
  assertEqual(sold.body?.lines?.[0]?.costPrice, 0, '...or per-line cost');
  assertEqual(
    (
      await emp.post('/pos/sales/below-cost', {
        lines: [{ ...lineFor(1)[0], productId: p1.id }],
        discount: 0,
      })
    ).status,
    400,
    "a Shop 1 product can't be priced at a Shop 2 till",
  );

  // ---------------------------------------------------------------------
  section('12. The shop comparison, and paged lists with whole-list totals');
  const cmp = await mgr.get(`/reports/analytics/compare?from=${today}&to=${today}`);
  assertEqual(cmp.status, 200, 'a manager gets the side-by-side report');
  const row2 = (cmp.body?.shops as any[])?.find((x) => x.shopId === S2);
  assert(Boolean(row2) && cmp.body.shops.length >= 2, 'it lists each open shop');
  assertEqual(
    cmp.body?.combined?.revenue,
    (cmp.body?.shops as any[]).reduce((n, x) => n + x.revenue, 0),
    "and the combined revenue is the shops' sum",
  );
  assertEqual(
    (await emp.get(`/reports/analytics/compare?from=${today}&to=${today}`)).status,
    403,
    "an employee can't compare shops",
  );

  const allRefunds = (await owner.get('/pos/refunds?shop=all')).body as any[];
  const pagedRefunds = (await owner.get('/pos/refunds?shop=all&limit=1&offset=0')).body;
  assertEqual(pagedRefunds?.items?.length, 1, 'a paged list returns one page');
  assertEqual(pagedRefunds?.total, allRefunds.length, '...with the true total');
  assertEqual(
    pagedRefunds?.totals?.amount,
    allRefunds.reduce((n, r) => n + r.amount, 0),
    "...and whole-list figures, not just the page's",
  );
  assert(Array.isArray(allRefunds), 'without limit the list is the same plain array as before');
  const tx = (await owner.get(`/reports/transactions?from=${today}&to=${today}&shop=all&limit=2`))
    .body;
  assert(
    tx?.items?.length <= 2 && tx?.totals && typeof tx.totals.net === 'number',
    'the payments ledger pages with in/out/net',
  );
  const cash = (await owner.get('/pos/cash?shop=all&limit=5')).body;
  assert(cash?.totals && 'pettyIn' in cash.totals, 'the cash list pages with its sums');
  const ords = (await owner.get('/orders?shop=all&limit=5')).body;
  assert(
    Array.isArray(ords?.items) && ords.totals && 'value' in ords.totals,
    'orders page with a value total',
  );
  const closes = (await owner.get('/pos/day-close?shop=all&limit=5')).body;
  assert(
    Array.isArray(closes?.items) && 'variance' in closes.totals,
    'day closes page with variance',
  );
  const books = (await owner.get('/repair/bookings?shop=all&limit=5')).body;
  assert(Array.isArray(books?.items) && books.totals, 'repair requests page');
  await db.updateTable('products').set({ is_active: false }).where('id', '=', costP.id).execute();

  // ---------------------------------------------------------------------
  section('13. Repairs are paid at the till, and cancelling gives the money back');
  const newJob = async (label: string) => {
    const made = await emp.post('/jobs', {
      source: 'walk_in',
      customerName: `Shops Customer ${RUN_ID} ${label}`,
      deviceDescription: 'Phone',
      problemDescription: 'Screen',
      quotedPrice: 5000,
    });
    return made.body;
  };
  const jobA = await newJob('A');
  const split = await emp.post('/pos/job-payments', {
    jobId: jobA.id,
    payments: [
      { tender: 'cash', amount: 2000 },
      { tender: 'pos1', amount: 1000, reference: 'SLIP1' },
    ],
  });
  assertEqual(split.status, 201, 'a repair is paid at the till with a split payment');
  assertEqual(split.body?.outstanding, 2000, 'the balance owed is worked out by the server');
  const rowsA = await db
    .selectFrom('job_payments')
    .select(['kind', 'amount', 'tender', 'shop_id'])
    .where('job_id', '=', jobA.id)
    .execute();
  assertEqual(rowsA.length, 2, 'one payment row per tender');
  assert(
    rowsA.every((r) => r.shop_id === S2),
    "...in the job's shop",
  );
  assertEqual(
    (
      await emp.post('/pos/job-payments', {
        jobId: jobA.id,
        payments: [{ tender: 'cash', amount: 2500 }],
      })
    ).status,
    409,
    'more than is owed is refused',
  );
  assertEqual(
    (
      await mgr.post('/pos/job-payments', {
        jobId: jobA.id,
        payments: [{ tender: 'cash', amount: 100 }],
      })
    ).status,
    404,
    "another shop's staff cannot take payment on it",
  );
  const finalPay = await emp.post('/pos/job-payments', {
    jobId: jobA.id,
    payments: [{ tender: 'cash', amount: 2000 }],
  });
  assertEqual(finalPay.body?.outstanding, 0, 'the last payment clears it');
  const kinds = await db
    .selectFrom('job_payments')
    .select(['kind', 'amount'])
    .where('job_id', '=', jobA.id)
    .orderBy('at')
    .execute();
  assertEqual(kinds[kinds.length - 1]?.kind, 'balance', '...and is recorded as the balance');

  const cancelA = await emp.post(`/jobs/${jobA.id}/status`, {
    status: 'cancelled',
    cancellationReason: 'customer changed mind',
  });
  assertEqual(cancelA.status, 200, 'the job is cancelled');
  const handBack = (cancelA.body?.refunds as any[]) ?? [];
  assertEqual(
    handBack.reduce((n, r) => n + r.amount, 0),
    5000,
    'everything paid is refunded',
  );
  assertEqual(handBack.length, 2, 'one refund per payment method (cash and card)');
  assertEqual(
    handBack.find((r) => r.tender === 'cash')?.amount,
    4000,
    'cash back: what was taken in cash',
  );
  assertEqual(
    handBack.find((r) => r.tender === 'pos1')?.amount,
    1000,
    'card back: what was taken on the card',
  );
  assert(
    handBack.every((r) => numbered(shop2.code, 'REF').test(r.reference)),
    "each carries the shop's own number",
  );
  const net = await db
    .selectFrom('transactions')
    .select((eb) => eb.fn.sum<number>('amount').as('net'))
    .where('reference', '=', jobA.reference)
    .executeTakeFirstOrThrow();
  assertEqual(Number(net.net), 0, "the job nets to nothing in the day's figures");

  const jobB = await newJob('B');
  await emp.post('/pos/job-payments', {
    jobId: jobB.id,
    payments: [{ tender: 'cash', amount: 1000 }],
  });
  const keep = await emp.post(`/jobs/${jobB.id}/status`, {
    status: 'cancelled',
    cancellationReason: 'no show',
    refundPayments: false,
  });
  assertEqual(keep.status, 200, 'a cancellation can keep the deposit');
  assertEqual(keep.body?.refunds?.length, 0, '...and then refunds nothing');
  assertEqual(
    (
      await emp.post('/pos/job-payments', {
        jobId: jobB.id,
        payments: [{ tender: 'cash', amount: 100 }],
      })
    ).status,
    409,
    'a cancelled job takes no more payments',
  );

  // ---------------------------------------------------------------------
  section('13b. Server-side search, dates and ordering on the paged lists');
  const sale1Ref: string = sale1.body.reference;
  const ledgerHit = (
    await owner.get(
      `/reports/transactions?from=${today}&to=${today}&shop=all&limit=25&search=${encodeURIComponent(sale1Ref)}`,
    )
  ).body;
  assert(
    ledgerHit.items.length >= 1 &&
      ledgerHit.items.every((t: any) => String(t.reference).includes(sale1Ref)),
    'the ledger searches by reference on the server',
  );
  const refundFound = (
    await owner.get(`/pos/refunds?shop=all&limit=10&search=${encodeURIComponent('cross-shop')}`)
  ).body;
  assert(refundFound.items.length >= 1, 'returns search by reason on the server');
  const refundNone = (await owner.get('/pos/refunds?shop=all&limit=10&search=zzzznomatch')).body;
  assertEqual(refundNone.total, 0, '...and a search with no match has total 0');
  const todaysOrders = (await owner.get(`/orders?shop=all&limit=50&from=${today}&to=${today}`))
    .body;
  assert(
    todaysOrders.items.every((o: any) => String(o.createdAt).slice(0, 10) >= today),
    'orders narrow to a date range',
  );
  const oldestFirst = (await owner.get('/orders?shop=all&limit=50&sort=oldest')).body
    .items as any[];
  assert(
    oldestFirst.every((o, i) => i === 0 || oldestFirst[i - 1].createdAt <= o.createdAt),
    'the work queue can be read oldest first',
  );
  const cashSearch = (await owner.get('/pos/cash?shop=all&limit=10&search=zzzznomatch')).body;
  assertEqual(cashSearch.total, 0, 'cash entries search by note');
  const cashOnADay = (await owner.get('/pos/cash?shop=all&limit=5&date=1999-01-01')).body;
  assertEqual(cashOnADay.total, 0, 'cash entries narrow to one trading day');
  const bookingsSearch = (await owner.get('/repair/bookings?shop=all&limit=10&search=zzzznomatch'))
    .body;
  assertEqual(bookingsSearch.total, 0, 'repair requests search on the server');

  // ---------------------------------------------------------------------
  // Tester bug B-2 / change C-1: a delivery booked on another shop's till reaches the admin
  // panel, filed under that shop, with every field — and typed items move no stock.
  section('13c. Goods in from another shop reaches the admin panel');
  await db
    .insertInto('staff_permissions')
    .values({ staff_id: empRow.id, permission: 'inventory.manage' })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const empGoods = await signIn(EMP2);
  const noItems = await empGoods.post('/pos/stock-intakes', { items: [] });
  assertEqual(noItems.status, 400, 'a delivery needs at least one item');
  const zeroQty = await empGoods.post('/pos/stock-intakes', {
    items: [{ name: 'Screens', qty: 0 }],
  });
  assertEqual(zeroQty.status, 400, 'a quantity must be positive');
  const booked = await empGoods.post('/pos/stock-intakes', {
    supplierName: 'Shop Two Supplier',
    notes: 'Left at the back door',
    items: [
      { name: 'iPhone 13 screens', qty: 10 },
      { name: 'USB-C cables', qty: 25 },
    ],
    price: 12550,
  });
  assertEqual(booked.status, 201, 'a shop-two employee books a delivery in with no reference');
  assertEqual(booked.body?.shopId, S2, 'filed under their own shop');
  const ownedGoods = async (query: string) =>
    ((await owner.get(`/admin/stock-intakes?${query}&limit=50`)).body.items as any[]).find(
      (i) => i.id === booked.body?.id,
    );
  const atShop2 = await ownedGoods(`shop=${S2}`);
  assert(Boolean(atShop2), 'the owner sees it with shop two selected');
  assertEqual(
    atShop2?.lines.map((l: any) => `${l.qty} ${l.name}`).join(', '),
    '10 iPhone 13 screens, 25 USB-C cables',
    'with both items',
  );
  assertEqual(atShop2?.totalCost, 12550, 'its price');
  assertEqual(atShop2?.notes, 'Left at the back door', 'its notes');
  assertEqual(atShop2?.supplierName, 'Shop Two Supplier', 'and its supplier');
  assert(Boolean(await ownedGoods('shop=all')), 'and with All shops selected');
  assert(!(await ownedGoods('')), 'but not under the owner’s own shop');
  const empOwnList = (await empGoods.get('/pos/stock-intakes')).body as any[];
  assert(
    empOwnList.some((i) => i.id === booked.body?.id && i.totalCost === null),
    'the till lists it, without the price for someone without costs.view',
  );

  // ---------------------------------------------------------------------
  section('14. Managing shops');
  const listed = await owner.get('/shops');
  assert((listed.body as any[]).length >= 2, 'the owner sees every open shop');
  assertEqual((await emp.get('/shops')).body.length, 1, 'an employee sees only their own');
  assert((await mgr.get('/shops')).body.length >= 2, 'a manager sees them all');
  const adminList = await owner.get('/admin/shops');
  assertEqual(adminList.status, 200, 'the owner gets the full list, closed shops included');
  assertEqual((await mgr.get('/admin/shops')).status, 403, 'a manager does not manage shops');
  assertEqual(
    (await emp.post('/admin/shops', { name: 'Nope' })).status,
    403,
    'nor does an employee',
  );
  // Reused across runs: a shop is never deleted and its code is never reused, so a new one per
  // run would use up a code each time.
  let third = (await owner.get('/admin/shops')).body.find((x: any) => x.name === 'E2E Third Shop');
  if (!third) {
    const made = await owner.post('/admin/shops', { name: 'E2E Third Shop', code: 'ZZ9' });
    assertEqual(made.status, 201, 'the owner adds a shop');
    third = made.body;
  }
  assert(
    /^F[0-9]{2,}$/.test(third.code),
    'it is given the next F code automatically, not the one sent',
  );
  const closed = await owner.put(`/admin/shops/${third.id}`, {
    name: 'E2E Third Shop',
    code: 'ZZ9',
    isActive: false,
  });
  assertEqual(closed.status, 200, 'a shop with nobody in it can be closed');
  assertEqual(
    closed.body?.code,
    third.code,
    'and a code sent with an edit is ignored — it never changes',
  );
  const hubShop = (await owner.get('/admin/shops')).body.find((x: any) => x.isHub);
  assertEqual(
    (await owner.put(`/admin/shops/${hubShop.id}`, { isActive: false })).status,
    409,
    'the shop that fulfils online orders cannot be closed',
  );
  assertEqual(
    (await owner.put(`/admin/shops/${S2}`, { isActive: false })).status,
    409,
    'a shop with active staff cannot be closed',
  );
  const allShopsWrite = await owner.post(
    '/admin/products?shop=all',
    newProduct(`Shops All ${RUN_ID}`, 1),
  );
  assertEqual(
    allShopsWrite.status,
    403,
    'a change made while the switcher is on All shops is refused, not placed in the wrong shop',
  );
  assertEqual(
    allShopsWrite.body?.error,
    'Please select a specific shop first to make changes.',
    'with the view-only message (tester change C-4)',
  );
  assertEqual(
    (await owner.patch(`/admin/settings?shop=all`, { card1DailyLimit: 100 })).status,
    403,
    'every kind of write is refused under All shops, not only creating',
  );

  // ---------------------------------------------------------------------
  section('Cleanup');
  for (const id of [p1.id, p2.id, copyId, copy2.body.id]) {
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
