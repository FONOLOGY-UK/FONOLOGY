# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Fonology (fonology.co.uk) — a UK high-street phone repair & accessories shop in Thornliebank,
Glasgow. One Turborepo monorepo, three deployables:

```
apps/web          Next.js 15 (App Router). Storefront + admin dashboard + employee POS.
apps/api          Express + TypeScript. Holds the Supabase service-role key.
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

Both `.env.local` files point at the **dev** Supabase project by default — nothing local can
reach production. `NEXT_PUBLIC_API_BASE_URL` must say `localhost`, not `127.0.0.1` — the two
are different origins to the browser and it silently breaks the auth cookie.

Database (local Docker stack only — pgTAP never runs against a hosted project):

```bash
npx supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit
npx supabase test db
```

The `-x` list is required (those containers fail health checks and roll the whole start back).
`supabase db reset` has hung before — applying migration files directly with `psql` is the
reliable path when reset misbehaves.

API verification scripts (`apps/api/scripts/`):

```bash
npx tsx apps/api/scripts/e2e-test.ts        # ~55 checks, signup through day-close reconciliation
npx tsx apps/api/scripts/schema-audit.ts    # signs in, hits every endpoint, validates the response
                                             # through the frontend's own Zod schemas — needs
                                             # AUDIT_STAFF_EMAIL / AUDIT_STAFF_PASSWORD in apps/api/.env.local
```

**Test coverage is uneven and that's a known, load-bearing fact of this codebase**: the SQL layer
is heavily tested (pgTAP, ~26 files / ~400 assertions covering money rounding, permissions,
concurrency); `apps/web` has vitest wired but only a couple of unit tests exist
(`src/lib/auth-redirect.test.ts` is one); `apps/print-agent` has no test runner at all. The
recurring "passes tests, breaks on first real click" bug class in this project comes from that
gap — the DB proves its own invariants, but nothing proves the HTTP contract between web and api
except `schema-audit.ts`. Run it after touching any endpoint or Zod schema.

## Architecture

### The one rule that shapes `apps/web`

**No component ever calls `fetch()`.** Data flows one way, always:

```
component → src/lib/data/hooks (TanStack Query) → DataAdapter → mock.adapter.ts | http.adapter.ts
```

Which adapter is live is one env var: `NEXT_PUBLIC_DATA_SOURCE=mock|http`. `mock` needs no
backend at all (in-memory fixtures) — useful for pure frontend work. The adapter interface is
`src/lib/data/adapters/types.ts`; every entity has a Zod schema in `src/lib/data/types/`, and the
http adapter parses every response through the matching schema — bad data fails loudly at the
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
jobs, admin, staff, shop, print, webhooks, guest). `src/lib/supabase.ts` builds the service-role
client — **the frontend never talks to Supabase directly**; this service is the only thing
holding that key. `src/middleware/auth.ts` resolves the session from an httpOnly cookie;
`src/middleware/agentAuth.ts` is the separate bearer-token check for the print agent.
`src/lib/permissions.ts` + `staff_can()` (in the DB) are where authorization actually happens —
never trust `staff.role` as a security check, it's a display label.

Standing rules enforced end-to-end (money bugs and permission leaks happen when these are
violated):

- **All money is integer pence.** Pounds only exist at the display layer.
- **The server computes every money figure.** The till/checkout sends line ids and quantities;
  the server prices them. Never trust a client-supplied amount.
- **Staff attribution comes from the session, never the request body.**
- **References come only from `issue_reference()`** (Postgres function, writes to
  `reference_registry`) — never generate one in application code.
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

Two Supabase projects exist — dev (`ohkvwqqtppvnxbvvdsfr`, all migrations applied, seeded) and
production (`sbqqpuqoizyjzdcydqid`, historically paused with nothing applied — check current
state before assuming). **The Supabase MCP connector is org-wide and auto-resumes a paused
project on connection, so "paused" is not a safety boundary.** State the project ref explicitly
before every write through that connector.

RLS is enabled schema-wide with zero policies (deny-all) — it's a second line of defense in case
the service-role key ever leaks, not where authorization actually lives (that's `apps/api` +
`staff_can()`). The one exception is product photos, public-read in Storage.

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

### Checkout / sell-flow — read this before touching either

This project has a recurring bug class: **works against the mock adapter, breaks on the first
real click against the API.** It happens because the mock and the real backend can silently
diverge in shape (an enum value, a required field) while TypeScript sees only the mock's own
echo. When changing anything in the checkout or sell/trade-in path:

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

Deploy target is **self-hosted Docker/Coolify**, not Vercel, despite an early commit mentioning a
Vercel deploy trigger. No Render config exists in this repo (no `render.yaml`) — if deployment
moves to Render, that's new work, not something already set up here.

`.env.local` files (root, `apps/web`, `apps/api`) and `TEST-LOGINS.md` are gitignored and
transferred out-of-band — see `ENV-SETUP-GUIDE.md` if you need to know where they go, not how to
generate them.
