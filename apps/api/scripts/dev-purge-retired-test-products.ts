/**
 * One-off: hard-deletes every RETIRED product in the local dev database.
 *
 * Every retired product here is e2e/QA test-fixture noise (verified by hand before
 * writing this — none match the real demo catalogue, which is all active). Deleting
 * cascades product_images/promotions/variants/reviews/favourites/folder items; a
 * product still referenced by stock_movements, job_parts, trade_in_payouts,
 * refund_lines or stock_intake_lines is left retired, unchanged, and reported.
 *
 * Local dev only — refuses anywhere ALLOW_TEST_WRITES/production writes would apply.
 */
import { assertTestWritesAllowed } from '../src/config.js';
import { db, pool } from '../src/lib/db.js';

async function main() {
  assertTestWritesAllowed('dev-purge-retired-test-products');

  const retired = await db
    .selectFrom('products')
    .select(['id', 'name'])
    .where('is_active', '=', false)
    .execute();

  let deleted = 0;
  let kept = 0;
  const keptNames: string[] = [];

  for (const { id, name } of retired) {
    try {
      await db.deleteFrom('products').where('id', '=', id).execute();
      deleted += 1;
    } catch {
      kept += 1;
      keptNames.push(name);
    }
  }

  console.log(`[purge] deleted ${deleted} retired products`);
  console.log(`[purge] kept ${kept} retired products (still referenced elsewhere)`);
  if (keptNames.length) {
    console.log('[purge] kept:', [...new Set(keptNames)].slice(0, 30).join(', '));
  }
}

main()
  .catch((error) => {
    console.error('[purge] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
