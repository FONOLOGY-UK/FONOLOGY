#!/usr/bin/env node
// Runs the pgTAP suite (supabase/tests/*.sql) against a FRESH database on the
// local stack: drops and recreates `fonology_test`, applies every migration
// through the real runner (apps/api/scripts/migrate.ts), installs pgTAP into
// the `tap` schema the tests put on their search_path, then runs pg_prove.
//   pnpm db:test                      whole suite
//   pnpm db:test 003_stock.sql ...    just those files
// Needs `pnpm stack:up` first. Never touches the `fonology` database.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DB = 'fonology_test';
const compose = ['compose', '-f', path.join(root, 'docker-compose.dev.yml')];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const psql = (db, sql) =>
  run('docker', [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'postgres',
    '-d',
    db,
    '-c',
    sql,
  ]);

psql('postgres', `drop database if exists ${TEST_DB} with (force)`);
const apiDir = path.join(root, 'apps/api');
run(
  process.execPath,
  [path.join(apiDir, 'node_modules/tsx/dist/cli.mjs'), 'scripts/migrate.ts', '--create'],
  {
    cwd: apiDir,
    env: {
      ...process.env,
      MIGRATE_DATABASE_URL: `postgres://postgres:postgres@localhost:55432/${TEST_DB}`,
    },
  },
);
// As on Supabase, where pgTAP sits in an `extensions` schema every role can use:
// 010_security switches to anon/service_role and still has to call throws_ok().
psql(
  TEST_DB,
  'create schema tap; create extension pgtap schema tap; ' +
    'grant usage on schema tap to anon, authenticated, service_role;',
);

const files = process.argv.slice(2);
const targets = files.length
  ? files.map((f) => `/tests/${path.basename(f)}`).join(' ')
  : '/tests/*.sql';
run(
  'docker',
  [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    `pg_prove -U postgres -d ${TEST_DB} ${targets}`,
  ],
  {
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  },
);
