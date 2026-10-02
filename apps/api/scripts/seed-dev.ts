/**
 * Creates the standing test logins (TEST-LOGINS.md) on a LOCAL database:
 *
 *   owner@fonology.test     owner, PIN 1234   — e2e-test.ts, schema-audit.ts
 *   staff@fonology.test     employee          — e2e-test.ts's permission checks
 *   customer@fonology.test  customer
 *
 * All three with the password `Test1234!`, already confirmed. Safe to re-run:
 * an existing account gets its password (and the owner its PIN) put back,
 * nothing else changes. Refuses any database that is not on this machine.
 *
 * Also adds one phone model ("Test Phone") when there are none at all — the
 * migrations seed repair types and part tiers but no devices, and e2e-test.ts
 * books a repair. A database with the real catalogue imported is left alone.
 *
 *   pnpm --filter @fonology/api exec tsx scripts/seed-dev.ts
 */
import { config } from '../src/config.js';
import { db, pool, sql } from '../src/lib/db.js';
import { hashPassword, hashPin } from '../src/lib/password.js';

const PASSWORD = 'Test1234!';

const ACCOUNTS = [
  { email: 'owner@fonology.test', name: 'Test Owner', kind: 'staff', role: 'owner', pin: '1234' },
  { email: 'staff@fonology.test', name: 'Test Employee', kind: 'staff', role: 'employee' },
  { email: 'customer@fonology.test', name: 'Test Customer', kind: 'customer' },
] as const;

async function main() {
  const host = new URL(config.databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    console.error(`[seed] refusing: DATABASE_URL points at ${host}, not this machine.`);
    process.exit(2);
  }

  const passwordHash = await hashPassword(PASSWORD);
  for (const account of ACCOUNTS) {
    const { id } = await db
      .insertInto('user_accounts')
      .values({ email: account.email, password_hash: passwordHash, email_verified_at: sql`now()` })
      .onConflict((oc) =>
        oc.column('email').doUpdateSet({
          password_hash: passwordHash,
          email_verified_at: sql`coalesce(user_accounts.email_verified_at, now())`,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();

    if (account.kind === 'staff') {
      await db
        .insertInto('staff')
        .values({ id, email: account.email, name: account.name, role: account.role })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      if ('pin' in account) {
        await db
          .updateTable('staff')
          .set({ pin_hash: await hashPin(account.pin), is_active: true })
          .where('id', '=', id)
          .execute();
      }
    } else {
      await db
        .insertInto('customers')
        .values({ id, email: account.email, name: account.name })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
    }
    console.log(`  [seed] ${account.email} ready`);
  }

  const { count } = await db
    .selectFrom('devices')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  if (!count) {
    await db
      .insertInto('devices')
      .values({ name: 'Test Phone', brand: 'other', price_multiplier: 1 })
      .execute();
    console.log('  [seed] device "Test Phone" added');
  }
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
