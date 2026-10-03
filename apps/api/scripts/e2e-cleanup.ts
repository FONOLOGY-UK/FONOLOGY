/**
 * Removes the fixtures one run of packages/e2e created on the target database.
 *
 * Called by packages/e2e/global-teardown.ts, which passes the run's tag and
 * start time. Lives here, not in the e2e package, because deleting rows needs
 * a database credential and this package is the only one that holds one.
 *
 *   npx tsx scripts/e2e-cleanup.ts --run PW12345678 --since 2026-09-25T06:00:00Z \
 *     --owner owner@fonology.test --employee staff@fonology.test
 *
 * SCOPE IS THE WHOLE SAFETY STORY. Every fixture the suite makes carries the
 * run tag in its name, and this matches that exact tag — never a prefix — so
 * it cannot reach anything a person created, nor another run's rows. The two
 * things that can't carry a name are scoped as tightly as they can be:
 *
 *   print jobs  queued by the two TEST accounts, after this run started
 *   sessions    PIN-only sessions for the test employee, opened after it
 *               started — ended, not deleted, because sessions are history
 *
 * A product that ever moved stock is RETIRED rather than deleted:
 * stock_movements is an append-only ledger (block_stock_movement_change) and
 * products RESTRICTs on it. The suite creates its products with no stock, so
 * in practice they delete; the fallback is there so a future change to the
 * suite cannot turn cleanup into an error.
 */
import { assertTestWritesAllowed } from '../src/config.js';
import { db, pool } from '../src/lib/db.js';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) {
    console.error(`[e2e-cleanup] missing --${name}`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const run = arg('run');
  const since = arg('since');
  const ownerEmail = arg('owner');
  const employeeEmail = arg('employee');

  if (!/^PW\d{6,}$/.test(run)) {
    console.error(
      `[e2e-cleanup] refusing an unrecognised run tag "${run}" — it would not scope safely.`,
    );
    process.exit(2);
  }
  // The live shop only while it is still being tested before opening.
  assertTestWritesAllowed('e2e-cleanup');

  const tag = `%${run}%`;
  const report = (what: string, n: number | bigint | undefined, note = '') =>
    console.log(`  [e2e-cleanup] ${what}: ${Number(n ?? 0)}${note}`);

  // Refunds against those jobs first (a cancelled, paid job is refunded — refunds.job_id blocks
  // the delete); their lines cascade.
  const jobRefunds = await db
    .deleteFrom('refunds')
    .where('job_id', 'in', (eb) =>
      eb.selectFrom('jobs').select('id').where('customer_name', 'ilike', tag),
    )
    .executeTakeFirst();
  report('job refunds removed', jobRefunds.numDeletedRows);

  // Jobs: payments and parts cascade, and jobs.booking_id blocks bookings.
  const jobs = await db.deleteFrom('jobs').where('customer_name', 'ilike', tag).executeTakeFirst();
  report('jobs removed', jobs.numDeletedRows);
  const bookings = await db
    .deleteFrom('bookings')
    .where('customer_name', 'ilike', tag)
    .executeTakeFirst();
  report('bookings removed', bookings.numDeletedRows);
  const sells = await db.deleteFrom('sell_requests').where('name', 'ilike', tag).executeTakeFirst();
  report('trade-in requests removed', sells.numDeletedRows);

  const lines = await db
    .selectFrom('sale_lines')
    .select('sale_id')
    .where('name', 'ilike', tag)
    .execute();
  const saleIds = [...new Set(lines.map((l) => l.sale_id))];
  if (saleIds.length) {
    const sales = await db.deleteFrom('sales').where('id', 'in', saleIds).executeTakeFirst();
    report('sales removed', sales.numDeletedRows);
  } else {
    report('sales removed', 0);
  }

  const products = await db
    .selectFrom('products')
    .select('id')
    .where('name', 'ilike', tag)
    .execute();
  let deleted = 0;
  let retired = 0;
  for (const { id } of products) {
    const moved = await db
      .selectFrom('stock_movements')
      .select('id')
      .where('product_id', '=', id)
      .limit(1)
      .executeTakeFirst();
    if (moved) {
      await db
        .updateTable('products')
        .set({ is_active: false, stock_qty: 0 })
        .where('id', '=', id)
        .execute();
      retired += 1;
    } else {
      await db.deleteFrom('products').where('id', '=', id).execute();
      deleted += 1;
    }
  }
  report(
    'products removed',
    deleted,
    retired ? ` (${retired} retired — they had stock history)` : '',
  );

  const staff = await db
    .selectFrom('staff')
    .select(['id', 'email'])
    .where('email', 'in', [ownerEmail, employeeEmail])
    .execute();
  const staffIds = staff.map((s) => s.id);
  const employeeId = staff.find((s) => s.email === employeeEmail)?.id;

  if (staffIds.length) {
    const prints = await db
      .deleteFrom('print_jobs')
      .where('created_at', '>=', since)
      .where('requested_by', 'in', staffIds)
      .executeTakeFirst();
    report('print jobs removed', prints.numDeletedRows);
  }

  if (employeeId) {
    const sessions = await db
      .updateTable('staff_sessions')
      .set({ ended_at: new Date().toISOString() })
      .where('staff_id', '=', employeeId)
      .where('pos_only', '=', true)
      .where('ended_at', 'is', null)
      .where('started_at', '>=', since)
      .executeTakeFirst();
    report('PIN-only sessions ended', sessions.numUpdatedRows);
  }

  // Accounts and shops the browser tests make through the admin screens. They carry history
  // (sessions, sales), so they are switched off, not deleted — staff first, because a shop with
  // active staff cannot be closed.
  const staffOff = await db
    .updateTable('staff')
    .set({ is_active: false })
    .where('name', 'ilike', tag)
    .where('is_active', '=', true)
    .executeTakeFirst();
  report('test staff accounts switched off', staffOff.numUpdatedRows);
  const shopsOff = await db
    .updateTable('shops')
    .set({ is_active: false })
    .where('name', 'ilike', tag)
    .where('is_fulfilment_hub', '=', false)
    .where('is_active', '=', true)
    .executeTakeFirst();
  report('test shops closed', shopsOff.numUpdatedRows);
}

main()
  .catch((error) => {
    console.error('[e2e-cleanup] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
