/**
 * Applies supabase/migrations to a plain Postgres database.
 *
 *   pnpm db:migrate              apply pending (repo root; tsx src/scripts/migrate.ts)
 *   pnpm db:migrate --status     list, change nothing
 *   node dist/scripts/migrate.js in the API image — the pre-deploy step
 *   ... --create    create the database named in the URL first, if missing
 *
 * MIGRATE_DATABASE_URL must be a SUPERUSER connection (roles are cluster-wide
 * and only a superuser can grant BYPASSRLS). Defaults to the local stack.
 *
 * Every run, in order:
 *   1. roles — fonology_owner (owns the schema; NOLOGIN, migrations run as it
 *      via SET ROLE; BYPASSRLS like Supabase's postgres role, which the files
 *      were written against — 0045 forces RLS on a table, then seeds it) and fonology_api (what the API logs in as: LOGIN,
 *      BYPASSRLS, member of service_role for the grants 0011 makes). RLS is
 *      on everywhere with no policies, so without BYPASSRLS the API reads
 *      nothing. Password from FONOLOGY_API_DB_PASSWORD.
 *   2. db/bootstrap/*.sql — the Supabase compatibility layer (idempotent).
 *   3. each pending migration, in filename order, in its OWN transaction
 *      (0012 exists because an enum value can't be used in the transaction
 *      that adds it), recorded in fonology_migrations.applied with a checksum.
 *
 * An already-applied file whose content has changed stops the run before
 * anything is applied: migrations are frozen once pushed, and a silent
 * mismatch between file and database is how environments drift apart.
 */
import * as dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env.local'),
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MIGRATIONS_DIR = path.join(repoRoot, 'supabase/migrations');
const BOOTSTRAP_DIR = path.join(repoRoot, 'db/bootstrap');

const LOCAL_URL = 'postgres://postgres:postgres@localhost:55432/fonology';
const url = new URL(process.env.MIGRATE_DATABASE_URL ?? LOCAL_URL);
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
const args = new Set(process.argv.slice(2));

const apiPassword = process.env.FONOLOGY_API_DB_PASSWORD ?? (isLocal ? 'fonology_api' : undefined);
if (!apiPassword) {
  console.error('FONOLOGY_API_DB_PASSWORD is required for a non-local database.');
  process.exit(1);
}

/** CRLF and a BOM must not change a checksum — Windows and Linux checkouts agree. */
function readSql(file: string) {
  const text = readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
  return { text, checksum: createHash('sha256').update(text).digest('hex') };
}

const sqlFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

async function createDatabaseIfMissing() {
  const dbName = decodeURIComponent(url.pathname.slice(1));
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [
      dbName,
    ]);
    if (!rowCount) {
      await admin.query(`create database ${admin.escapeIdentifier(dbName)}`);
      console.log(`created database ${dbName}`);
    }
  } finally {
    await admin.end();
  }
}

async function ensureRoles(db: pg.Client) {
  const dbName = decodeURIComponent(url.pathname.slice(1));
  await db.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'fonology_owner') then
        create role fonology_owner nologin bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'fonology_api') then
        create role fonology_api login bypassrls;
      end if;
    end;
    $$`);
  await db.query('alter role fonology_owner nologin bypassrls');
  await db.query(
    `alter role fonology_api login bypassrls password ${db.escapeLiteral(apiPassword!)}`,
  );
  // Owning the database is what lets fonology_owner create in schema public
  // (PG15+) and create the trusted extensions 0001/0055 ask for.
  await db.query(`alter database ${db.escapeIdentifier(dbName)} owner to fonology_owner`);
}

async function main() {
  if (args.has('--create')) await createDatabaseIfMissing();

  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  // One runner at a time per database (a deploy and a person, say).
  await db.query('select pg_advisory_lock(hashtext($1))', ['fonology_migrations']);

  try {
    const { rows: su } = await db.query<{ rolsuper: boolean }>(
      'select rolsuper from pg_roles where rolname = current_user',
    );
    if (!su[0]?.rolsuper) throw new Error('MIGRATE_DATABASE_URL must connect as a superuser.');
    const { rowCount: onSupabase } = await db.query(
      "select 1 from pg_roles where rolname = 'supabase_admin'",
    );
    if (onSupabase)
      throw new Error('This is a Supabase database — this runner is for plain Postgres.');

    await db.query(`
      create schema if not exists fonology_migrations;
      revoke all on schema fonology_migrations from public;
      create table if not exists fonology_migrations.applied (
        filename   text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )`);

    const { rows: appliedRows } = await db.query<{ filename: string; checksum: string }>(
      'select filename, checksum from fonology_migrations.applied',
    );
    const applied = new Map(appliedRows.map((r) => [r.filename, r.checksum]));

    const files = sqlFiles(MIGRATIONS_DIR).map((f) => ({
      name: f,
      ...readSql(path.join(MIGRATIONS_DIR, f)),
    }));
    const changed = files.filter((f) => applied.has(f.name) && applied.get(f.name) !== f.checksum);
    if (changed.length) {
      throw new Error(
        `Already-applied migration(s) changed on disk: ${changed.map((f) => f.name).join(', ')}. ` +
          'Migrations are frozen once pushed — fix forward with a new file.',
      );
    }
    const missing = [...applied.keys()].filter((name) => !files.some((f) => f.name === name));
    if (missing.length)
      throw new Error(`Applied migration(s) missing on disk: ${missing.join(', ')}`);

    const pending = files.filter((f) => !applied.has(f.name));
    console.log(`${url.host}${url.pathname}: ${applied.size} applied, ${pending.length} pending`);
    if (args.has('--status')) {
      for (const f of pending) console.log(`  pending  ${f.name}`);
      return;
    }

    await ensureRoles(db);
    for (const f of sqlFiles(BOOTSTRAP_DIR)) {
      await db.query('begin');
      try {
        await db.query(readSql(path.join(BOOTSTRAP_DIR, f)).text);
        await db.query('commit');
      } catch (e) {
        await db.query('rollback');
        throw new Error(`bootstrap ${f}: ${(e as Error).message}`);
      }
    }
    await db.query('grant service_role to fonology_api');

    for (const f of pending) {
      const started = Date.now();
      await db.query('begin');
      try {
        await db.query('set local role fonology_owner');
        await db.query(f.text);
        await db.query('reset role');
        await db.query(
          'insert into fonology_migrations.applied (filename, checksum) values ($1, $2)',
          [f.name, f.checksum],
        );
        await db.query('commit');
      } catch (e) {
        await db.query('rollback');
        const err = e as pg.DatabaseError;
        throw new Error(
          `${f.name} failed and was rolled back: ${err.message}` +
            (err.position ? ` (at character ${err.position})` : '') +
            (err.where ? `\n  ${err.where}` : ''),
        );
      }
      console.log(`  applied  ${f.name}  (${Date.now() - started} ms)`);
    }
    console.log(pending.length ? 'done' : 'up to date');
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(`migrate: ${(e as Error).message}`);
  process.exit(1);
});
