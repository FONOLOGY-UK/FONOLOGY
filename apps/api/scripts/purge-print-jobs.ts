/**
 * Scheduled entry point for print-queue housekeeping.
 * Run manually:      npx tsx scripts/purge-print-jobs.ts   (from apps/api)
 * Run on a schedule: same setup as purge-documents.ts — a Coolify Scheduled
 * Task running this command inside the API's container, needing no secrets
 * beyond the API's own env.
 *
 * Does two jobs, in this order and for a reason:
 *
 *   1. Expire stale leases. If the shop PC died mid-job, receipts move to
 *      `unconfirmed` so staff get asked, and labels go back on the queue.
 *      Running this FIRST means a job that has just become terminal is
 *      correctly aged from its own created_at rather than sitting invisible.
 *   2. Purge terminal jobs past the retention window. Payloads carry customer
 *      PII (name and phone on a bench-ticket label), so this is an obligation
 *      rather than tidiness.
 *
 * SUGGESTED CADENCE: every 2 minutes. The lease sweep is the safety net for a
 * dead agent, and until it runs, a receipt that may not have printed is not
 * yet visible to anyone. Cheap: two function calls against tiny partial
 * indexes.
 *
 * Exit code 0 = ran cleanly (including "nothing to do").
 * Exit code 1 = something failed — what a cron/Coolify alert should watch.
 */
import { purgeExpiredPrintJobs, expirePrintLeases } from '../src/lib/printRetention.js';

async function main() {
  const startedAt = new Date().toISOString();

  const expired = await expirePrintLeases();
  console.log(`[purge-print-jobs] ${startedAt} — reclaimed ${expired} stale lease(s).`);

  const result = await purgeExpiredPrintJobs();
  console.log(
    `[purge-print-jobs] done — ${result.deleted} purged, ${result.failed} failed to delete.`,
  );

  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[purge-print-jobs] job crashed:', err);
  process.exitCode = 1;
});
