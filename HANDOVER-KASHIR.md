# Handover to Kashir — deployment

**Everything on the frontend and API side is done. This is what you need to put it live.**

State as of commit `8a2033e` on `main`, 16 August 2026. Every number and path below was checked
against the repo, not copied from an older document.

Read this with [`HANDOVER-PRINTING.md`](HANDOVER-PRINTING.md), which owns the print agent and the
till PC. The two do not overlap and do not contradict each other.

---

## 1. What you are deploying

```
apps/web          Next.js 15 App Router. Storefront + admin + POS. output: 'standalone'
apps/api          Express + TypeScript. Holds the service-role key. 13 route files
apps/print-agent  Runs INSIDE the shop on the till PC — see HANDOVER-PRINTING.md
supabase          36 migrations, 26 pgTAP files, 395 assertions
```

Turborepo + pnpm workspaces. Target is a **self-hosted VPS via Docker / Coolify — not Vercel**.

**Built and wired to the real API:** the full storefront (catalogue, cart, checkout with
server-quoted delivery, repair booking, sell/trade-in, order and repair tracking, legal pages,
customer auth including Google OAuth); the full admin (dashboard, orders, inventory, jobs board,
promotions, cash, day-close, payments, reports, returns, staff, trade-ins, labels designer,
settings, printing); and the POS (till checkout with split payments, jobs, inventory, cash,
day-close, trade-ins, promotions, barcode scanner, PIN lock).

Auth is Supabase Auth over httpOnly cookies. Staff and customers are distinct identities.
Permissions are **per person** from `staff_permissions` and enforced server-side on every route —
`staff.role` is a display label that enforcement never reads. The frontend's `can()` only decides
what to _show_.

---

## 2. Read this before your first build — it will bite you

**The web build fails unless the API is reachable.** `apps/web/src/app/(storefront)/shop/[slug]/page.tsx`
exports `generateStaticParams()`, which calls `dataAdapter.listProducts()` to pre-render one static
page per product. With the API down the build dies at "Collecting page data" with:

```
[TypeError: fetch failed] [cause]: [AggregateError: ] { code: 'ECONNREFUSED' }
[Error: Failed to collect page data for /shop/[slug]]
```

This is not a code fault and not a regression — it is what `dynamicParams = false` plus a static
catalogue means. **Consequence for Coolify: the API must be up and `NEXT_PUBLIC_API_BASE_URL` must
point at it before the web container builds.** If you build both from a clean stack in parallel,
web loses the race and fails. Deploy the API first, confirm it answers, then build web.

---

## 3. Deployment sequence

### 3.1 Database first

Production has had **nothing** applied — no migrations, no data.

1. Apply **0001 → 0036 in order**. Do not skip or apply selectively: several migrations depend on
   enum values or functions added by earlier ones, and `0012` is its own file specifically because
   Postgres will not let a new enum value be referenced in the same transaction that adds it.
   The highest file is `0036_printer_codepage_candidates.sql` — count the files, don't trust a
   remembered number.
2. Seed the shop's real settings. `0034_real_shop_details.sql` does this, guarded on
   `shop_address is null`, so it applies cleanly to a fresh database.
3. Verify:
   ```sql
   select count(*) from public.refunds where reference is null;  -- must be 0
   select shop_address, shop_phone, opening_hours from public.shop_settings;  -- real values
   ```

**Migrations are additive only, and a migration is frozen once committed and pushed** — not once
run against dev. The rule and the incident behind it are in
[`supabase/migrations/README.md`](supabase/migrations/README.md).

### 3.2 Secrets and config

`apps/api/.env.example` documents every variable. The ones that matter:

- Supabase service-role key — **API only, never in the web app**
- `NEXT_PUBLIC_SUPABASE_URL` and the publishable key
- `NEXT_PUBLIC_API_BASE_URL` → the production API
- `NEXT_PUBLIC_DATA_SOURCE=http` ← if this is wrong the whole app silently runs on mock data
- `BREVO_API_KEY`; sender defaults to `info@fonology.co.uk`
- Stripe keys when they arrive

### 3.3 The two things that fail silently

**Google OAuth redirect URI is per project and must be redone for production.** Dev's does not
carry over. When it is wrong, sign-in fails in a way that looks like a frontend bug, and the error
surfaces on Supabase's own domain rather than yours.

**Storage bucket policies must be reapplied.** Migration `0011` creates them — confirm they are
actually in place on production. ID document uploads are the customer-data path, and a permissive
bucket is the worst version of that.

### 3.4 Scheduled jobs — written, but nothing runs them

Both scripts exist and neither runs on its own. Wire each to cron or a Coolify scheduled task and
**confirm it has fired once**:

- `apps/api/scripts/purge-documents.ts` — ID documents, 30 days. This is a data-protection
  commitment **already printed in customer-facing page copy**. A promise nothing keeps is worse
  than no promise.
- `apps/api/scripts/purge-print-jobs.ts` — print payloads, 7 days, contains customer PII.

### 3.5 Generate the database types

Do this before you take ownership, not after:

```bash
npx supabase gen types typescript --local > apps/api/src/types/database.ts
```

then thread the type through `supabaseAdmin`. It is currently constructed **without** generated
types, so every `.select()` returns `any`. That is the single root cause of the **461 suppressed
lint findings** documented in `apps/api/.eslintrc.cjs`, and of the schema-mismatch bug class that
has cost this project the most time. Most of the 461 disappear; the rest become real findings
worth reading.

### 3.6 Verify after deploying

- `apps/api/scripts/e2e-test.ts` — 55 checks, signup through day-close reconciliation
- `apps/api/scripts/schema-audit.ts` — signs in, calls every endpoint, and parses the real response
  through the frontend's own Zod schemas. Needs `AUDIT_STAFF_EMAIL` / `AUDIT_STAFF_PASSWORD` in
  `apps/api/.env.local`.

---

## 4. Environments

|                | Project ref            | State                                                            |
| -------------- | ---------------------- | ---------------------------------------------------------------- |
| **Dev**        | `ohkvwqqtppvnxbvvdsfr` | All migrations applied. Seeded. Everything has been tested here. |
| **Production** | `sbqqpuqoizyjzdcydqid` | **Paused, nothing applied.** No migrations, no data.             |

⚠️ **The Supabase MCP connector is org-wide.** Production is reachable through it, and Supabase
**auto-resumes a paused project on connection** — the pause is _not_ a safety boundary. This
project has already had one session mistake production for a test database. **State the project ref
before every write.**

The site is not deployed. `fonology.co.uk` currently serves the client's old site.

---

## 5. Hard rules that must survive deployment

Break any one of these and something goes wrong with money, permissions or customer data.

1. **All money is integer pence.** Pounds exist only at the display layer.
2. **The server computes every money figure. Never trust a client-supplied amount.** The till sends
   line ids and quantities; the server prices them.
3. **Staff attribution comes from the session, never the request body.**
4. **References come only from `issue_reference()`.** Never generate one anywhere else.
5. **No VAT anywhere.** The business is not VAT registered — no column, no calculation, no label.
   `supabase/tests/001_structure.sql` enforces this schema-wide.
6. **Customers never see stock counts, cost or margin** — only in-stock / out-of-stock / restocking.
7. **Below-cost sales warn, never block.** Fixed by migration `0008`, not configurable.
8. **`shop_settings` is the single source for shop facts** — address, phone, hours, returns window.
   There were once five hardcoded copies including the JSON-LD that Google reads. Don't reintroduce
   one: a hardcoded number here is a promise the shop can be held to that the software will not
   keep.
9. **Frontend Zod schemas match the REAL API response**, not the mock's echo. Run the schema audit
   after any endpoint or schema change.

---

## 6. Not built, by decision — so you don't go looking

- **Online payment.** There is no Stripe integration. `POST /orders/:reference/paid` is a
  **stand-in webhook gated by `requireStaff`** — a placeholder, not security. It needs real
  signature verification before it takes money. See `HANDOVER-PRINTING.md` §9.3.
- **Card machines are manual-entry, by client decision.** They have no API; staff type the amount
  in. `card-machine.ts` records which machine and which slip reference. This is the agreed design,
  not a gap.
- **The label designer has no backend.** `listLabelTemplates` / `saveLabelTemplate` /
  `deleteLabelTemplate` are unimplemented and no API route touches `label_templates`. The designer
  works against mock data only.
- **Customer reviews are static marketing copy.** There is no reviews table. Needs a client
  decision before anyone builds one.
- **`updateJob` is deliberately unimplemented.** Job moves go through explicit transition endpoints
  (`POST /jobs/:id/status`, `/parts`) so each move carries its evidence. Don't "fix" it.

---

## 7. Open client questions — each blocks something

None are code problems.

1. **Clearpay — yes or no.** A toggle in the Stripe dashboard, not a separate integration.
2. **Payout receipt legal wording.** Does a trade-in payout receipt need an ownership /
   right-to-sell declaration? Second-hand device purchase in the UK carries real obligations, so
   the wording was deliberately not drafted on a guess.
3. **Social media URLs** — `SOCIALS` in `lib/site.ts` still points every link at `#`.
4. **The legal footer line.** It reads "© 2026 Fonology Ltd". The client confirmed the trading name
   is **Fonology**, but that is not necessarily the right registered entity for a copyright notice.
5. **Customer reviews** — real or permanently static.
6. **The receipt photograph / format** — `CONTENT-TODO.md` still has this coming from the client.
7. **Page copy** for `/terms`, `/privacy`, `/returns-policy`, `/shipping`, `/cookies`, `/about`,
   `/faq` — all still placeholders.
8. **Product photos** are placeholders, not wired to any asset pipeline.

---

## 8. Known issues carried forward

- **`/admin/returns` freeze** — reported once, then not reproducible across a full end-to-end drive
  with a clean server and session. Treat as _currently unreproducible, not fixed_. If it recurs,
  the next lead is the admin-shell `setInterval`, then a bisection of the counter-sale branch.
- **`/admin/returns` form** shows raw Zod validation errors as visible text when a required field is
  missing, instead of a formatted message.
- **`float-prompt.tsx` and `cash-view.tsx` call `useSettings()`**, which needs `settings.manage` — a
  permission counter staff do not hold. `float-prompt` therefore always shows the hardcoded £150
  default rather than the owner's configured float target, for exactly the people who open the till
  each morning. `floatTarget` was deliberately kept out of the public `/shop` endpoint (it is how
  much cash is in the till), so fixing it needs a staff-scoped read, not a one-liner.
- **The dashboard lock screen has two independent layers** — a client one in localStorage and a
  server one on `staff_sessions`. They look identical on screen and checking one proves nothing
  about the other. Full detail in `HANDOVER-PRINTING.md` §8.
- **Shelf labels need a barcode.** `inventory-view.tsx:294` renders the print button only when the
  product has one, so a barcode-less product has no way to print a shelf label from the table.

---

## 9. Quality gates

Last run against `main`:

| Gate         | Result                                                        |
| ------------ | ------------------------------------------------------------- |
| pgTAP        | 26 files, **395 assertions, all passing**                     |
| Typecheck    | **3 / 3 packages clean**                                      |
| Lint         | **3 / 3 packages clean** (461 findings suppressed — see §3.5) |
| Schema audit | **HARD 0 · SILENT 1 · EMPTY 1 · OK 29**                       |

The one SILENT is pre-existing and understood: `sellRequestPageSchema` declares an optional field
the API never sends. It is not a drift bug.

pgTAP runs against the local Docker stack only, never a hosted project:

```bash
npx supabase start -x realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,mailpit
npx supabase test db
```

The `-x` list is required — those containers fail health checks and roll the whole start back.
**`supabase db reset` has hung twice**; applying migration files directly with `psql` is the
reliable path.

---

## 10. Which documents to trust

| Document                                                                                                               | Status                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This file**                                                                                                          | **Current.** Deployment.                                                                                                                                  |
| **`HANDOVER-PRINTING.md`**                                                                                             | **Current.** Print system + its own deployment checklist (§9).                                                                                            |
| `HANDOVER-PROJECT.md`                                                                                                  | **Current**, and broader than this file — architecture and reasoning.                                                                                     |
| `supabase/migrations/README.md`                                                                                        | Current, includes the frozen-on-push rule.                                                                                                                |
| `SETUP.md`, `HOW-TO-RUN.md`, `README.md`                                                                               | Current.                                                                                                                                                  |
| `INTEGRATION.md`                                                                                                       | **Historical.** Written before the API existed. Good contract tables, misleading on status.                                                               |
| `HANDOVER-FRONTEND.md`                                                                                                 | **Stale.** Its five "screens to build" all exist. Its §7 links to `TEST-LOGINS.md`, which is **not in the repo** — it only ever existed pasted into chat. |
| `NOTES.md`, `BACKEND-INPUTS.md`, `REQUIREMENTS-AUDIT.md`, `SCHEMA-CONTEXT.md`, `QUESTION-TRIAGE.md`, `CONTENT-TODO.md` | Build-time working notes. Accurate when written, not maintained.                                                                                          |

**If a document and the repo disagree, the repo is right.** That includes this one. Several claims
in earlier handover notes were wrong when checked — always verify a count by counting.
