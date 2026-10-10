# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fonology (fonology.co.uk) — a UK high-street phone repair & accessories shop in Thornliebank,
Glasgow. One Turborepo monorepo, three deployables:

```
apps/web          Next.js 15 (App Router). Storefront + admin dashboard + employee POS.
apps/api          Express + TypeScript. The only holder of the database and storage credentials.
apps/print-agent  Runs on the till PC, not on any server. Drives a Brother QL-600 label
                   printer and an eposnow POS80GXa receipt printer.
supabase/         SQL migrations (numbered, additive-only) + pgTAP test suite.
```

pnpm workspaces (`apps/*`, `packages/*` — no `packages/*` populated yet). `packageManager:
pnpm@11.0.9`, Node >=20.

## Commands

```bash
pnpm install
pnpm dev                       # turbo run dev — all apps in parallel, Turbopack for web
pnpm build                     # turbo run build
pnpm lint                      # turbo run lint
pnpm typecheck                 # turbo run typecheck (tsc --noEmit)
pnpm format                    # prettier --write across the repo
```

Per-package, when you only touch one app (`turbo` scopes automatically, but for a tight loop):

```bash
pnpm --filter @fonology/web dev            # Next.js on :3000
pnpm --filter @fonology/web dev:webpack    # webpack instead of Turbopack — fallback only
pnpm --filter @fonology/web test           # vitest run
pnpm --filter @fonology/web test <path>    # a single test file
pnpm --filter @fonology/api dev            # tsx watch src/server.ts, on :4000
pnpm --filter @fonology/print-agent build  # tsc --noEmit then bundles with esbuild
```

Running the app locally (two terminals, no root env juggling needed if `.env.local` files are
already in place — see `ENV-SETUP-GUIDE.md`):

```bash
cd apps/api && npx tsx src/server.ts     # wait for "[api] listening on :4000"
cd apps/web && pnpm run dev              # wait for "✓ Ready", open :3000
```

On `migrate-off-supabase` the API runs entirely on the local stack below — database, sign-in,
file storage and email; nothing local can reach production. A fresh stack needs
`pnpm db:migrate && pnpm storage:setup && pnpm db:seed` once — and, for the shop's own starting
set-up (settings, categories, repair types, the "Other" phone, the owner), `pnpm --filter @fonology/api setup:shop`
before the seed. It applies `deploy/shop-setup.json`, the one reviewed source of that set-up (the
same file production gets — go-live.md §5), refuses a database that already has staff, and has
`--dry-run`. The local dev database is a TEST database: don't copy anything from it into
production. (The old `import:supabase` reads a Supabase project that no longer answers.)
`NEXT_PUBLIC_API_BASE_URL` must say `localhost`, not `127.0.0.1` — the two are different origins
to the browser and it silently breaks the auth cookie.

Database (local Docker stack only — pgTAP never runs against a hosted project). On
`migrate-off-supabase` the stack is `docker-compose.dev.yml` — Postgres 17 + pgTAP on
`localhost:55432`, Garage (S3) on `:3900` with public reads on `:3902`, Mailpit SMTP `:1025` /
inbox `http://localhost:8025` (with `SMTP_URL=smtp://localhost:1025` every email the API sends lands
there). Since 0093 the pgTAP suite only runs here, not under `supabase test db`:

```bash
pnpm stack:up        # idempotent: starts, waits for health, gives Garage its layout + dev key
pnpm stack:down      # stop, keep data     ·  pnpm stack:reset  # stop and delete all data
pnpm db:migrate      # apply pending migrations to `fonology` (--status to only list them)
pnpm db:test         # fresh `fonology_test`, all migrations, then the pgTAP suite via pg_prove
pnpm --filter @fonology/api exec tsx scripts/seed-dev.ts   # TEST-LOGINS.md accounts (+ one device
                                                            # if none) — refuses a non-local DB
```

`apps/api/src/scripts/migrate.ts` applies the frozen `supabase/migrations` **unedited** to plain
Postgres: it first creates the roles and runs `db/bootstrap/00_supabase_compat.sql` (stub
`auth.users`, `storage.*`, roles `anon`/`authenticated`/`service_role`), then each pending file in
its own transaction as `fonology_owner`, recorded with a checksum in
`fonology_migrations.applied` — an edited, already-applied file stops the run. Needs a superuser
URL (`MIGRATE_DATABASE_URL`, defaults to the local stack). Roles: `fonology_owner` owns the
schema and has BYPASSRLS like Supabase's `postgres` (0045 forces RLS on a table, then seeds it);
`fonology_api` is the API's LOGIN role — BYPASSRLS + member of `service_role`, no DDL.

From Git Bash, `docker compose exec … /garage …` needs `MSYS_NO_PATHCONV=1` or the path is
rewritten to `C:/Program Files/Git/garage`.

API verification scripts (`apps/api/scripts/`), against a local API on `localhost:4000`:

```bash
pnpm --filter @fonology/api exec tsx scripts/e2e-test.ts      # ~80 checks, signup (confirm link read
                                                               # from Mailpit) and password reset through
                                                               # day-close reconciliation and the PIN-switch
                                                               # restriction; retires its own products
pnpm --filter @fonology/api exec tsx scripts/e2e-variations.ts # product variations (0107): the client
                                                               # spec's acceptance checklist over HTTP;
                                                               # retires its own product
pnpm --filter @fonology/api exec tsx scripts/e2e-repair-pricing.ts # repair prices per device (0109):
                                                               # sub-types, "not offered", duplicate,
                                                               # job price taken at creation
pnpm --filter @fonology/api exec tsx scripts/schema-audit.ts  # signs in, hits every endpoint, validates
                                                               # the response through the frontend's own
                                                               # Zod schemas — needs AUDIT_STAFF_EMAIL /
                                                               # AUDIT_STAFF_PASSWORD in apps/api/.env.local
```

Both default to `http://localhost:4000` — never `127.0.0.1`, which `lib/cookies.ts` treats as
cross-site from `WEB_APP_URL` and refuses to set a session cookie for, so every signed-in check
500s. `scripts/` is typechecked by `pnpm typecheck` (`apps/api/tsconfig.scripts.json`). schema-audit
reports ~7 SILENT rows that are expected: fields sent only conditionally (`variants` on products that
have them, `temporaryPassword` on account creation, `condition` on a single sell request).

Real-browser tests (`packages/e2e`, Playwright) — by default against the local web :3000 and API
:4000 (`E2E_WEB_BASE` / `E2E_API_BASE` to point elsewhere). They write real data and clean it up
afterwards, refuse `fonology.co.uk` unless `ALLOW_TEST_WRITES=true` (pre-launch only), and
PIN-switch the owner test account — which signs that account out everywhere. Read `packages/e2e/README.md` first:

```bash
pnpm --filter @fonology/e2e e2e:install     # once per machine: fetches Chromium
pnpm --filter @fonology/e2e e2e             # all 14 change-request items, then cleanup
```

**Test coverage is uneven and that's a known, load-bearing fact of this codebase**: the SQL layer
is heavily tested (pgTAP, 34 files / ~520 assertions covering money rounding, permissions,
concurrency); `apps/web` has vitest wired but only a couple of unit tests exist
(`src/lib/auth-redirect.test.ts` is one); `apps/print-agent` has no test runner at all. The
recurring "passes tests, breaks on first real click" bug class in this project comes from that
gap — the DB proves its own invariants, but nothing proves the HTTP contract between web and api
except `schema-audit.ts`. Run it after touching any endpoint or Zod schema.

`packages/e2e` covers the other half of that gap — what happens between loading a screen and
saving it back — and its first run found two bugs everything else had passed: editing a handset
erased its IMEI (the form opened the field blank), and a PIN switch left the till with an empty
catalogue. The second also passed that suite's own first draft; it was caught from a screenshot.
**A green run is not proof until the screenshots agree** — they're attached to its HTML report.

## Architecture

### The one rule that shapes `apps/web`

**No component ever calls `fetch()`.** Data flows one way, always:

```
component → src/lib/data/hooks (TanStack Query) → DataAdapter → http.adapter.ts → apps/api
```

There is one adapter (the old in-memory mock adapter was deleted — the web app always needs the
API running). The adapter interface is `src/lib/data/adapters/types.ts`; every entity has a Zod
schema in `src/lib/data/types/`, and the adapter parses every response through the matching schema — bad data fails loudly at the
boundary, not deep in a component. This means **a schema change on the API side is invisible to
TypeScript on the web side** — it only shows up as a runtime Zod parse failure or via
`schema-audit.ts`. When you change what an endpoint returns, update the Zod schema in the same
change.

Three route groups under `src/app`: `(storefront)`, `(dashboard)` (admin), `(pos)` (employee
till), plus `(auth)`. Permissions are UX-only in the frontend
(`src/lib/permissions.config.ts` — role→capability map that only controls what renders);
the real enforcement is server-side, per person, in `apps/api`.

**Known tradeoff: `/shop/[slug]` (the product detail page) is `revalidate = 0` — every view calls
the live API, no cached HTML.** This is intentional, not an oversight — see that export's own
comment for the full story. Short version: purchasability (`isPurchasable`, driven by
`product.kind`) has to match the DB the instant an admin moves a product in or out of the vape
category — vapes are legally not orderable online — and on-demand revalidation
(`revalidatePath`, wired up via `POST /api-internal/revalidate-product`) was built for exactly
that but never actually took effect in this deployment (Render, Docker `output: 'standalone'`),
verified live, twice, with two different well-documented fixes attempted first. `revalidate = 0`
is the fallback that's guaranteed correct regardless of why on-demand revalidation isn't
persisting here. Fine at the catalogue's current size (~66 products); if the catalogue or traffic
grows enough for this to show up as real PDP latency, that's the moment to either dig further into
why revalidatePath doesn't stick on this deployment, or move to a shorter time-based
`revalidate` value as a middle ground — **do not "simplify" this back to a longer cached
`revalidate` value or remove it without first confirming on-demand revalidation genuinely works
end-to-end against the live deployment** (a real category move, not a rebuild) — that's exactly
how the original bug came back.

### `apps/api`

Express, one route file per domain in `src/routes/` (auth, products, orders, repairs, sell, pos,
jobs, admin, staff, shop, print, webhooks). **The frontend never talks to the database
directly**; this service is the only thing holding a database credential. Every table query goes
through Kysely (`src/lib/db.ts`, typed by `src/db/types.ts` — regenerate with
`pnpm --filter @fonology/api db:types` after a migration — it fetches kysely-codegen on demand
with `pnpm dlx`; **don't add it back as a dependency**: it brings zod 4, which won the hoist in the
Docker install and broke the web's production build, since `@hookform/resolvers` takes whichever
zod is hoisted), connecting as `fonology_api`.
`db.ts` installs type parsers so values come back exactly as PostgREST returned them (timestamps
as `…T…+00:00` strings, `date` as a plain string, bigint/numeric as numbers, enum arrays as
arrays) — the web app's Zod schemas were written against that. DB functions are called with
`rpc(name, args, { returnsSet })`; `scripts/rpc-audit.ts` checks every call against `pg_proc`.
Arrays written to a `jsonb` column must be `JSON.stringify`'d (node-postgres sends a JS array as
a Postgres array literal).

Files go to S3-compatible storage (Garage) through `src/lib/storage.ts`: `product-images` is
public (served from `STORAGE_PUBLIC_URL`, which `next.config.mjs` also allows for next/image);
`id-documents` and `buy-in-forms` are private and only ever reached through 60-second signed
links. `src/scripts/storage-setup.ts` (`pnpm storage:setup`) creates the buckets through Garage's
admin API — S3 CreateBucket would give them names only the creating key sees, which Garage's
public web endpoint can't find.

Sign-in is the API's own (0093): `user_accounts` (argon2id via `lib/password.ts`; bcrypt hashes
imported from Supabase verify and are re-hashed on first sign-in), `auth_sessions` (the
`fnl_session` cookie is a random token, stored only as its SHA-256, sliding 30-day expiry —
`lib/authSessions.ts`) and `auth_tokens` (single-use emailed links: signup confirmation, password
reset — `lib/authEmails.ts`). Google sign-in runs entirely on the API (`/auth/google/start` →
Google → `/auth/google/callback`, PKCE, `lib/google.ts`); needs `GOOGLE_CLIENT_ID`/`_SECRET` and
`API_PUBLIC_URL`. A PIN switch mints a session directly. `src/middleware/auth.ts` resolves the session from an httpOnly cookie;
`src/middleware/agentAuth.ts` is the separate bearer-token check for the print agent.
`src/lib/permissions.ts` + `staff_can()` (in the DB) are where authorization actually happens —
never trust `staff.role` as a security check, it's a display label.

Standing rules enforced end-to-end (money bugs and permission leaks happen when these are
violated):

- **All money is integer pence.** Pounds only exist at the display layer.
- **The server computes every money figure.** The till/checkout sends line ids and quantities;
  the server prices them. Never trust a client-supplied amount.
- **Staff attribution comes from the session, never the request body.**
- **References come only from `issue_shop_reference()`** (Postgres function, 0106, writes to
  `reference_registry`) — never generate one in application code. Format `F01-JOB-061026001`:
  shop code (assigned by the DB on shop insert, permanent, never reused), one of seven prefixes
  (ORD SAL REQ JOB TRD PAY REF), the shop-day as DDMMYY, a per-shop/prefix/day counter. Don't sort
  by reference — the date is day-first; sort by `created_at`. Goods-in notes alone still use the
  legacy `issue_reference()` (GIN-).
- **No VAT anywhere** — the business isn't VAT registered. Schema-wide enforced by
  `supabase/tests/001_structure.sql`.
- **Customers never see stock counts, cost, or margin** — only in-stock/out-of-stock/restocking.
- **`shop_settings` is the single source of shop facts** (address, phone, hours, returns window)
  — there were once five hardcoded copies of this including the JSON-LD Google reads; don't
  reintroduce one.

### `supabase/migrations`

Plain numbered SQL, applied in order, **additive only**. Read `supabase/migrations/README.md`
before writing one — it documents real incidents (an enum-in-same-transaction Postgres
limitation that forced `0012` into its own file; a `0033` bug caught before push and fixed in
place) and the rule that follows from them:

**A migration is frozen the moment it's committed and pushed, not the moment it's first run.**
Before push, editing a migration file that only ever touched the dev database is fine — file and
DB stay in agreement. After push, someone else may have applied it; from that point a mistake is
fixed by a new migration, however small.

Two Supabase projects exist — dev (`ohkvwqqtppvnxbvvdsfr`, migrations up to 0092, seeded; the
step-8 import reads from it, so 0093 must never be applied there) and production
(`sbqqpuqoizyjzdcydqid`, never used — the shop goes live on its own server, not Supabase). **The Supabase MCP connector is org-wide and auto-resumes a paused
project on connection, so "paused" is not a safety boundary.** State the project ref explicitly
before every write through that connector.

RLS is enabled schema-wide with zero policies (deny-all) — it's a second line of defense in case
the service-role key ever leaks, not where authorization actually lives (that's `apps/api` +
`staff_can()`). Files are outside the database: only `product-images` is publicly readable.

### Print system (`apps/print-agent` + `supabase/migrations/0033_print_queue.sql` + `apps/api/src/routes/print.routes.ts`)

The agent runs on the shop's till PC as a **Windows Scheduled Task at logon** (not a service — a
LocalSystem service runs in an isolated session and can't reliably see printers; the logon
trigger repeats every 10 minutes as a watchdog). It **long-polls** `GET /print/jobs/next` (~25s)
and never receives an inbound connection — the API is on a remote VPS, the printers are on the
shop's private LAN, and a browser tab can't open a raw socket or hold a queue anyway.

Flow: web/POS action → `POST /print/jobs` (API builds the frozen payload server-side from the
entity, not from the client) → agent long-polls and claims it (`claim_print_job()`, atomic) →
prints → `POST /print/jobs/:id/ack`.

At-most-once, not exactly-once, via an **on-disk marker** written before the first byte and
cleared only after the ack is accepted:

- marker absent → nothing was sent → safe to auto-requeue
- marker present → bytes may have gone → receipt becomes `unconfirmed`, never auto-reprinted

Receipts and labels are treated asymmetrically on purpose (a duplicate receipt looks like return
fraud; a duplicate label just wastes an inch of roll) — that asymmetry lives in
`expire_print_leases()` in the DB, not in the agent. Read `apps/print-agent/README.md` before
touching any of this — it documents which hardware assumptions (USB vs TCP transport, roll type,
codepage, cut behavior) are still unverified against real hardware and where the one code seam is
if they turn out wrong (`src/transports/index.ts`).

Printer/label config lives in `shop_settings.printer_config` (`GET /print/config`), not in the
agent — only the API URL and agent token are local (`agent.json`).

### Shops (multi-shop, stage 3)

Every till-owned row belongs to a `shops` row (design: `docs/stage3-design.md`). The one rule:
**the shop is never taken from a field an employee controls.** `apps/api/src/lib/shopScope.ts` is
where it lives — `readShop(req)` for filters (employees: always their own shop; owner/manager:
`?shop=<id>`, `?shop=all`, else their own), `writeShop(req, res)` for writes (employees and
managers: their own; an owner names one), `canRead` / `canWrite` for a row fetched by id. The DB
repeats the rule (`staff_shop()` in `complete_sale`, `create_refund`, `record_job_payment` …), so a
forgotten check in a route is still refused. The public site and online orders/repairs/trade-ins
are the hub shop's (`hubShopId()` / `hubShopSql`) until the master list lands. Till sessions belong
to a device (a sign-in reuses only the `staff_sessions` row in this browser's cookie). Run
`scripts/e2e-shops.ts` (two-shop isolation over HTTP; it switches its own test shop and accounts
on and off) after touching any scoped route. The dashboard's shop switcher (owners / managers)
sends `?shop=` on /admin pages only (`withShopSelection()` in `http.adapter.ts`); the long lists page on the
server via `optionalPaging()` / `DataTable`'s `server` prop.

**Cost prices are `costs.view`-only on the way out.** `lib/costs.ts`: `hideCosts()` zeroes `costPrice` / `cost` /
the inventory value in responses for anyone without it (mounted on the admin product/inventory/master
routes and `/pos/sales`); a product edit by such a person keeps the stored cost. Don't add a new endpoint
that returns a cost without putting it behind this. The till's below-cost warning is
`POST /pos/sales/below-cost` (shared `routes/pos/pricing.ts`), not browser arithmetic.

### Checkout / sell-flow — read this before touching either

This project has had a recurring bug class: **passes its own tests, breaks on the first real
click.** (It started when a mock adapter and the real API diverged in shape — the mock is gone,
but the web↔API contract is still only checked at runtime by Zod.) When changing anything in the
checkout or sell/trade-in path:

- Checkout: cart → `POST /orders` (server prices everything, including delivery — quoted from
  `delivery_rates`, shared logic between the read-only quote endpoint and the real charge so they
  can't drift) → Stripe (order created first, server-priced, webhook is
  signature-verified — see `apps/api/src/lib/stripe.ts` and `webhooks.routes.ts`).
- Sell/trade-in: `POST /sell/requests`, public, no auth required (customer accounts are optional
  by business rule — no storefront flow may require a session).
- POS till: `completeSale` is the one till write — split payments must sum exactly to the total,
  stock is deducted atomically, `complete_sale()` in the DB does lines + payments + stock
  consumption in one transaction with a deferred trigger that rolls everything back together if
  payments don't sum to the total.
- After any change here, run `schema-audit.ts` — it's the one thing that actually proves the
  frontend's Zod schema still matches what the API sends, which unit tests on either side alone
  won't catch.

## Documentation map

The build-process handover and working-notes files (`HANDOVER-*.md`, `NOTES.md`,
`BACKEND-INPUTS.md`, `REQUIREMENTS-AUDIT.md`, `SCHEMA-CONTEXT.md`, `QUESTION-TRIAGE.md`,
`CONTENT-TODO.md`, `QA-*.md`, `BUG-INVESTIGATION-REPORT*.md`, `FIX-PASS-REPORT.md`,
`INTEGRATION.md`) were **deleted before hand-off** — they had drifted far enough from the code to
mislead more than they helped. Recover any of them from git history if you need the reasoning
behind an old decision, but treat what you find as a snapshot, not as current truth.

**If a doc and the repo disagree, the repo is right.** Some source comments still cite the
deleted docs by name; read those as historical pointers, not as live references.

What remains, and is maintained:

- `README.md` — what the project is and how the two halves fit together.
- `HOW-TO-RUN.md` — starting the API and the web app locally.
- `SETUP.md` / `ENV-SETUP-GUIDE.md` — first-time setup and where the `.env.local` files go.
- `TEST-LOGINS.md` — the standing dev accounts (gitignored, transferred out-of-band).
- `supabase/migrations/README.md` — narrates the reasoning behind each migration; keep it updated
  when adding one, but check the real file count with `ls supabase/migrations` rather than
  trusting its own claimed "current to" number.

Deploy target is a **netcup VPS run by Coolify** (stage 4 of the off-Supabase plan), from the two
Dockerfiles with the repo root as build context. Render was removed on 2026-09-27 — pushing
`main` deploys nothing today. The API image also carries the server-side jobs, compiled to
`dist/scripts/` (migrate, storage-setup, purge-documents, purge-print-jobs — see the Dockerfile
header for the commands).

`APP_ENV` says which deployment this is (`production` = the live shop) and is required whenever
`NODE_ENV=production`. `ALLOW_TEST_WRITES=true` is the pre-launch switch: it lets e2e-test,
seed-dev, e2e-cleanup and Playwright write to production, and lets the API boot there with a Stripe
test key. Without it those scripts refuse production (`assertTestWritesAllowed` in config.ts) and
a test key there stops the boot; a LIVE Stripe key outside production always stops the boot.
**Remove `ALLOW_TEST_WRITES` on opening day**, after cleanup and disabling the test accounts.

### Go-live: production has never been configured

The live server has nothing on it yet. Two traps follow, and both fail in ways that look like
application bugs:

1. **Migrations must land BEFORE the API service deploys.** The API calls into DB functions
   that only exist once their migration is applied; deploy the API first and those calls fail
   with a 400 and nothing in the code to suggest why.
2. **The storage buckets must exist before the first upload.** `pnpm storage:setup` creates all
   three and leaves `id-documents` / `buy-in-forms` private (signed links only) — the posture
   the plate document upload assumes. Only `product-images` is public.

Do NOT use Coolify's pre-/post-deployment commands for `migrate.js` (pre runs in the OLD container and is skipped on
the first deploy; post runs after the new API is already live): set `MIGRATE_DATABASE_URL` for the deploy and the image's
`docker-entrypoint.sh` migrates before the server starts (and fails safe). `MIGRATE_DATABASE_URL` must name the
`fonology` database — the runner migrates whichever database the URL names. Run `storage-setup.js` once: it applies
Garage's layout, imports the operator-generated `S3_ACCESS_KEY_ID`/`_SECRET`, and makes the buckets. Full runbook:
`docs/go-live.md` (variables: `docs/coolify-env-vars.md`); prove a deployment with `scripts/go-live-check.mjs`.
`TRUST_PROXY_HOPS` must match the real proxy chain (1 behind Traefik alone, 2 behind Cloudflare too).

**Dress rehearsal** — after touching a Dockerfile, `deploy/`, the entrypoint, a migration or a server-side job, run the
runbook locally against the real production images: `pnpm rehearsal:up && pnpm rehearsal:test` (`-- --playwright` adds
the browser suite), `pnpm rehearsal:down` to delete it. Official Postgres 17 + `deploy/docker-compose.garage.yml`
unedited + Caddy with a local CA on `https://*.fonology.localtest.me`; it ends with `go-live-check`. Needs 80/443 free.

**CI** (`.github/workflows/`): `ci.yml` on every push/PR — typecheck, lint, API + web unit tests, the
pgTAP suite on the dev stack, and both production images built (placeholder build args).
`rehearsal.yml` runs the dress rehearsal on every push to `main` and by hand (with the browser suite
as an option); it needs repository secrets `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`,
`STRIPE_TEST_PUBLISHABLE_KEY` (test mode only). There is no deploy workflow yet — CD (images to
GHCR, a Coolify deploy hook, a required approval) waits for the server.

`.env.local` files (root, `apps/web`, `apps/api`) and `TEST-LOGINS.md` are gitignored and
transferred out-of-band — see `ENV-SETUP-GUIDE.md` if you need to know where they go, not how to
generate them.
