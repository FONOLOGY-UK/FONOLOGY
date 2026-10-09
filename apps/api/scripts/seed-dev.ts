/**
 * Creates the standing test logins (TEST-LOGINS.md) on a LOCAL database:
 *
 *   owner@fonology.test     owner, PIN 1234   — e2e-test.ts, schema-audit.ts
 *   staff@fonology.test     employee, PIN 5678 — e2e-test.ts's permission checks, Playwright's PIN switch
 *   customer@fonology.test  customer
 *
 * All three with the password `Test1234!`, already confirmed. Safe to re-run:
 * an existing account gets its password (and staff their PIN) put back,
 * nothing else changes. Refuses any database that is not on this machine
 * unless ALLOW_TEST_WRITES=true.
 *
 * Also adds one phone model ("Test Phone") when there are none at all, and one
 * priced repair type when none has a price — the migrations seed only part
 * tiers and the unpriced "Something else", and both e2e suites book and quote
 * repairs. A database with the real catalogue imported is left alone.
 *
 *   pnpm db:seed
 */
import { assertTestWritesAllowed, config } from '../src/config.js';
import { db, pool, sql } from '../src/lib/db.js';
import { hashPassword, hashPin } from '../src/lib/password.js';

const PASSWORD = 'Test1234!';

const ACCOUNTS = [
  { email: 'owner@fonology.test', name: 'Test Owner', kind: 'staff', role: 'owner', pin: '1234' },
  {
    email: 'staff@fonology.test',
    name: 'Test Employee',
    kind: 'staff',
    role: 'employee',
    pin: '5678',
  },
  { email: 'customer@fonology.test', name: 'Test Customer', kind: 'customer' },
] as const;

async function main() {
  // This machine's database always; any other only with ALLOW_TEST_WRITES=true
  // (the live server before opening — these accounts are disabled on opening day).
  const host = new URL(config.databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !config.allowTestWrites) {
    console.error(
      `[seed] refusing: DATABASE_URL points at ${host}, not this machine, and ALLOW_TEST_WRITES is not true.`,
    );
    process.exit(2);
  }
  assertTestWritesAllowed('seed');

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
    await db.insertInto('devices').values({ name: 'Test Phone', brand: 'other' }).execute();
    console.log('  [seed] device "Test Phone" added');
  }

  // One priced repair (0109: prices live on the device, per sub-type).
  const priced = await db.selectFrom('device_repair_prices').select('id').executeTakeFirst();
  if (!priced) {
    const device = await db
      .selectFrom('devices')
      .select('id')
      .where('is_active', '=', true)
      .orderBy('created_at')
      .executeTakeFirstOrThrow();
    const repair = await db
      .insertInto('repair_types')
      .values({
        name: 'Test Screen Repair',
        description: 'Seeded by scripts/seed-dev.ts',
        estimate_label: '1 hour',
      })
      .onConflict((oc) => oc.column('name').doUpdateSet({ is_active: true }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const subTypes = await db
      .selectFrom('repair_sub_types')
      .select(['id', 'legacy_tier'])
      .where('legacy_tier', 'is not', null)
      .execute();
    const price = { original: 12000, oem: 9000, copy: 6000 } as const;
    await db
      .insertInto('repair_type_sub_types')
      .values(subTypes.map((s) => ({ repair_type_id: repair.id, sub_type_id: s.id })))
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db
      .insertInto('device_repair_prices')
      .values(
        subTypes.map((s) => ({
          device_id: device.id,
          repair_type_id: repair.id,
          sub_type_id: s.id,
          price: price[s.legacy_tier!],
        })),
      )
      .execute();
    console.log('  [seed] repair type "Test Screen Repair" added, priced on the first device');
  }
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
