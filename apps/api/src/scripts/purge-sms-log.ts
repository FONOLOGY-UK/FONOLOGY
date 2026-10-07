/**
 * Scheduled entry point for the repair-text log (0105).
 * Run manually:      pnpm --filter @fonology/api purge:sms-log
 * Scheduled:         node dist/scripts/purge-sms-log.js   (in the API image)
 * Run on a schedule: a Coolify Scheduled Task inside the API's container, like
 * purge-documents.ts. SUGGESTED CADENCE: daily.
 *
 * job_sms_log keeps the number each text went to and the text itself (name,
 * device, job number) so the counter can see what the customer was told. That is
 * personal data with no use once the repair is long finished: after 180 days the
 * number and body are blanked. The row itself stays — that a text was sent, for
 * which stage, and whether it got through.
 *
 * Exit code 0 = ran cleanly (including "nothing to do").
 * Exit code 1 = something failed — what a cron/Coolify alert should watch.
 */
import { sql } from 'kysely';
import { db } from '../lib/db.js';

const RETENTION_DAYS = 180;

async function main() {
  const result = await db
    .updateTable('job_sms_log')
    .set({ to_phone: null, body: null })
    .where('created_at', '<', sql<string>`now() - make_interval(days => ${RETENTION_DAYS})`)
    .where((eb) => eb.or([eb('to_phone', 'is not', null), eb('body', 'is not', null)]))
    .executeTakeFirst();
  console.log(
    `[purge-sms-log] ${new Date().toISOString()} — blanked ${Number(result.numUpdatedRows)} text(s) older than ${RETENTION_DAYS} days.`,
  );
  await db.destroy();
}

main().catch((err) => {
  console.error('[purge-sms-log] job crashed:', err);
  process.exitCode = 1;
});
