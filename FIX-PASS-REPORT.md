# Fonology — fix pass report

Covers all 9 items from the fix-pass prompt. **FEATURE-05 was intentionally stopped before any
migration was written** — its file list is below, waiting on confirmation, per your own explicit
instruction. Everything else is fixed and verified live. Project ref used throughout:
**`ohkvwqqtppvnxbvvdsfr`** (dev). Production (`sbqqpuqoizyjzdcydqid`) was never touched.

---

## Decisions received before starting

- **FEATURE-10**: link an existing booking (frontend-only) — not "create with no booking".
- **BUG-14**: exclude owners from the float popup — not "close as not-a-bug".

---

## 1. BUG-07/08/09 — the `waiting_approval → done` trap

**Fixed the actual cause, not a symptom.** `apps/web/src/lib/data/types/job.ts` had
`waiting_approval: ['in_progress', 'done', 'cancelled']` — but the database's own
`job_status_allowed_next()` only ever allowed `in_progress` or `cancelled` from there. The UI
was offering a "Done" button that the database rejected every single time. Removed `'done'`
from that list; it now matches the database exactly.

Added the missing move/cancel actions to the job **detail sheet**
(`apps/web/src/components/admin/jobs/job-sheet.tsx`) — it was read-only on purpose (an earlier,
broken version bypassed the evidence-gathering dialog entirely). Fixed correctly this time: the
sheet now calls the **same** `JobMoveDialog` the board already uses, via a shared `onMove`
callback threaded from `jobs-view.tsx` — one dialog instance, two trigger points, not a second
implementation.

**Did not touch FNL-10221's status**, per instructions.

**Verified live**: FNL-10221's board card and detail sheet both now show only "Move to On the
bench" + "Cancel" — no "Done" anywhere. Clicked "Move to On the bench" from the sheet and
confirmed it opens the real `JobMoveDialog` with its approval-evidence flow; closed without
submitting. Re-checked FNL-10221's `status`/`updated_at` in the database afterward — unchanged.

**Files:** `apps/web/src/lib/data/types/job.ts`, `apps/web/src/components/admin/jobs/job-sheet.tsx`, `apps/web/src/components/admin/jobs/jobs-view.tsx`

---

## 2. BUG-04 — low-stock alert leak

**Kept soft-delete** (confirmed correct again — `stock_movements.product_id` is `ON DELETE
RESTRICT`, so a hard delete is structurally impossible for any product with stock history).

**Pointed the dashboard at the existing correct endpoint** instead of patching the client-side
computation, as instructed. Built the missing chain to do it: `lowStockProductSchema` type,
`listLowStockProducts()` on both adapters, a `useLowStockProducts()` hook, wired into
`overview-view.tsx`.

**Found and fixed a second bug along the way while wiring this up**: the DB view
`low_stock_products` never excluded zero-stock products — only `is_active`/`low_stock_alert`.
The client's own canonical `productIsLowStock()` explicitly treats zero stock as "out of stock",
a separate state, never "low". Wiring the dashboard to the view as-is would have made a
zero-stock, alert-on product double-count across both dashboard tiles at once — a new bug, not
what was asked. **Migration 0037** adds `stock_qty > 0` to the view so it matches the client's
own definition exactly.

**Also fixed `outOfStock`** in the same file — same leak, same cause (computed from the
unfiltered full product list, never checking `isActive`). Not explicitly named in the brief, but
it's the identical bug in the same file; leaving it would have meant "fixing one leak while
leaving its twin in place."

**Endpoint swap — confirmed nothing else affected**: `GET /admin/products/low-stock` had zero
frontend callers before this (dead code) — grepped the whole repo to confirm. Nothing else's
behavior changed.

**Verified live**: seeded a real positive case (active, low-stock, alert-on product) and a real
negative case (identical but retired) using two of the existing "QA Test Product 1" rows.
Queried `low_stock_products` directly — exactly the active one appeared. Reloaded `/admin` —
dashboard showed "**1** low on stock", correctly excluding the retired one. Restored both test
products to their original state afterward.

**Files:** `supabase/migrations/0037_low_stock_excludes_zero_qty.sql` (+ applied to dev),
`apps/web/src/lib/data/types/inventory.ts`, `apps/web/src/lib/data/adapters/types.ts`,
`apps/web/src/lib/data/adapters/http.adapter.ts`, `apps/web/src/lib/data/adapters/mock.adapter.ts`,
`apps/web/src/lib/data/hooks/use-inventory.ts`, `apps/web/src/lib/data/hooks/index.ts`,
`apps/web/src/components/admin/overview/overview-view.tsx`,
`supabase/tests/009_reporting.sql` (2 new pgTAP assertions)

---

## 3. FEATURE-06 — In-Store Only toggle

Built exactly as scoped. **Migration 0038**: `products.in_store_only boolean not null default
false`, additive. Filtered out of the two customer-facing routes only
(`products.routes.ts`'s `GET /` and `GET /:slug`) — confirmed via the actual route code that
`GET /admin/products` (admin) and `GET /admin/products/barcode/:code` (POS scanner lookup) are
**entirely separate routes** that never apply this filter, so staff can always find and sell
these. Added the checkbox to `product-dialog.tsx`, same bordered-box pattern as the existing
`lowStockAlert`/`localBuying` toggles.

**Verified live, full round trip**: created a real in-store-only product via the actual admin
form. Confirmed via direct API calls: `GET /products?search=...` → empty (absent from storefront
search), `GET /products/:slug` → `null` (absent from the PDP route), `GET /admin/products` →
present with `inStoreOnly: true` correctly persisted. Retired the test product afterward
(couldn't hard-delete — it already has a `stock_movements` row from the create).

**Files:** `supabase/migrations/0038_product_in_store_only.sql` (+ applied to dev),
`apps/api/src/routes/products.routes.ts`, `apps/api/src/routes/admin.routes.ts`,
`apps/api/src/schemas.ts`, `apps/web/src/lib/data/types/inventory.ts`,
`apps/web/src/components/admin/inventory/product-dialog.tsx`

---

## 4. FEATURE-13 — Counter Sales view

New page at `/admin/sales` ("Counter Sales" in the Money nav group), reusing the exact
`DataTable`/`RangePicker`/tender-chip pattern already established by the Payments page, per
instructions not to introduce a new list pattern.

**Backend additions**: `staffId`/`staffName` now exposed on `GET /reports/transactions`
(previously missing despite the underlying view already carrying `staff_id`) — resolved via a
`staffNamesFor()` helper **extracted** from `pos.routes.ts` into a shared
`apps/api/src/lib/staffNames.ts` rather than duplicated, since `reports.routes.ts` needed the
identical lookup.

**Split-tender filtering, implemented as "any leg matches"**: a split cash/card till sale has no
single `tender` at the transactions-view level. Traced this precisely — it's specific to
`sales`-table rows; `orders`/`job_payments`/`trade_in_payouts`/`refunds` all already carry a real
single tender. For the ambiguous rows, the API now joins `sale_payments` and matches if **any**
leg used the requested tender. Also added a `tenders` array field so a split sale shows "Cash +
Card — POS 1" instead of a blank cell.

**A real bug caught before it shipped**: the query-key factory for `useTransactions()` only
included `from`/`to`, not the new `staffId`/`tender` filters. Two different filter combinations
for the same date range would have collided on one cache entry and silently served each other's
results. Fixed the key to include both.

"Counter sale" is defined as a `shop`-stream transaction with a staff id attached — `orders`
rows always carry `staff_id: null` (nobody rang it up), `sales` rows always carry the real
till operator. A refund a staff member processes stays visible (negative amount, "Refund" in
the description) rather than being filtered out.

**Verified live with real, pre-existing data**: found a genuine split-tender sale (FNL-10096,
cash + POS1) and its refund in dev. Confirmed the split renders as "Cash + Card — POS 1".
Filtered by "Card — POS 1" — only the split sale matched, the cash-only refund was correctly
excluded. Filtered by a different staff member — confirmed via the raw API response that
FNL-10096 was genuinely absent (my first check was a false alarm from the DataTable's own
"no matches" empty-state text echoing the search box, not a real row — caught and corrected).

**Files:** `apps/api/src/routes/reports.routes.ts`, `apps/api/src/schemas.ts`,
`apps/api/src/lib/staffNames.ts` (new), `apps/api/src/routes/pos.routes.ts` (helper extracted
out), `apps/web/src/lib/data/types/analytics.ts`, `apps/web/src/lib/data/types/finance.ts`,
`apps/web/src/lib/data/hooks/use-finance.ts`, `apps/web/src/lib/data/hooks/query-keys.ts`,
`apps/web/src/lib/data/adapters/types.ts`, `apps/web/src/lib/data/adapters/http.adapter.ts`,
`apps/web/src/lib/data/adapters/mock.adapter.ts`,
`apps/web/src/app/(dashboard)/admin/sales/page.tsx` (new),
`apps/web/src/components/admin/sales/sales-view.tsx` (new),
`apps/web/src/components/admin/admin-shell.tsx` (nav entry)

---

## 5. BUG-14 — float popup excludes owners

Straightforward on the surface — `!isOwner && !floatRecorded && dismissedOn !== today` — but
**this surfaced a genuine, separate race-condition bug that would have made the fix
unreliable**, worth reporting in full:

`session` is `undefined` while `useSession()` is still loading. The original logic treated that
as "not confirmed owner, safe to show" — and because the float-recorded check usually resolves
before the session check, there's a real window on every fresh load where the dialog opens for
a genuine owner before the session data arrives a few renders later. Once Radix has actually
opened a dialog, flipping the `open` prop back to `false` on a later render doesn't reliably
close it again in practice. Confirmed this exact behavior live, repeatedly, with console
diagnostics before fixing it. The fix doesn't fight Radix's close behavior — it gates `open` on
`session` having actually loaded, so the dialog is never told to open during that window in the
first place, the same way `floatRecorded` already conservatively defaults to "don't show" while
its own query is loading.

**Also traced down a false alarm along the way**: while investigating, I hit a Turbopack dev
build serving genuinely stale chunks (`ReferenceError: idSchema is not defined`,
`ReferenceError: Wallet is not defined`) despite both being correctly present in source and
`tsc --noEmit` passing clean. A full dev-server restart with `.next` cleared resolved it — not a
code defect, but flagging it since it cost real verification time and could confuse anyone else
hitting the same thing mid-session.

**Verified live, both directions, repeatedly**: three fresh navigations as owner (with
`floatRecorded` and the dismissal state both genuinely reset, not just already-satisfied by
earlier testing) — correctly hidden every time. Signed in as `staff@fonology.test` — the popup
still correctly shows at `/pos` (employees are the ones actually asked to count the float; this
confirms the exclusion is scoped to owners specifically, not broken for everyone).

**Files:** `apps/web/src/components/admin/float-prompt.tsx`

---

## 6. BUG-03 — the confirmed, separate fix

**The ~20-minute timing itself remains unconfirmed** — still no way to read the dev project's
real Auth JWT expiry (no MCP tool exposes it, and it's a control-plane setting, not something
`execute_sql` can reach), and no PIN exists anywhere to run the actual timed test. Not
guessed at; this needs the Supabase Dashboard checked directly by someone with access, or a
willing tester with a known PIN.

**Did fix the confirmed, separate bug**: `pin-lock.tsx` showed the identical "That PIN wasn't
right" for a wrong PIN, an unset PIN, _and_ a session that had simply expired — because
`requireStaff` refuses the unlock request itself (401, before the PIN is even checked) with the
same status code a wrong PIN gets. Distinguished by the **error message text**, not status code
(both are 401): `requireStaff`'s exact refusal text now triggers a distinct "Your session timed
out — sign in again" state with a real way out (a link to `/staff-login`), instead of inviting
more PIN guesses against a session that was never going to accept any of them. The
wrong-PIN-vs-unset-PIN non-distinction stays exactly as deliberately designed — untouched.

One small architectural note: this required importing `ApiError` into a component. It's defined
in `http.adapter.ts` (a concrete adapter), and this codebase's own `adapters/index.ts` states
"nothing else in the app imports a concrete adapter." Re-exported `ApiError` through the neutral
`adapters/index.ts` barrel instead of reaching into `http.adapter.ts` directly from the
component — keeps the boundary intact.

**Not live-tested** (no PIN, as above) — verified via typecheck, lint, and a full manual
re-read of the resulting JSX for balance/correctness after catching and fixing an unbalanced
`</div>` I introduced partway through.

**Files:** `apps/web/src/components/admin/pin-lock.tsx`, `apps/web/src/lib/data/adapters/index.ts`

---

## 7. FEATURE-10 — link a booking to a mail-in job

Per your decision: frontend-only, no backend change. The API already fully supported
`bookingId` (`jobCreateBodySchema` already had it, `POST /jobs` already enforced "mail-in
requires a bookingId") — the gap was entirely on the frontend: `jobInputSchema` didn't carry
the field, and the dialog never offered a choice.

Added a Walk-in/Mail-in toggle to `add-job-dialog.tsx`. Picking Mail-in shows a booking picker,
filtered to bookings that are **not already linked to a job** (cross-referenced against
`useJobs()` — a booking already claimed would otherwise silently offer a second job for the
same device) and not `cancelled`/`dispatched`. Selecting a booking auto-fills customer name,
phone, email, resolved device+repair description, and the quoted price from it — still editable,
since staff may know more once the device is actually in hand. `problemDescription` is always
typed fresh; a booking doesn't carry a "what's wrong" field distinct from the repair type.

**Verified live, full round trip**: opened the dialog, switched to Mail-in, confirmed the picker
listed a real unlinked booking and correctly excluded one that already had a job. Selected it,
confirmed every field auto-filled with the booking's real data. Submitted — a real job
(`FNL-10298`) was created with `source: 'mail_in'` and the correct `booking_id`, confirmed
directly against the database.

**Files:** `apps/web/src/lib/data/types/job.ts`, `apps/web/src/components/admin/jobs/add-job-dialog.tsx`

---

## 8. FEATURE-05 — STOPPED, per instructions. Confirm before I write anything.

**Confirmed, not assumed**: `products.category` is a native Postgres enum type
(`product_category`), no table behind it anywhere. `information_schema.tables` has nothing
category-shaped at all. This is a real schema change, not a UI addition.

**Every place I found that assumes the fixed 7-value set:**

**Database (3 places):**

- `products.category` — the column itself (`0003_catalog.sql`)
- `restock_trade_in(p_category product_category, ...)` — the "add to stock" function a
  trade-in payout uses (`0007_sell.sql`)
- `revenue_by_category(...)` returns `table (category product_category, ...)` — the Reports
  "What sells" breakdown (`0010_views.sql`)

**API (2 separate hardcoded enums, not one):**

- `apps/api/src/schemas.ts` — `productCategoryEnum` (product create/edit), and a **second,
  independent** literal `z.enum([...])` for the restock body schema (same 7 values, written out
  twice)
- `apps/api/src/lib/productMapping.ts` — `artForCategory()`, the category → placeholder-art
  mapping used by both customer and admin product responses
- `apps/api/src/routes/reports.routes.ts` — `CATEGORY_LABELS`, used for the revenue-by-category
  report's display labels

**Frontend types (4 files):**

- `apps/web/src/lib/data/types/product.ts` — `productCategoryIdSchema` itself, the canonical
  definition everything else imports
- `apps/web/src/lib/data/types/inventory.ts` — `AdminProduct`/`productInputSchema`
- `apps/web/src/lib/data/types/analytics.ts` — the revenue-by-category summary shape
- `apps/web/src/lib/data/types/finance.ts` — **a third, independent** hardcoded literal
  `z.enum([...])` specifically for `restockInputSchema` (the trade-in restock form), not reusing
  `productCategoryIdSchema` at all

**Frontend UI (3 places with literal category options, not data-driven):**

- `apps/web/src/components/admin/inventory/product-dialog.tsx` — `CATEGORY_OPTIONS`, the
  product create/edit dropdown
- `apps/web/src/components/admin/tradeins/tradein-detail-view.tsx` — the restock dialog's
  category `<select>`, hardcoded `<option>` tags (`RestockControl`)
- The storefront's own category tabs (`shop-catalog.tsx`) are **already correctly data-driven**
  via `useCategories()` — this one needs no change, just a new data source once the table exists

**Mock data**: `apps/web/src/lib/data/mock/products.ts` has ~15+ literal `category: 'x'` values.
Secondary concern — mock mode is already a disconnected demo dataset for every other
admin-editable field too (confirmed while checking this), not something this migration
needs to fix to ship, but worth knowing it'll need updating for mock-mode consistency
eventually.

**My honest read**: a real `categories` table with `parent_id` self-reference is the only way to
satisfy "create/edit/delete categories from the UI" — Postgres enums can't be edited at runtime
by design, confirmed by this project's own 0012 migration needing its own transaction just to
_add_ one value. I don't see a smaller-scope way to do this that actually delivers what's being
asked. **This is genuinely the largest, riskiest item in the whole pass** — 12 files across 3
layers, plus a backfill that has to not silently reassign anyone's existing category. Ready to
proceed on your confirmation of this list (or a corrected one).

---

## Verification summary

- `tsc --noEmit`: clean, both apps, run after every item and again at the end
- Lint: clean, both apps (`next lint` / `eslint --max-warnings 0`), run after every item and
  again at the end
- pgTAP: **enabled on dev** (wasn't installed at all — `create extension pgtap`, purely
  additive, standard Supabase extension) since running it was an explicit hard rule and the
  capability didn't exist yet. Ran `009_reporting.sql` in full, in a transaction that was
  never committed (confirmed zero fixture rows leaked into dev afterward) — **19/19 pass**,
  including 2 new assertions added specifically for the 0037 migration (zero-stock excluded,
  retired excluded)
- Every fix verified in the real running app — real clicks where the browser tooling cooperated,
  direct API/DB verification as a supplement (and occasionally as the primary check) where it
  didn't, always cross-checked against the actual database state, never just "the UI looked
  right"

## Things I'd flag

- **BUG-14's race condition** is the one I'd most want you to know about distinctly from the
  one-line description — it's the kind of bug that would have made the fix intermittently
  "not work" in exactly the confusing way that gets misreported as a flaky UI issue rather than
  a real, fixable root cause.
- **FEATURE-13's split-tender handling** exists because I traced through what "filter by
  payment type" actually meant at the data level rather than building the naive version — the
  existing Payments page's own tender filter has this exact gap already (a split-tender sale
  never matches any tender chip there, silently). Didn't touch Payments itself — out of scope
  for this pass — but flagging it since it's a real, live gap in a page nobody asked me to look
  at, found only because I had to understand the same data to build Counter Sales correctly.
- **The dead-code duplication in FEATURE-05's scan** — three separate hardcoded 7-value
  category enums that never shared a definition — is worth someone's attention even independent
  of whether the enum→table migration happens; it's the kind of drift where fixing the "real"
  enum and forgetting the other two silently reintroduces bugs like the ones this whole pass has
  been fixing.
