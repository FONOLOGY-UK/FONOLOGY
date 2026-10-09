/**
 * Scheduled housekeeping for tables that otherwise only ever grow.
 * Run manually:      pnpm --filter @fonology/api purge:housekeeping
 * Scheduled:         node dist/scripts/purge-housekeeping.js   (in the API image)
 * Run on a schedule: a Coolify Scheduled Task inside the API's container, like purge-documents.ts.
 * SUGGESTED CADENCE: daily.
 *
 *  - sale_idempotency_keys (0110): only matter for retries within minutes; kept 7 days.
 *  - auth_sessions: expired or revoked more than 7 days ago. Sign-in already removes the signing-in
 *    account's own old rows, but an account that never signs in again (most customers) was never cleaned.
 *  - auth_tokens: emailed confirm / reset links, expired more than 7 days ago.
 *
 * Exit code 0 = ran cleanly (including "nothing to do"). Exit code 1 = something failed.
 */
import { sql } from 'kysely';
import { db } from '../lib/db.js';

const KEEP = sql<string>`now() - interval '7 days'`;

async function main() {
  const keys = await db
    .deleteFrom('sale_idempotency_keys')
    .where('created_at', '<', KEEP)
    .executeTakeFirst();
  const sessions = await db
    .deleteFrom('auth_sessions')
    .where((eb) => eb.or([eb('expires_at', '<', KEEP), eb('revoked_at', '<', KEEP)]))
    .executeTakeFirst();
  const tokens = await db
    .deleteFrom('auth_tokens')
    .where('expires_at', '<', KEEP)
    .executeTakeFirst();
  console.log(
    `[purge-housekeeping] ${new Date().toISOString()} — removed ${Number(keys.numDeletedRows)} sale key(s), ` +
      `${Number(sessions.numDeletedRows)} session(s), ${Number(tokens.numDeletedRows)} emailed token(s).`,
  );
  await db.destroy();
}

main().catch((err) => {
  console.error('[purge-housekeeping] job crashed:', err);
  process.exitCode = 1;
});
