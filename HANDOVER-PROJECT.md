# Handover — the whole project, for Kashir

You own the backend and you're moving to deployment. This is the state of the entire system as
of the current `main`, so you're not deploying from an out-of-date picture.

**Printing has its own document.** [`HANDOVER-PRINTING.md`](HANDOVER-PRINTING.md) covers the
print agent, the queue, and a ten-group pre-deployment checklist. Everything here is the rest of
the system. The two are meant to be read together; the deployment checklist in §9 of the
printing doc is not repeated here, and the two do not contradict each other.

Every claim below was checked against the repo while writing it. Where a doc in this repo says
something different, that's called out in §10 — several of them are stale.

---

## 1. Architecture in one screen

```
apps/web          Next.js 15 App Router. Storefront + admin + POS. output: 'standalone'
apps/api          Express + TypeScript. Holds the service-role key. 13 route files
apps/print-agent  Runs INSIDE the shop on the till PC. See HANDOVER-PRINTING.md
supabase          35 migrations, 26 pgTAP files, 395 assertions
```

Turborepo + pnpm workspaces. Deploy target is a **self-hosted VPS via Docker / Coolify — not
Vercel**.

**The one rule that shapes the frontend:** no component calls `fetch()` directly. Everything
goes through a `DataAdapter` (`apps/web/src/lib/data/adapters/`), of which there are two — `mock`
and `http` — selected by `NEXT_PUBLIC_DATA_SOURCE`. Components use TanStack Query hooks, hooks
call the adapter, the adapter validates every response with Zod at the boundary.

That's why `apps/api/scripts/schema-audit.ts` exists: it signs in, calls every endpoint, and
parses the real response through the frontend's own schemas. It catches the drift class where
the API sends a field the schema silently strips.

---

## 2. What is built and connected to the real backend

Verified present in the repo, not taken from a doc:

**Storefront** — shop catalogue, product pages, cart, checkout (server-quoted delivery from
`delivery_rates`, never a client figure), repair booking wizard, sell/trade-in wizard, order and
repair tracking by reference + email, legal pages, customer auth including Google OAuth.

**Admin** — dashboard, orders, inventory, jobs board, promotions, cash, day-close, payments,
reports, returns, staff, trade-ins (queue + payouts), labels designer, settings, and
`/admin/printing`.

**POS** — till checkout with split payments, jobs, inventory, cash, day-close, trade-ins,
promotions, barcode scanner support, PIN lock.

**Auth** — Supabase Auth via httpOnly cookies. Staff and customers are distinct. Permissions are
per-person from `staff_permissions`, enforced server-side on every route; the frontend's
`can()` only decides what to _show_.

### The five screens `HANDOVER-FRONTEND.md` lists as unbuilt are all built

That document is stale on its central claim. Day-close, PIN lock, the jobs board, trade-ins and
promotions all exist, and `jobStatusSchema` is the real 7-value enum
(`new / in_progress / waiting_approval / done / sent_back / collected / cancelled`), not the old
4-value one. Don't plan work off §2 of that file.

---

## 3. What is NOT wired — read this before deploying

These are the gaps that matter for a live shop. Each is a thing that works in mock mode and
fails against the real API.

### 3.1 The storefront "Sell your phone" flow cannot submit — BLOCKER

`createSellRequest` in `apps/web/src/lib/data/adapters/http.adapter.ts:209` throws
`notImplemented`. The storefront wizard (`components/storefront/sell/sell-flow.tsx`) calls it
through `useCreateSellRequest`.

**The API endpoint exists** — `POST /sell/requests` in `apps/api/src/routes/sell.routes.ts:55`,
public, already written. Only the adapter method is missing.

So: a customer completes the whole three-step sell wizard and the submit throws. In mock mode it
works perfectly, which is exactly why it hasn't been noticed. **This is a customer-facing flow
that is advertised in the main nav.** It needs wiring before launch, and it is a small job —
the endpoint, the Zod schema and the hook all exist.

### 3.2 Nothing on the till enqueues a print job

No screen calls `enqueuePrintJob` — confirmed, zero call sites in any `.tsx`. The adapter
method, hook, types, queue, agent and admin screen all exist; only the buttons are missing.
Sale completion, the jobs board and inventory each need one. See `HANDOVER-PRINTING.md` §9.8.

### 3.3 The label designer has no backend

`listLabelTemplates`, `saveLabelTemplate`, `deleteLabelTemplate` are all `notImplemented`. No API
route touches `label_templates`, and `linked_product_id` — added in migration 0009 specifically
so a template could pull a real product's barcode — is referenced nowhere in either app. The
designer works against the mock adapter only.

### 3.4 Customer reviews are static marketing copy

`listReviews` is `notImplemented` and there is no reviews table. The storefront and the auth
panel show hardcoded review content. **Decide with the client whether these become real
user-submitted reviews or stay permanently static** before anyone builds a table.

### 3.5 Online payment is not built at all

There is no Stripe integration. `POST /orders/:id/paid` is a **stand-in webhook gated by
`requireStaff`** — a placeholder, not security. See `HANDOVER-PRINTING.md` §9.3, which has the
detail including the signature-verification requirement and the deferred
`payment_provider_events` question.

Note the card machines in the shop are **manual-entry by client decision** — they have no API and
the staff type the amount in. That is not a gap; it's the agreed design, and `card-machine.ts`
records which machine and which slip reference.

### 3.6 `updateJob` is deliberately unimplemented — not a gap

`updateJob` throws `notImplemented`, but that is intentional: job moves go through explicit
transition endpoints (`POST /jobs/:id/status`, `/parts`, etc.) so each move carries its evidence.
`useUpdateJob` is legacy. Don't "fix" it.

---

## 4. The database

35 migrations, additive only. **A migration is frozen once committed and pushed** — not once run
against dev. Before that it has touched one database, that database is dev, and correcting the
file leaves file and database in agreement. After it's pushed, someone else may have applied it.
The rule and the incident that produced it are written into
[`supabase/migrations/README.md`](supabase/migrations/README.md).

**pgTAP: 395 assertions across 26 files, all passing.** It runs against the local Docker stack
only, never a hosted project:

```bash
npx supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit
npx supabase test db
```

The `-x` list is required on the machine this was built on — those containers fail health checks
and roll the whole start back. **`supabase db reset` has hung twice**; applying migration files
directly with `psql` is the reliable path.

Tests worth knowing about because they encode decisions rather than mechanics:

- `001_structure.sql` asserts **every foreign key column has a covering index**, schema-wide. It
  catches new tables that forget one — it caught four in the print queue.
- `025_print_queue.sql` protects the receipt/label asymmetry (see the printing doc).
- `026_refund_reference.sql` test 4 asserts two refunds against one sale get **different**
  references. If someone simplifies the trigger into copying the sale's reference, that fails.

---

## 5. Standing rules — these are load-bearing

Broken any one of these and something goes wrong with money, permissions or a customer's data.

1. **All money is integer pence.** Pounds exist only at the display layer.
2. **The server computes every money figure. Never trust a client-supplied amount.** The till
   sends line ids and quantities; the server prices them.
3. **Staff attribution comes from the session, never the request body.**
4. **References come only from `issue_reference()`.** Never generate one anywhere else.
5. **No VAT anywhere.** The business is not VAT registered — no column, no calculation, no label.
6. **Customers never see stock counts, cost or margin** — only in-stock / out-of-stock /
   restocking. On the shelf-label path this is enforced upstream: the query never loads
   `cost_price` or `stock_qty`, so no renderer can leak them by forgetting.
7. **Below-cost sales never block.** Fixed by migration 0008, not configurable. The flag that
   could have contradicted it was deleted.
8. **`shop_settings` is the single source for shop facts.** Address, phone, hours, returns
   window. There were once five hardcoded copies including the JSON-LD Google reads; they're
   gone. Don't reintroduce one.
9. **Frontend Zod schemas match the REAL API response**, not the mock's echo. Run the schema
   audit after any endpoint or schema change.

---

## 6. Environments

|                | Project ref            | State                                                                        |
| -------------- | ---------------------- | ---------------------------------------------------------------------------- |
| **Dev**        | `ohkvwqqtppvnxbvvdsfr` | All 35 migrations applied. Seeded. This is where everything has been tested. |
| **Production** | `sbqqpuqoizyjzdcydqid` | **Paused, and has had NOTHING applied.** No migrations, no data.             |

⚠️ **The Supabase MCP connector is org-wide.** Production is reachable through it, and Supabase
**auto-resumes a paused project on connection** — so the pause is _not_ a safety boundary. This
project has already had one session mistake production for a test database. State the project ref
before every write.

The site is **not deployed**. `fonology.co.uk` currently serves the client's old site.

---

## 7. Deployment sequence

The printing-specific items are in `HANDOVER-PRINTING.md` §9. This is the rest, in the order it
has to happen.

### 7.1 Database first

1. Apply **0001 → 0035 in order** to the production project. It has never had any of them. Do
   not skip ahead or apply selectively — several migrations depend on enum values or functions
   added by earlier ones, and 0012 exists as its own file specifically because Postgres won't let
   a new enum value be referenced in the same transaction it's added in.
2. Seed the shop's real settings. `0034` does this guarded on `shop_address is null`, so it will
   apply cleanly to a fresh database.
3. Verify: `select count(*) from public.refunds where reference is null` returns 0, and
   `shop_settings` has the real address and hours.

### 7.2 Secrets and config

- Supabase service-role key (API only — never in the web app)
- `NEXT_PUBLIC_SUPABASE_URL` / publishable key
- `NEXT_PUBLIC_API_BASE_URL` → the production API
- `NEXT_PUBLIC_DATA_SOURCE=http`
- `BREVO_API_KEY`; sender defaults to `info@fonology.co.uk`
- Stripe keys when they arrive

`apps/api/.env.example` documents every variable.

### 7.3 The two things that fail silently

**Google OAuth redirect URI is per-project and must be redone for production.** Dev's does not
carry over. When it's wrong, sign-in fails in a way that looks like a frontend bug, and the
error surfaces on Supabase's own domain rather than yours.

**Storage bucket policies must be reapplied.** Migration 0011 creates them; confirm they're
actually in place on production, because ID document uploads are the customer-data path and a
permissive bucket is the worst version of that.

### 7.4 Scheduled jobs — currently scripts with no scheduler

Both are written. **Neither runs on its own.** Wire each to cron or a Coolify scheduled task and
confirm it has fired once:

- `apps/api/scripts/purge-documents.ts` — ID documents, 30 days. **This is a data-protection
  commitment already printed in customer-facing page copy.** A promise nothing keeps is worse
  than no promise.
- `apps/api/scripts/purge-print-jobs.ts` — print payloads, 7 days, contains customer PII.

### 7.5 Do this before handing over, not after

```bash
npx supabase gen types typescript --local > apps/api/src/types/database.ts
```

then thread the type through `supabaseAdmin`. It is currently constructed **without** generated
types, so every `.select()` returns `any` and it spreads. That is the single root cause of **461
suppressed lint findings** (documented in `apps/api/.eslintrc.cjs`) and of the schema-mismatch
bug class that has bitten this project repeatedly. Most of the 461 vanish; the rest become real
findings worth reading.

### 7.6 Verify after deploying

- `apps/api/scripts/e2e-test.ts` — 55 checks, signup through day-close reconciliation
- `apps/api/scripts/schema-audit.ts` — needs `AUDIT_STAFF_EMAIL` / `AUDIT_STAFF_PASSWORD` in
  `apps/api/.env.local`. Last run: **HARD 0 · SILENT 1 · EMPTY 1 · OK 29**. The one SILENT is
  pre-existing and unrelated (`sellRequestPageSchema` declares an optional field the API never
  sends)

---

## 8. Open client questions

None of these are code problems. All of them block something.

1. **Clearpay — yes or no.** It's a toggle in the Stripe dashboard, not a separate integration.
2. **Payout receipt legal wording.** Does a trade-in payout receipt need an ownership /
   right-to-sell declaration? Second-hand device purchase in the UK carries real obligations, so
   wording was deliberately not drafted on a guess.
3. **Social media URLs** — `SOCIALS` in `lib/site.ts` still points every link at `#`.
4. **The legal footer line.** It says "© 2026 Fonology Ltd". The client confirmed the trading
   name is **Fonology**, not "Zakaso Limited T/A Fonology" — but neither is necessarily the right
   registered entity for a copyright notice.
5. **Customer reviews** — real or permanently static (§3.4).
6. **The receipt photograph.** `CONTENT-TODO.md` still says the format comes from the client.
7. **Page copy** for `/terms`, `/privacy`, `/returns-policy`, `/shipping`, `/cookies`, `/about`,
   `/faq` — all still placeholders.
8. **Product photos** are placeholders, not wired to any asset pipeline.

---

## 9. Known issues carried forward

- **`/admin/returns` freeze** — reported, then not reproducible across a full end-to-end drive
  with a clean server and session. Treat as _currently unreproducible, not fixed_. If it recurs,
  the next lead is the admin-shell `setInterval`, then a real bisection of the counter-sale
  branch.
- **`/admin/returns` form** shows raw Zod validation errors as visible text when a required field
  is missing, instead of a formatted message.
- **`float-prompt.tsx` and `cash-view.tsx` call `useSettings()`**, which needs `settings.manage`
  — a permission counter staff do not hold. `float-prompt` therefore always shows the hardcoded
  £150 default rather than the owner's configured float target, for exactly the people who open
  the till each morning. `floatTarget` was deliberately kept out of the public `/shop` endpoint
  (it's how much cash is in the till), so fixing this needs a staff-scoped read, not a
  one-liner.

---

## 10. Which documents to trust

| Document                                                                                                               | Status                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`HANDOVER-PRINTING.md`**                                                                                             | **Current.** The print system + its deployment checklist.                                                                                                                                                                          |
| **This file**                                                                                                          | **Current.**                                                                                                                                                                                                                       |
| `supabase/migrations/README.md`                                                                                        | Current to 0035, includes the frozen-on-push rule.                                                                                                                                                                                 |
| `SETUP.md`                                                                                                             | Current. Project refs, env files, how a migration reaches a database.                                                                                                                                                              |
| `HOW-TO-RUN.md`                                                                                                        | Current.                                                                                                                                                                                                                           |
| `README.md`                                                                                                            | Current. Names Coolify + `output: 'standalone'`.                                                                                                                                                                                   |
| `INTEGRATION.md`                                                                                                       | **Historical.** Written when the API didn't exist; describes filling in a scaffold that is now mostly filled. Useful for the contract tables, misleading on status.                                                                |
| `HANDOVER-FRONTEND.md`                                                                                                 | **Stale.** Its five "screens to build" all exist (§2). Its §7 links to `TEST-LOGINS.md`, which **is not in the repo** — it only ever existed pasted into chat. §3 (the returns freeze) and §6 (client questions) are still useful. |
| `NOTES.md`, `BACKEND-INPUTS.md`, `REQUIREMENTS-AUDIT.md`, `SCHEMA-CONTEXT.md`, `QUESTION-TRIAGE.md`, `CONTENT-TODO.md` | Build-time working documents. Accurate when written; not maintained. Read for reasoning, verify against the repo before acting.                                                                                                    |

**If a document and the repo disagree, the repo is right.** Three claims in incoming handover
notes were wrong when checked: order tracking was described as unwired (it is wired, end to end),
the migrations README as 19 versions stale (it was current), and the five frontend screens as
unbuilt (all five exist).
