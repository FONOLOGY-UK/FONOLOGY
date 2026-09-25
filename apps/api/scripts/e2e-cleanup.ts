/**
 * Removes the fixtures one run of packages/e2e created on the target database.
 *
 * Called by packages/e2e/global-teardown.ts, which passes the run's tag and
 * start time. Lives here, not in the e2e package, because deleting rows needs
 * the service-role key and this package is the only one that holds it.
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
import { supabaseAdmin as db } from '../src/lib/supabase.js';

const PRODUCTION_REF = 'sbqqpuqoizyjzdcydqid';

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
  if ((process.env.SUPABASE_URL ?? '').includes(PRODUCTION_REF)) {
    console.error('[e2e-cleanup] refusing: SUPABASE_URL is the PRODUCTION project.');
    process.exit(2);
  }

  const tag = `%${run}%`;
  const report = (what: string, n: number | undefined, note = '') =>
    console.log(`  [e2e-cleanup] ${what}: ${n ?? 0}${note}`);

  // Jobs first: payments and parts cascade, and jobs.booking_id blocks bookings.
  const jobs = await db.from('jobs').delete().ilike('customer_name', tag).select('id');
  report('jobs removed', jobs.data?.length);
  const bookings = await db.from('bookings').delete().ilike('customer_name', tag).select('id');
  report('bookings removed', bookings.data?.length);
  const sells = await db.from('sell_requests').delete().ilike('name', tag).select('id');
  report('trade-in requests removed', sells.data?.length);

  const lines = await db.from('sale_lines').select('sale_id').ilike('name', tag);
  const saleIds = [...new Set((lines.data ?? []).map((l) => l.sale_id as string))];
  if (saleIds.length) {
    const sales = await db.from('sales').delete().in('id', saleIds).select('id');
    report('sales removed', sales.data?.length);
  } else {
    report('sales removed', 0);
  }

  const products = await db.from('products').select('id').ilike('name', tag);
  let deleted = 0;
  let retired = 0;
  for (const { id } of products.data ?? []) {
    const { count } = await db
      .from('stock_movements')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', id);
    if (count) {
      await db.from('products').update({ is_active: false, stock_qty: 0 }).eq('id', id);
      retired += 1;
    } else {
      await db.from('products').delete().eq('id', id);
      deleted += 1;
    }
  }
  report(
    'products removed',
    deleted,
    retired ? ` (${retired} retired — they had stock history)` : '',
  );

  const staff = await db.from('staff').select('id, email').in('email', [ownerEmail, employeeEmail]);
  const staffIds = (staff.data ?? []).map((s) => s.id as string);
  const employeeId = staff.data?.find((s) => s.email === employeeEmail)?.id as string | undefined;

  if (staffIds.length) {
    const prints = await db
      .from('print_jobs')
      .delete()
      .gte('created_at', since)
      .in('requested_by', staffIds)
      .select('id');
    report('print jobs removed', prints.data?.length);
  }

  if (employeeId) {
    const sessions = await db
      .from('staff_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('staff_id', employeeId)
      .eq('pos_only', true)
      .is('ended_at', null)
      .gte('started_at', since)
      .select('id');
    report('PIN-only sessions ended', sessions.data?.length);
  }
}

main().catch((error) => {
  console.error('[e2e-cleanup] failed:', error);
  process.exit(1);
});
