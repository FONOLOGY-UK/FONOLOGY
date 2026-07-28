# Fonology schema tests

pgTAP tests, one file per area, that actually exercise the schema — real
fixtures, real function calls, real assertions against what comes back. Not a
read-through of the migrations. Every file finds at least one thing that
either passed by luck or was outright broken; see each file's own comments
for the reasoning behind the fixtures it picks.

## What's here

| File                                   | Area                                                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_structure.sql`                    | Catalog-driven structural proofs — every table has a primary key, every FK has an index, no leftover VAT anything, etc.                                                                                                                                                     |
| `002_time.sql`                         | UK time handling: `shop_day`/`shop_hour`/`shop_weekday`, BST boundaries                                                                                                                                                                                                     |
| `003_stock.sql`                        | Stock movements, weighted-average cost, oversell protection, concurrency                                                                                                                                                                                                    |
| `004_orders_delivery.sql`              | Postcode zoning, delivery pricing, order status machine, idempotency, snapshotting                                                                                                                                                                                          |
| `005_repairs.sql`                      | Repair pricing, job status machine, deposits                                                                                                                                                                                                                                |
| `006_trade_ins.sql`                    | Sell-request flow, guest tokens, payouts, restocking                                                                                                                                                                                                                        |
| `007_till.sql`                         | Split payments, below-cost sales, refunds, float opening                                                                                                                                                                                                                    |
| `008_day_close.sql`                    | Hand-calculated expected cash vs. what the schema computes                                                                                                                                                                                                                  |
| `009_reporting.sql`                    | The money ledger, today's takings, analytics bucketing, low stock                                                                                                                                                                                                           |
| `010_security.sql`                     | RLS, grants, actual role-switch proofs (not just catalog reads)                                                                                                                                                                                                             |
| `011_rounding.sql`                     | No calculation anywhere produces a fraction of a penny; splits always sum back to the whole exactly                                                                                                                                                                         |
| `012_job_refunds_and_cancellation.sql` | Refunds can name a job (exactly one of sale/order/job, capped at what was paid); jobs can be cancelled with a reason, mail-in forces device-held resolution                                                                                                                 |
| `013_money_direction.sql`              | Every pence column swept and classified: which allow negative (payouts, ledger amounts, variance) and which forbid it (everything else)                                                                                                                                     |
| `014_delete_history.sql`               | Deleting a product/supplier/staff member/customer with real history: refused, or the history survives it                                                                                                                                                                    |
| `015_boundaries.sql`                   | Empty inputs (no lines, no items, zero refund), a promo tier that doesn't apply, a very large quantity, zero-priced products                                                                                                                                                |
| `016_document_retention.sql`           | `purge_expired_order_documents()` actually deletes what it should and nothing else                                                                                                                                                                                          |
| `017_end_to_end.sql`                   | One realistic trading day — real products, a paid order, a split-payment sale, a full mail-in repair, a full trade-in, a partial refund, a day close — built entirely through the real functions, then reconciled by hand against the ledger, today's takings and analytics |

Every `.sql` file:

- `plan(n)` at the top with the exact test count, so a silently-skipped
  assertion shows up as a plan mismatch, not a lower pass count.
- Runs inside its own `begin; ... rollback;` — nothing it inserts survives
  the file. Safe to run against a real database, including one with data in
  it already; nothing here is destructive.
- Prefers reading the catalog (`information_schema`, `pg_catalog`) generically
  over hardcoding a list of tables, wherever that's possible — so a table
  added later without, say, an FK index or RLS enabled is caught
  automatically instead of needing a matching new assertion.

## Running the suite for real

This repo doesn't yet have a `supabase/config.toml` — that's created by
`supabase init`, which hasn't been run here since this project has been
worked on directly against a hosted database rather than the local CLI
stack. To run these with the Supabase CLI's own test runner:

```bash
supabase init      # only if supabase/config.toml doesn't exist yet
supabase link --project-ref <project-ref>
supabase db reset  # applies every migration in supabase/migrations, in order
supabase test db   # runs every .sql file in supabase/tests, in filename order
```

`supabase db reset` is what "run after `supabase db reset` applies 0001–0013
cleanly" (the brief for this suite) actually means — these tests assume a
freshly-migrated database with no other data or schema drift, and are not
written to be robust against a database that already has unrelated rows in
it beyond what each file inserts itself.

`supabase test db` only runs the `.sql` files. `concurrency_stock_race.js`
(below) is a separate command — it needs two real, independent connections
open at once, which is not something pgTAP or `supabase test db` can do.

## The concurrency proof: `concurrency_stock_race.js`

Every `.sql` file in this directory runs inside one pgTAP session — one
connection, one transaction. That's fine for almost everything here, but it
structurally cannot express the schema's single nastiest failure mode: two
staff selling the last unit of the same product at the exact same instant,
from two genuinely separate connections. There is no way to hold two open,
racing, uncommitted transactions inside a single pgTAP file.

`concurrency_stock_race.js` is that proof, as a real committed file instead
of a throwaway script run once and discarded. It opens two independent `pg`
connections, has both call `stock_consume()` for the same last unit at
(as close as JS can arrange) the same moment, and asserts: exactly one
succeeds, the other is cleanly refused, and stock never goes negative. It
also runs the same proof repeatedly against a deliberately broken copy of
the guard to confirm it actually fails loudly when the invariant is gone,
not just when everything is already fine — see the script's own comments
for the two different (both safe) ways Postgres can resolve the race: a
plain lock wait, or its own deadlock detector stepping in.

It needs the `pg` driver, which the rest of this SQL-only directory has no
reason to depend on — installed separately, deliberately outside the
project's pnpm workspace (see `package.json` in this directory), so it
can't affect `apps/web`'s dependency tree at all:

```bash
cd supabase/tests
npm install                      # once, installs pg locally to this directory only
export PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=...
node concurrency_stock_race.js
```

Exit code 0 means the race is still safe. Anything else means it isn't, or
the script itself couldn't complete the proof — either way, that is the
schema's most important guarantee having broken, and it deserves to be
treated as loudly as a red CI build, not a skipped test.

## Two gotchas found while building this, not obvious from the files themselves

**pgTAP needs its own schema, not `public`.** `0001_foundation.sql` installs
`citext` with no explicit schema, which puts a couple of its own catalog
objects (its own `min`/`max` aggregates) in `public`. Some of the
catalog-driven assertions in `001_structure.sql` scan every function
definition in `public` via `pg_get_functiondef()` — if pgTAP's own functions
also land in `public`, that scan trips over pgTAP's internals as well as the
schema's own functions. Install pgTAP into its own schema:

```sql
create extension if not exists pgtap schema tap;
```

and put that schema on the search path ahead of running the tests (every
file already does `set local search_path to public, tap, extensions;` for
this reason — adjust the schema name if pgTAP ends up somewhere other than
`tap`).

**`010_security.sql`'s `SET ROLE` sections need pgTAP's functions granted to
the role being switched into.** `anon` and `service_role` need `USAGE` on
whatever schema pgTAP lives in and `EXECUTE` on its functions, or `SET ROLE
anon; select ok(...);` fails on the pgTAP call itself, before it ever reaches
the assertion. This is a testing-harness requirement, not a production one —
`anon` and `service_role` should **not** get this grant outside of running
this suite, since it has nothing to do with what those roles need at
runtime. If pgTAP lives in `tap`:

```sql
grant usage on schema tap to anon, authenticated, service_role;
grant execute on all functions in schema tap to anon, authenticated, service_role;
```

`supabase test db` handles both of these automatically in its own test
database, so neither is needed when running through the CLI — they only
matter when applying migrations and running pgTAP by hand against a plain
Postgres connection, which is how this suite was actually developed and
proved out.

## What isn't (and can't be) in these `.sql` files

**Real concurrency for stock.** `003_stock.sql` proves the oversell-guard
logic works for everything pgTAP itself can express, but pgTAP runs
everything in one session, one transaction — it cannot hold two open,
racing, uncommitted transactions to prove what happens when two staff hit
"sell the last unit" at the same instant. That proof lives in
`concurrency_stock_race.js` instead — see the section above for how it runs
and why it has to be a separate file and a separate command.

## The one thing that genuinely cannot be proven from here: the `product-images` storage policy

`0011_security.sql` wraps its one `CREATE POLICY ... ON storage.objects`
statement in an exception handler, because that statement needs ownership of
`storage.objects` that a plain Postgres connection to the project doesn't
have — confirmed directly by trying to apply `0011` through the same
connection string every other migration in this repo has been applied
through: every other statement in the file succeeds, and that one alone
fails with `must be owner of relation objects`, caught and turned into a
`NOTICE` rather than aborting the rest of the file.

Only the Supabase CLI's own migration pipeline (`supabase db push` /
`supabase db reset` against a linked project) — or the dashboard's SQL
editor — runs with a role that actually owns `storage.objects` and can
apply that one statement. This sandbox has neither Docker (so no local
`supabase start` stack to test against) nor a Supabase access token (so no
`supabase link` / `supabase db push` against the real hosted project either)
— both checked directly (`docker`/`supabase` not on `PATH`, no
`SUPABASE_ACCESS_TOKEN` in the environment) rather than assumed. There is
no way to run the CLI's migration pipeline from here, so this policy has
never actually been applied or verified in this environment — full stop,
not a "probably fine."

**What a human has to check by hand, once, after the first real deploy**
(`supabase db push` or equivalent against the real project):

1. In the Supabase dashboard, **Storage → Policies → `objects`**, confirm a
   policy named `product images are public to read` exists on the
   `product-images` bucket, `SELECT` only.
2. Confirm the other three buckets (`id-documents`, `buy-in-forms`,
   `sell-request-photos`) have **no** policies at all — the deny-by-default
   for everything except that one bucket's reads is the point of `0011`, and
   a policy silently added to a private bucket later would undermine it.
3. As a live check, not just a catalog read: fetch a real object's public
   URL from the `product-images` bucket (e.g.
   `https://<project-ref>.supabase.co/storage/v1/object/public/product-images/<path>`)
   from a plain, unauthenticated request and confirm it returns the file,
   not a 400/403.

If that policy is missing after a deploy, the practical symptom is blunt:
every product photo on the storefront 404s or 403s, because nothing else in
this schema grants read access to that bucket.
