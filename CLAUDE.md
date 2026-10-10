# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository. **If a doc and the repo disagree, the repo is
right.** Source comments are meant to be current; if one cites a document that does not exist, it is stale —
fix or delete the comment.

## What this is

Fonology (fonology.co.uk) — a UK high-street phone repair & accessories shop in Thornliebank, Glasgow. One
Turborepo monorepo, three deployables:

```
apps/web          Next.js 15 (App Router). Storefront + admin dashboard + employee POS.
apps/api          Express + TypeScript. The only holder of the database and storage credentials.
apps/print-agent  Runs on the till PC, not on any server. Drives a Brother QL-600 label
                  printer and an eposnow POS80GXa receipt printer.
db/               SQL migrations (numbered, additive-only) + bootstrap stubs.
```

pnpm workspaces (`apps/*`). `packageManager: pnpm@11.0.9`, Node >=20 (the dev machine has pnpm 9 — see
"Changing dependencies").

## Commands

```bash
pnpm install
pnpm dev                       # turbo run dev — all apps in parallel, Turbopack for web
pnpm build | lint | typecheck  # turbo run …
pnpm format                    # prettier --write across the repo
pnpm --filter @fonology/web dev            # Next.js on :3000
pnpm --filter @fonology/api dev            # tsx watch src/server.ts, on :4000
pnpm --filter @fonology/print-agent build  # tsc --noEmit then bundles with esbuild
```

Running locally (README has the full first-time sequence: `setup:env`, `stack:up`, `db:migrate`,
`storage:setup`, `db:seed`):

```bash
cd apps/api && npx tsx src/server.ts     # wait for "[api] listening on :4000"
cd apps/web && pnpm run dev              # wait for "✓ Ready", open :3000
```

`NEXT_PUBLIC_API_BASE_URL` must say `localhost`, not `127.0.0.1` — they are different origins to the browser and
it silently breaks the auth cookie.

Local stack (`docker-compose.dev.yml`): Postgres 17 on `localhost:55432`, Garage (S3) on `:3900` with public
reads on `:3902`, Mailpit SMTP `:1025` / inbox `http://localhost:8025` (with `SMTP_URL=smtp://localhost:1025`
every email the API sends lands there). The local database is a TEST database: nothing local can reach
production, and nothing from it should be copied into production. For the shop's own starting data
(settings, categories, repair types, the "Other" phone, the owner) use `pnpm --filter @fonology/api
setup:shop` — it applies `deploy/shop-setup.json`, the one reviewed source of that data (go-live.md §5),
refuses a database that already has staff, and has `--dry-run`.

From Git Bash, `docker compose exec … /garage …` needs `MSYS_NO_PATHCONV=1` or the path is rewritten.

**There is no automated test suite** (it was deleted on purpose, 2026-10-10). The checks are `pnpm typecheck`
and `pnpm lint`, plus running the app and clicking through the flows. Because nothing automated proves the
HTTP contract between web and api, **a schema change on the API side is invisible to TypeScript on the web
side**: it only shows up as a runtime Zod parse failure. When you change what an endpoint returns, update the
Zod schema in `apps/web/src/lib/data/types/` in the same change, and click the screen that uses it.

## Architecture

### The one rule that shapes `apps/web`

**No component ever calls `fetch()`.** Data flows one way:

```
component → src/lib/data/hooks (TanStack Query) → DataAdapter → http.adapter.ts → apps/api
```

The adapter interface is `src/lib/data/adapters/types.ts`; every entity has a Zod schema in
`src/lib/data/types/`, and the adapter parses every response through it, so bad data fails loudly at the
boundary, not deep in a component. The web app always needs the API running.

Route groups under `src/app`: `(storefront)`, `(dashboard)` (admin), `(pos)` (employee till), `(auth)`.
Permissions in the frontend (`src/lib/permissions.config.ts`) only control what renders; the real
enforcement is server-side, per person, in `apps/api`.

`storefront.css` is the client-approved prototype's CSS, copied verbatim: don't restyle it. New storefront
rules go in `storefront-extend.css`. The storefront is reproduced, not redesigned.

**`/shop/[slug]` (product detail) is `revalidate = 0` — every view calls the live API.** Intentional: whether a
product can be bought online (`isPurchasable`, driven by `product.kind`) must match the database the instant an
admin moves it in or out of the vape category (vapes are legally not orderable online). On-demand revalidation
was tried and did not persist in this deployment, and was removed. Don't "simplify" this to a longer cached
`revalidate` without first proving on a real deployment that a category move shows up within the window.

### `apps/api`

Express, one route file per domain in `src/routes/` (auth, products, orders, repairs, sell, pos, jobs, admin,
staff, shop, print, webhooks, …). **The frontend never talks to the database directly.** Every table query goes
through Kysely (`src/lib/db.ts`, typed by `src/db/types.ts` — regenerate with `pnpm --filter @fonology/api
db:types` after a migration; it fetches kysely-codegen on demand with `pnpm dlx`, **don't add it as a
dependency**: it brings zod 4, which won the hoist in the Docker install and broke the web build), connecting as
`fonology_api`. DB functions are called with `rpc(name, args, { returnsSet })`. Arrays written to a `jsonb`
column must be `JSON.stringify`'d (node-postgres sends a JS array as a Postgres array literal).

Handlers are registered through `createRouter()` (`lib/router.ts`), which routes async rejections into the error
middleware — Express 4 doesn't. Use it for every new router.

Files go to S3-compatible storage (Garage) through `src/lib/storage.ts`: `product-images` is public (served from
`STORAGE_PUBLIC_URL`, which `next.config.mjs` also allows); `id-documents` and `buy-in-forms` are private and only
reached through 60-second signed links. `pnpm storage:setup` creates the buckets through Garage's admin API.

Sign-in is the API's own: `user_accounts` (argon2id via `lib/password.ts`), `auth_sessions` (the `fnl_session`
cookie is a random token, stored only as its SHA-256, sliding 30-day expiry — `lib/authSessions.ts`) and
`auth_tokens` (single-use emailed links: signup confirmation, password reset). Google sign-in runs on the API
(`/auth/google/start` → Google → `/auth/google/callback`, PKCE); needs `GOOGLE_CLIENT_ID`/`_SECRET` and
`API_PUBLIC_URL`. A PIN switch at the till mints a session directly. `src/middleware/auth.ts` resolves the
session from an httpOnly cookie; `src/middleware/agentAuth.ts` is the separate bearer-token check for the print
agent. `src/lib/permissions.ts` + `staff_can()` (in the DB) are where authorization happens — never trust
`staff.role` as a security check, it's a display label.

Standing rules enforced end to end (money bugs and permission leaks happen when these are violated):

- **All money is integer pence.** Pounds only exist at the display layer.
- **The server computes every money figure.** The till/checkout sends line ids and quantities; the server
  prices them. Never trust a client-supplied amount.
- **Staff attribution comes from the session, never the request body.**
- **References come only from `issue_shop_reference()`** (Postgres function, writes to `reference_registry`) —
  never generate one in application code. Format `F01-JOB-061026001`: shop code (assigned by the DB on shop
  insert, permanent, never reused), one of seven prefixes (ORD SAL REQ JOB TRD PAY REF), the shop-day as DDMMYY,
  a per-shop/prefix/day counter. Don't sort by reference — the date is day-first; sort by `created_at`.
  Goods-in notes alone still use the legacy `issue_reference()` (GIN-).
- **No VAT anywhere** — the business isn't VAT registered.
- **Customers never see stock counts, cost, or margin** — only in-stock/out-of-stock/restocking.
- **`shop_settings` is the single source of shop facts** (address, phone, hours, returns window). Don't
  reintroduce a hardcoded copy.
- **Cost prices are `costs.view`-only on the way out.** `lib/costs.ts`: `hideCosts()` zeroes `costPrice` /
  `cost` / the inventory value in responses for anyone without it (mounted on the admin product/inventory/
  master routes and `/pos/sales`). Don't add an endpoint that returns a cost without putting it behind this.
  The till's below-cost warning is `POST /pos/sales/below-cost`, not browser arithmetic.
- `any` is banned by lint (`no-unsafe-*` are on). Type `req.body` fields with a cast to `unknown` and narrow.

### Database (`db/migrations`)

Plain numbered SQL, applied in order by `apps/api/src/scripts/migrate.ts`, **additive only**. Read
`db/migrations/README.md` before writing one. The key rule: **a migration is frozen the moment it is committed
and pushed**; after that a mistake is fixed by a new migration. The runner stores a checksum per file and stops
if an applied file changed.

RLS is enabled schema-wide with zero policies (deny-all) — a second line of defence, not where authorization
lives (that's `apps/api` + `staff_can()`). `fonology_owner` owns the schema (BYPASSRLS; migrations run as it);
`fonology_api` is the API's LOGIN role (BYPASSRLS, member of `service_role`, no DDL).
`db/bootstrap/00_legacy_stubs.sql` stubs the Supabase-shaped objects (`auth.users`, `storage.*`, the `anon` /
`authenticated` / `service_role` roles) that migrations 0001–0092 were written against, so they apply unedited.
The project no longer uses Supabase for anything.

### Print system (`apps/print-agent` + `0033_print_queue.sql` + `apps/api/src/routes/print.routes.ts`)

The agent runs on the shop's till PC as a **Windows Scheduled Task at logon** (not a service — a LocalSystem
service runs in an isolated session and can't reliably see printers; the logon trigger repeats every 10 minutes
as a watchdog). It **long-polls** `GET /print/jobs/next` (~25s) and never receives an inbound connection — the
API is on a remote VPS and the printers are on the shop's private LAN.

Flow: web/POS action → `POST /print/jobs` (API builds the frozen payload server-side from the entity, not from
the client) → agent long-polls and claims it (`claim_print_job()`, atomic) → prints → `POST /print/jobs/:id/ack`.

At-most-once, not exactly-once, via an **on-disk marker** written before the first byte and cleared only after
the ack is accepted: marker absent → nothing was sent → safe to auto-requeue; marker present → bytes may have
gone → a receipt becomes `unconfirmed`, never auto-reprinted. Receipts and labels are treated asymmetrically on
purpose (a duplicate receipt looks like return fraud; a duplicate label just wastes an inch of roll) — that
lives in `expire_print_leases()` in the DB, not in the agent. Read `apps/print-agent/README.md` before touching
any of this: it lists which hardware assumptions (USB vs TCP transport, roll type, codepage, cut behaviour) are
still unverified and where the one code seam is (`src/transports/index.ts`). Printer/label config lives in
`shop_settings.printer_config` (`GET /print/config`); only the API URL and agent token are local (`agent.json`).

### Shops (multi-shop)

Every till-owned row belongs to a `shops` row (rules: `docs/multi-shop.md`). **The shop is never taken from a
field an employee controls.** `apps/api/src/lib/shopScope.ts` is where it lives — `readShop(req)` for filters
(employees: always their own shop; owner/manager: `?shop=<id>`, `?shop=all`, else their own), `writeShop(req,
res)` for writes (employees and managers: their own; an owner names one), `canRead` / `canWrite` for a row
fetched by id. The DB repeats the rule (`staff_shop()` in `complete_sale`, `create_refund`, `record_job_payment`
…), so a forgotten check in a route is still refused. The public site and online orders/repairs/trade-ins are
the hub shop's (`hubShopId()` / `hubShopSql`). Till sessions belong to a device. The dashboard's shop switcher
sends `?shop=` on /admin pages only (`withShopSelection()` in `http.adapter.ts`); "All shops" is view-only —
the API refuses every write that names it. Long lists page on the server via `optionalPaging()` / `DataTable`'s
`server` prop.

### Checkout / sell-flow — read this before touching either

- Checkout: cart → `POST /orders` (server prices everything, including delivery — quoted from `delivery_rates`,
  shared logic between the read-only quote endpoint and the real charge so they can't drift) → Stripe (order
  created first, server-priced; the webhook is signature-verified — `apps/api/src/lib/stripe.ts`,
  `webhooks.routes.ts`, and mounted _above_ `express.json()` on purpose). While an order is pending, the status
  endpoint also asks Stripe directly, so a late webhook can't strand a paid customer.
- Sell/trade-in: `POST /sell/requests`, public, no auth (customer accounts are optional by business rule — no
  storefront flow may require a session).
- POS till: `completeSale` is the one till write — split payments must sum exactly to the total, stock is
  deducted atomically; `complete_sale()` in the DB does lines + payments + stock in one transaction with a
  deferred trigger that rolls everything back together if payments don't sum to the total.
- After any change here, click the whole flow in a browser (a passing typecheck proves nothing about it).

## Operations

Deploy target is a **netcup VPS run by Coolify**, from the two Dockerfiles with the repo root as build context;
`.github/workflows/` has CI (typecheck, lint, both images build), the production rehearsal, and a draft deploy
workflow. The API image also carries the server-side jobs, compiled to `dist/scripts/` (migrate, storage-setup,
setup-shop, purge-documents, purge-print-jobs, purge-sms-log, purge-housekeeping — see the Dockerfile header).

`APP_ENV` says which deployment this is (`production` = the live shop) and is required whenever
`NODE_ENV=production`. `ALLOW_TEST_WRITES=true` is the pre-launch switch that lets seed scripts write to
production and lets the API boot there with a Stripe test key; without it a test key in production stops the
boot, and a LIVE key outside production always does. **Remove `ALLOW_TEST_WRITES` on opening day.**

### Go-live: production has never been configured

Two traps, and both fail in ways that look like application bugs:

1. **Migrations must land BEFORE the API service deploys** — the API calls DB functions that only exist once
   their migration is applied; otherwise those calls fail with a 400 and nothing in the code says why.
2. **The storage buckets must exist before the first upload** — `pnpm storage:setup` creates all three and leaves
   `id-documents` / `buy-in-forms` private.

Do NOT use Coolify's pre-/post-deployment commands for `migrate.js`: set `MIGRATE_DATABASE_URL` for the deploy and
the image's `docker-entrypoint.sh` migrates before the server starts (and fails safe). It must name the
`fonology` database — the runner migrates whichever database the URL names. `TRUST_PROXY_HOPS` must match the
real proxy chain (1 behind Traefik alone, 2 behind Cloudflare too). Runbook: `docs/go-live.md`; variables:
`docs/coolify-env-vars.md`; prove a deployment with `scripts/go-live-check.mjs`.

**Dress rehearsal** — after touching a Dockerfile, `deploy/`, the entrypoint, a migration or a server-side job:
`pnpm rehearsal:up && pnpm rehearsal:test`, then `pnpm rehearsal:down` (needs 80/443 free).

### Changing dependencies

The dev machine has pnpm 9; the repo pins 11 and the Dockerfiles use corepack. They hoist differently, so:

1. `npx --yes pnpm@11.0.9 install --lockfile-only` (writes the canonical lockfile; leaves node_modules alone).
2. `pnpm install --frozen-lockfile` with the local pnpm.
3. **`docker build -f apps/web/Dockerfile …`** — local typecheck passing is not enough (a second major of zod once
   broke only the image build). `.gitattributes` treats `pnpm-lock.yaml` as binary.

`.env.local` files (`apps/web`, `apps/api`) and `TEST-LOGINS.md` are gitignored; `pnpm setup:env` writes the
env files with local defaults. Never print env values.

## Documentation map

`README.md` (setup and commands) · `db/migrations/README.md` (migration rules) · `docs/go-live.md` +
`docs/coolify-env-vars.md` (production) · `docs/multi-shop.md` (shop rules) · `docs/legal-review.md` (what the
legal pages assume and the owner must confirm) · `apps/print-agent/README.md` and `PRINTER-CHECK.md`.
