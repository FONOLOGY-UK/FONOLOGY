/**
 * Scheduled entry point for the ID-document retention purge.
 * Run manually:   npx tsx scripts/purge-documents.ts   (from apps/api)
 * Run on a schedule: see the deployment note in the report — a Coolify
 * Scheduled Task running this same command inside the API's container is
 * the recommended setup; it needs no secrets beyond the API's own env.
 *
 * Exit code 0 = ran cleanly (including "found nothing to purge").
 * Exit code 1 = at least one document failed to purge, or the job itself
 * threw — a non-zero exit is what a cron/Coolify alert should watch for.
 */
import { purgeExpiredDocuments } from '../src/lib/documentRetention.js';

async function main() {
  const startedAt = new Date().toISOString();
  const result = await purgeExpiredDocuments();

  console.log(`[purge-documents] ${startedAt} — checked ${result.checked} due document(s).`);
  for (const doc of result.purged) {
    console.log(
      `  purged: ${doc.id} (${doc.kind}, order ${doc.orderReference}, uploaded ${doc.uploadedAt})`,
    );
  }
  for (const err of result.errors) {
    console.error(`  FAILED: ${err.id} (${err.storagePath}) — ${err.error}`);
  }
  console.log(
    `[purge-documents] done — ${result.purged.length} purged, ${result.errors.length} failed, ${
      result.checked - result.purged.length - result.errors.length
    } skipped.`,
  );

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[purge-documents] job crashed:', err);
  process.exitCode = 1;
});
