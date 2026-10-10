# Fonology database

Plain SQL, numbered, applied in order by `apps/api/src/scripts/migrate.ts` (`pnpm db:migrate`). Every change
is a new file here — nothing is created directly in the database, so the whole schema can be rebuilt from
scratch.

The per-migration write-ups that used to live in this file are in git history; each file's own header comment
says what it does and why.

## Rules

- **Additive only.** Never edit an applied migration; add a new one.
- **A migration is frozen the moment it is committed and pushed**, not the moment it is first run. Before the
  push it is a draft that has touched only your own database, so correcting it and re-applying keeps file and
  database in agreement. After the push someone else may have applied it; a mistake is then fixed by a NEW
  numbered migration, however small. The runner records a checksum per file and stops if an applied file
  has changed.
- **A new enum value can't be used in the transaction that adds it** (Postgres limitation), and each file runs
  in its own transaction. So adding a value and using it in a constraint or function body takes two files
  (`0012` and `0013` are the example).
- **Money is integer pence.** No VAT anywhere — the business is not VAT registered.
- **Row-level security is on everywhere with no policies** (deny-all): a second line of defence in case a
  credential leaks. Authorization lives in `apps/api` and `staff_can()`.
- **References come only from `issue_shop_reference()`** (0106), never from application code.

## How they run

`migrate.ts` connects as a superuser (`MIGRATE_DATABASE_URL`, local default `localhost:55432`), then on every
run:

1. creates the roles `fonology_owner` (owns the schema; migrations run as it) and `fonology_api` (what the
   API logs in as: BYPASSRLS, no DDL);
2. applies `db/bootstrap/*.sql`, which stubs `auth.users`, `storage.*` and the `anon` / `authenticated` /
   `service_role` roles that migrations 0001–0092 were written against;
3. applies each pending migration in its own transaction, recording it in `fonology_migrations.applied`.

In production the API image's `docker-entrypoint.sh` runs it before the server starts when
`MIGRATE_DATABASE_URL` is set. Migrations must land before the API that calls their functions is deployed.

After a migration, regenerate the typed schema with `pnpm --filter @fonology/api db:types`.
