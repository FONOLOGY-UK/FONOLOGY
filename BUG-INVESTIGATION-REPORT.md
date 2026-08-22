# Fonology — 13-item bug report investigation

Investigation only, per instructions. **Nothing has been fixed.** Every file inspected is
listed per item. Two hard constraints affected coverage — stated once here rather than
repeated on every item:

- **Supabase MCP was unauthorized this whole session** (needs `claude mcp`/`/mcp` interactively,
  or claude.ai connector settings — I couldn't run that OAuth flow here). Anything requiring a
  live read of dev data is marked **BLOCKED** below and needs either that authorization or
  someone running the read-only SQL I've included directly (Supabase dashboard → SQL editor,
  read-only `select`s only).
- **FEATURE-05, 06, 10, 11, 13 are not described anywhere in the prompt I received** — only bug
  numbers with no content. I can't investigate a feature request I don't have the text of. See
  Section 7.

---

## 1. BUG-01 — Global Inventory Crash

**Report's claim: NOT accurate as "data loss." This is a client-side validation crash, not
data loss.** High confidence; the one piece I can't independently confirm without a DB read is
noted below.

**Root cause, traced fully:**

The admin "Photos" field on product create/edit is a deliberate, self-documented UI mock —
[`product-dialog.tsx:26-27`](apps/web/src/components/admin/inventory/product-dialog.tsx#L26)
says outright: _"Uploads are UI mocks (filenames only) until Raja wires storage."_ The upload
control ([`field.tsx` `UploadField`](apps/web/src/components/admin/field.tsx#L49)) never
touches the network — it just reads `File.name` off the browser's file picker and pushes that
raw filename string into the form's `images` array. No storage bucket write happens anywhere on
create — there's nothing to fail there.

That filename gets sent as-is to `POST /admin/products`
([`admin.routes.ts:106-166`](apps/api/src/routes/admin.routes.ts#L106)), which inserts it
verbatim into `product_images.url` with **no format validation and no error-checking on that
specific insert** (line 153-156: the insert's error isn't even captured). The product row and
the malformed image row both **commit successfully** to Postgres.

The crash happens on the **response**, not the write. The shared `productSchema` — used by
every consumer, admin and storefront and POS alike — declares
[`images: z.array(z.string().url())`](apps/web/src/lib/data/types/product.ts#L75). A bare
filename like `"IMG_1234.jpg"` fails `.url()`. `adminProductSchema.parse()` on the client throws
a `ZodError`, which is verbose/multi-line by nature — that's the "long error."

**This explains every symptom in the report, in order:**

1. _"Adding a product with 2 images threw a long error"_ — the create succeeded server-side; the
   client's parse of the response threw.
2. _"Retrying without images succeeded"_ — an empty `images: []` array has nothing to fail
   `.url()` on, so that create parses fine on its own.
3. _"but then threw 'unable to load inventory'"_ — the successful retry triggers a query
   invalidation, which refetches the admin product **list**. That list now includes the FIRST
   (corrupted) product. `productSchema.array().parse()` fails atomically — **one bad entry fails
   the entire list**, not just that row.
4. _"Clicking Try Again froze"_ — every retry re-fetches the same permanently-broken list and
   throws again, deterministically. (I didn't dig further into exactly what "froze" means in
   the retry/error-boundary code specifically — the crash being 100% reproducible on every
   retry is the important fact and is confirmed either way.)
5. _"The entire product list vanished from both storefront and POS"_ — confirmed at the code
   level, this isn't a shared-cache coincidence: `GET /products`
   ([`products.routes.ts:154-183`](apps/api/src/routes/products.routes.ts#L154)) — the
   customer/POS-facing catalog endpoint — pulls from the **same `product_images` table** and
   gets parsed by the **same `productSchema`** client-side
   ([`http.adapter.ts:157-162`](apps/web/src/lib/data/adapters/http.adapter.ts#L157)). The
   corrupted row breaks this list too, for every caller — storefront `/shop`, the PDP, and
   POS's product picker/till all go through this one endpoint.
6. _"Restarting doesn't fix it"_ — correct, expected: the bad row is persisted in Postgres, not
   an in-memory glitch.

**Is the data actually gone? — BLOCKED, needs a DB read.** Nothing in the code path deletes
anything; I see no reasonable mechanism by which the create/list code could have removed rows.
High confidence the products are intact. To confirm, run (read-only, dev project
`ohkvwqqtppvnxbvvdsfr` only):

```sql
select id, name, created_at from products order by created_at desc limit 20;
select p.id, p.name, pi.url
from products p join product_images pi on pi.product_id = p.id
where pi.url !~ '^https?://';
```

The second query finds the exact offending row(s) — this is also the data-fix needed once a
code fix ships (deleting/correcting that row; a data cleanup, not a migration).

**Data source note (point 3 of the task):** irrelevant here — the crash is 100% client + API,
same code path either way; `NEXT_PUBLIC_DATA_SOURCE=http` is what surfaces it (mock mode has no
`product_images` table concept at all, so mock mode can't reproduce this).

**Proposed fix — small, no migration:**

- Stop sending the mock filename to the server at all until real upload exists (drop `images`
  from the create/edit payload, or gate it so a bare filename never leaves the client). One-line
  in the mutation payload construction.
- Separately worth a product/eng call: should `productSchema.images` fail an entire list on one
  bad entry, or should the API/client be more defensive (filter out non-URL entries rather than
  hard-fail)? I'd lean toward the API filtering before responding — cheap, and stops one bad row
  from ever taking down the whole catalog again, regardless of how it got there. Flagging as a
  design decision, not assuming.
- Data cleanup (delete/fix the bad `product_images.url` row) is required regardless of which
  code fix ships, or the catalog stays broken. **Needs Supabase access to execute.**

**Files inspected:** `apps/web/src/components/admin/inventory/product-dialog.tsx`,
`apps/web/src/components/admin/field.tsx`, `apps/api/src/routes/admin.routes.ts`,
`apps/api/src/schemas.ts` (`productInputBodySchema`), `apps/web/src/lib/data/types/product.ts`,
`apps/web/src/lib/data/types/inventory.ts`, `apps/api/src/routes/products.routes.ts`,
`apps/web/src/lib/data/adapters/http.adapter.ts`, `supabase/migrations/0003_catalog.sql`,
`supabase/migrations/0011_security.sql`, `supabase/migrations/0025_stock_status_for_many.sql`.

---

## 2. BUG-02 — Lock screen unreliable

**Report's claim: could not reproduce on the one thing I could test live.**

The "Lock screen" button
([`admin-shell.tsx:239-247`](apps/web/src/components/admin/admin-shell.tsx#L239)) is a real
`<button onClick={lock}>`, not behind any indirection — same class of check as the earlier
staff-login click investigation in this project, and it came back clean the same way.

**Live-tested:** signed in as `owner@fonology.test`, real trusted click (not JS-dispatched) on
the actual button → locked on the first click, 1/1. Matches this project's established pattern:
reported click-reliability bugs in this codebase have consistently turned out to not be
click-handling defects when tested with a genuine pointer event.

I did not test the employee account or repeat clicks multiple times — given BUG-03 below ate
most of the time budget for this pair of items and the mechanism (plain button, plain handler,
server-side lock via `staff_sessions.locked`) is structurally identical regardless of role, I
consider this low-risk to leave unrepeated, but flagging that it wasn't exhaustive.

**Files inspected:** `apps/web/src/components/admin/admin-shell.tsx`.

---

## 3. BUG-03 — Passcode rejected after ~20 min

**Root cause: genuinely unclear — reporting honestly rather than guessing, per the hard rule.**
But I found a real, separate, confirmed bug in the unlock error handling along the way.

**What I could confirm:**

- The auto-**lock** trigger (idle timeout → screen locks) is `idle_lock_minutes`, a per-shop
  setting, defaulting to **5 minutes**
  ([`0009_settings.sql:48`](supabase/migrations/0009_settings.sql#L48)), not 20 — this governs
  when the lock appears, not whether a correct PIN gets rejected.
- The access-token cookie is 1hr, refresh token 30 days
  ([`cookies.ts`](apps/api/src/lib/cookies.ts)); `resolveSession()`
  ([`session.ts:40-63`](apps/api/src/lib/session.ts#L40)) transparently refreshes an expired
  access token via the refresh token before giving up — this should make a 1hr access-token
  expiry invisible to the user, not cause a rejection at ~20 min.
- `supabase/config.toml` sets `jwt_expiry = 3600` (60 min), but that's the **local CLI config**
  — it has no bearing on the actual hosted dev project's Auth settings, which live in the
  Supabase dashboard, not in this repo.
- **I cannot rule in or out a ~20-minute JWT expiry configured on the actual dev Supabase
  project's Auth settings** — that's a dashboard setting, not visible in code. **BLOCKED**
  without Supabase access (either MCP, or someone checking Authentication → Settings → JWT
  expiry on `ohkvwqqtppvnxbvvdsfr` directly).
- I don't have a known-good PIN for either test account (not in `TEST-LOGINS.md`), so I
  couldn't test the actual unlock-with-correct-PIN path live, and a 20-real-minute wait mid-way
  through a 14-item investigation wasn't a good use of the time budget for this pass — flagging
  that as a deliberate scoping call, not an oversight.

**What I found instead, independently, that IS a confirmed bug:** the PIN entry component
([`pin-lock.tsx:40-62`](apps/web/src/components/admin/pin-lock.tsx#L40)) shows the **identical**
message — _"That PIN wasn't right"_ — for every single failure mode: an actually-wrong PIN, an
expired/invalid session that never even reaches the PIN check (`requireStaff` 401s first at
[`auth.ts:20-25`](apps/api/src/middleware/auth.ts#L20)), a 500, a network error — anything. This
is a deliberate design choice for the _wrong-PIN-vs-unset-PIN_ distinction specifically (the
server comment at
[`staff.routes.ts:154-156`](apps/api/src/routes/staff.routes.ts#L154) says so explicitly, for
good reason — don't leak whether a PIN is set). But it also silently swallows the _session
expired_ case, which is a different situation the user should be told about differently (re-sign-in needed, not "you mistyped your PIN"). **If the ~20-minute report is real, this is very
likely why it reads as "my correct PIN is being rejected"** — the underlying cause could be a
session-layer failure the UI is mislabeling as a wrong PIN, rather than the PIN check itself
being wrong.

**Proposed fix:** small, once the actual cause is confirmed — distinguish a 401 caused by
session/auth failure from a 401 caused by a wrong PIN in `pin-lock.tsx`'s catch block, and show
a "please sign in again" path for the former instead of "wrong PIN." This doesn't require
knowing the exact ~20-minute cause to be worth doing — it's a correctness fix on its own.

**Recommend before fixing anything:** either (a) check the dev project's real Auth JWT expiry
via Supabase access, or (b) a dedicated timed test — lock, wait a genuinely timed ~20-25 min,
attempt unlock with a **known** PIN, capture the network response (status code + body) at the
moment of "rejection" so we can tell a 401-from-session-expiry apart from a 401-from-wrong-PIN
directly from the wire.

**Files inspected:** `apps/web/src/components/admin/pin-lock.tsx`,
`apps/api/src/routes/staff.routes.ts`, `apps/api/src/middleware/auth.ts`,
`apps/api/src/lib/session.ts`, `apps/api/src/lib/cookies.ts`, `supabase/config.toml`,
`supabase/migrations/0009_settings.sql`.

---

## 4. BUG-04 — Retired products / low-stock alert

**Kashir's default (hard delete unless real dependency) does NOT apply here. Hard delete would
break real history — confirmed at the schema level, not a judgment call.** Keeping soft-delete
is the correct answer; the low-stock alert bug is real and confirmed separately.

**Every FK referencing `products.id`, and its delete behavior:**

| Table                                        | On delete                        | Blocks a hard delete?                          |
| -------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `product_images`                             | `cascade`                        | No                                             |
| `promotions`                                 | `cascade`                        | No                                             |
| `stock_movements` (**the immutable ledger**) | **`restrict`**                   | **Yes**                                        |
| `order_lines`                                | `set null`                       | No (line keeps its own snapshotted name/price) |
| `job_parts`                                  | _(none specified → `no action`)_ | **Yes**                                        |
| `sell_requests.restocked_product_id`         | _(none → `no action`)_           | **Yes**                                        |
| `sale_lines`                                 | `set null`                       | No (line snapshots name/price/cost itself)     |
| `refund_lines`                               | _(none → `no action`)_           | **Yes**                                        |
| `labels.linked_product_id`                   | `set null`                       | No                                             |

`stock_movements` is the decisive one: it's populated at **product creation** itself (every
product, even a fresh one, goes through `stock_receive()` the moment it's given opening stock —
[`admin.routes.ts:144-152`](apps/api/src/routes/admin.routes.ts#L144)), so essentially every
real product that has ever had stock will have at least one `stock_movements` row, and `ON
DELETE RESTRICT` means Postgres itself refuses the delete — not a soft rule, a hard constraint
violation. `job_parts`, `sell_requests.restocked_product_id`, and `refund_lines` add three more
tables that would block deletion the same way (no `ON DELETE` clause = implicit `NO ACTION`,
same practical effect as `RESTRICT`) for any product that's ever been used in a repair, bought
back in and restocked, or refunded.

**Conclusion: keep soft-delete.** No migration needed for the delete behavior itself.

**The low-stock alert leak — confirmed real, and precisely located:**

There are **two separate, inconsistent** low-stock computations in this codebase:

1. A correct one: the DB view `low_stock_products`
   ([`0010_views.sql:343-348`](supabase/migrations/0010_views.sql#L343)) already filters
   `where is_active and low_stock_alert and stock_qty <= low_stock_threshold` — retired products
   are already excluded here. It's exposed via `GET /admin/products/low-stock`
   ([`admin.routes.ts:339-355`](apps/api/src/routes/admin.routes.ts#L339)).
2. **The one actually shown on the dashboard is a different, broken computation.** The Overview
   page's "X low on stock" widget
   ([`overview-view.tsx:32`](apps/web/src/components/admin/overview/overview-view.tsx#L32))
   filters the **full admin product list** (which includes retired products — `GET
/admin/products` never filters `is_active`) using `productIsLowStock()`
   ([`inventory.ts:107-111`](apps/web/src/lib/data/types/inventory.ts#L107)), which checks only
   `lowStockAlert` and `stockQty <= threshold` — **`isActive` is never checked anywhere in this
   path.** A retired product with its alert still switched on and low stock will show up in the
   dashboard count and set `urgent={true}`.
3. **The correct, DB-backed endpoint (`GET /admin/products/low-stock`) is never called from the
   frontend at all** — it's dead API surface. The dashboard reinvented the same logic
   client-side, incorrectly.

**Proposed fix — small, no migration.** Two reasonable options, either fixes it:

- Minimal: filter `products?.filter((p) => p.isActive !== false && productIsLowStock(p))` at
  the `overview-view.tsx` call site, matching the `isRetired` convention already used in
  `inventory-view.tsx` (`p.isActive === false`).
- More robust: have the Overview widget call the already-correct `GET
/admin/products/low-stock` endpoint instead of recomputing client-side — removes the
  duplicate logic entirely rather than patching it in two places.

**Files inspected:** `supabase/migrations/0003_catalog.sql`, `0004_inventory.sql`,
`0005_orders.sql`, `0006_repairs.sql`, `0007_sell.sql`, `0008_till.sql`, `0009_settings.sql`,
`0010_views.sql`, `apps/api/src/routes/admin.routes.ts`,
`apps/web/src/lib/data/types/inventory.ts`,
`apps/web/src/components/admin/overview/overview-view.tsx`,
`apps/web/src/components/admin/inventory/inventory-view.tsx`.

---

## 5. BUG-12 — Online orders / Stripe

**Confirmed accurate — no Stripe code exists anywhere, not even scaffolding.** Grepped both
apps for "stripe" (case-insensitive): the only hits are (a) a UI-only mock in
[`payments/provider.ts`](apps/web/src/lib/payments/provider.ts) that resolves "ok" after a fake
1.4s delay with zero real charge, (b) enum labels (`'stripe' | 'clearpay'`) in Zod schemas with
no behavior behind them, and (c) explicit comments in `orders.routes.ts` calling the manual
"mark as paid" endpoint a _"stand-in for the real payment webhook (Stripe/Clearpay... not built
in this phase)."_ Nothing to build on, nothing partially started. No fix needed — status
confirmed as requested.

**"Ready to collect" — confirmed real, not a misunderstanding.** `order_status` includes both
`'ready'` and `'collected'` as real enum values with real, enforced transitions
([`0005_orders.sql:152,244-256`](supabase/migrations/0005_orders.sql#L152)), and the checkout's
own `DELIVERY_OPTIONS` includes a free click & collect option. Self-collection is a real,
deliberately-built part of the business model — didn't need to ask Kashir/Seraiki, the schema
answers it.

**"Mark as shipped" with no tracking captured — confirmed real, separate, valid finding.**
`POST /orders/id/:id/status`
([`orders.routes.ts:347-360`](apps/api/src/routes/orders.routes.ts#L347)) accepts **only**
`{status}` — `orderStatusBodySchema`
([`schemas.ts:90-92`](apps/api/src/schemas.ts#L90)) has no tracking/courier field at all. Moving
an order to "shipped" captures nothing about how or with whom it was sent. This is a genuine gap
— worth its own decision on size/priority (small: add an optional tracking field to the schema

- a status-move dialog input, similar in shape to the "sent_back" tracking field jobs already
  have).

**Files inspected:** `apps/web/src/lib/payments/provider.ts`,
`apps/web/src/lib/payments/card-machine.ts`, `apps/api/src/routes/orders.routes.ts`,
`apps/api/src/schemas.ts`, `apps/web/src/lib/config.ts`, `supabase/migrations/0005_orders.sql`.

---

## 6. BUG-14 — Float popup shown to owner account

**Confirmed real, and precisely located — not a data/role misconfiguration.**

I actually witnessed this live earlier this session, unprompted, while signed in as
`owner@fonology.test` on a fully-functional owner session (full admin nav, Reports/Returns/
Staff/Settings all reachable, refund history correctly attributed to "Test Owner") — the float
prompt fired. That session was genuinely, fully configured as owner; this rules out "the
account isn't really set up as owner" as the explanation.

**Root cause:** [`float-prompt.tsx:44`](apps/web/src/components/admin/float-prompt.tsx#L44) —
`const open = !floatRecorded && dismissedOn !== today;`. There is **no role or permission check
anywhere in this component.** It isn't "checking the wrong condition" — the condition it checks
(has today's opening float been logged) is exactly what it's supposed to check. It was simply
never scoped to a role at all, so it fires identically for owner and employee.

**Whether this is actually wrong is a product decision, not a code bug on its own** — `cash.manage`
is a permission both roles hold, so it's not obviously incorrect for an owner to be able to log
the float. If the intent is "only cashiers should be prompted, not owners," that's a one-line
addition (an `isOwner` exclusion in the `open` condition) — flagging as needing Kashir's call on
intent rather than assuming.

**Could not check `staff_permissions` directly — BLOCKED**, but the live behavioral evidence
above makes that check unnecessary to reach this conclusion.

**Files inspected:** `apps/web/src/components/admin/float-prompt.tsx`,
`apps/web/src/lib/permissions.config.ts`.

---

## 7. BUG-07 / BUG-08 / BUG-09 — Job workflow gaps (cancel / posted-back)

**Report's claim: mostly NOT accurate as "missing actions" — the backend and the jobs board
both already fully support cancel, posted-back, and collected. But I found the likely real
explanation, which is a genuine, separate, and fairly serious bug.**

**Backend — fully built, not a gap:**

- `job_status` gained `cancelled` in [`0012_job_status_cancelled.sql`](supabase/migrations/0012_job_status_cancelled.sql)
  (its own migration, deliberately, because Postgres won't let a new enum value be referenced in
  the same transaction that adds it).
- [`0013_schema_gaps.sql:144-178`](supabase/migrations/0013_schema_gaps.sql#L144) adds
  `cancellation_reason` (required when cancelling — enforced by a CHECK constraint) and
  `device_returned` (required specifically for a cancelled **mail-in** job, since the shop is
  physically holding a customer's phone in that case — also CHECK-enforced), and rewrites
  `job_status_allowed_next()` so `cancelled` is reachable from `new`, `in_progress`, and
  `waiting_approval` — not from anything already finished. `sent_back` and `collected` were
  already valid, enforced transitions from `done` since the original 0006 migration.

**Frontend board view — fully built, not a gap:**
[`jobs-view.tsx`](apps/web/src/components/admin/jobs/jobs-view.tsx) renders both a forward-move
button set and a dedicated Cancel action per job card, driven by
[`nextJobStatuses()`](apps/web/src/lib/data/types/job.ts#L152), which correctly branches
`sent_back` (mail-in only) vs. `collected` (walk-in only) — matching the DB's own constraint.
`JobMoveDialog` ([`job-move-dialog.tsx`](apps/web/src/components/admin/jobs/job-move-dialog.tsx))
correctly requires a reason for cancellation and a device-location answer for mail-in
cancellations, matching the DB checks exactly.

**What's actually missing:** the job **detail sheet**
([`job-sheet.tsx`](apps/web/src/components/admin/jobs/job-sheet.tsx)) — the fuller panel a
staff member opens to see one job's full detail and manage its parts — has **no move/cancel
actions at all**. It correctly _displays_ cancelled/sent-back state read-only, but never lets
you _trigger_ those transitions from there; that only exists as small icon buttons on the
compact board card. If Seraiki tested from the detail sheet (a natural place to look for
"cancel this job"), they'd find genuinely nothing there — a real, if narrower-than-reported, UI
gap. **Proposed fix: small** — surface the same forward/cancel actions (reusing `JobMoveDialog`)
in the detail sheet.

**A separate bug I found independently while checking this, not in the original report, and
possibly related to the "2 stuck jobs":** the **client-side** `JOB_STATUS_FLOW` for
`waiting_approval` ([`job.ts:145`](apps/web/src/lib/data/types/job.ts#L145)) includes `'done'`
as an allowed next status:

```
waiting_approval: ['in_progress', 'done', 'cancelled'],
```

But the **database's** `job_status_allowed_next()` — the actual enforcement, via a trigger that
raises a hard exception on any other transition — only allows
`waiting_approval → in_progress` or `waiting_approval → cancelled`. **The UI offers a "Done"
button from `waiting_approval` that the database will always reject.** A staff member clicking
it would hit a failed request with no clear next step — which is exactly the kind of thing that
could produce a job stuck in `waiting_approval` with no visible way forward, and could easily be
misreported as "the workflow doesn't let me do X." Worth checking directly against the two
actual stuck jobs once DB access is available — I'd bet on at least one of them sitting in
`waiting_approval`.

**The two real stuck jobs — BLOCKED, needs a DB read.** Read-only query to identify them and
their exact state:

```sql
select id, reference, status, source, revised_quote, revised_quote_approved_at, created_at
from jobs
where status not in ('collected', 'sent_back', 'cancelled')
order by created_at asc;
```

Once identified, no data fix should be applied until the UI/enforcement mismatch above is
resolved — fixing the code first, then deciding whether the two stuck jobs need a manual status
correction, in that order.

**Files inspected:** `supabase/migrations/0006_repairs.sql`, `0012_job_status_cancelled.sql`,
`0013_schema_gaps.sql`, `apps/web/src/components/admin/jobs/jobs-view.tsx`,
`job-move-dialog.tsx`, `job-sheet.tsx`, `job-bits.tsx`, `apps/web/src/lib/data/types/job.ts`.

---

## 8. FEATURE-05, 06, 10, 11, 13

**Could not investigate — I don't have the content of these five items.** The prompt names them
by number only, with no description of what each one claims or requests. I looked for anything
suspiciously close to "half-built feature with no UI" while working through everything above
(e.g., I did notice `GET /admin/products/low-stock` exists server-side with no frontend caller —
see BUG-04 — which is exactly the shape of thing this section is asking about, just found by
accident rather than by checking against a real feature description), but I can't respond
directly to five items with no stated claims.

**Please send Seraiki's original text for FEATURE-05, 06, 10, and 11, 13** and I'll do the
"check for partial existing work before assuming it needs building from scratch" pass properly.

---

## Summary — what I'd flag most

- **BUG-01 is not data loss.** Downgrade the panic, keep the severity (it's a real,
  100%-reproducible total-catalog outage from one bad admin action) — but the fix is small and
  the data is very likely intact.
- **BUG-04's hard-delete question has a definitive answer from the schema alone**, no judgment
  call needed: keep soft-delete, `stock_movements`'s `ON DELETE RESTRICT` settles it.
- **BUG-07/08/09's premise is largely wrong** — the backend and board UI already do everything
  asked for. The real gap is narrower (the detail sheet) and I found a genuinely serious
  _separate_ bug (`waiting_approval → done` offered but always rejected) that the original
  report didn't mention and that may be the actual cause of the "stuck jobs."
- **BUG-14 doesn't need a data check** — I have direct behavioral proof from a working owner
  session that the popup fires regardless of role. It needs a product decision, not further
  diagnosis.
- **BUG-02 matches this project's pattern of reported click bugs not being click bugs.** BUG-03
  is the one item I'd genuinely call unresolved — I found a real, separate, confirmed bug next
  to it (generic error messaging hiding the true failure reason), but the ~20-minute figure
  itself needs either Supabase Auth dashboard access or a dedicated timed test to actually
  confirm or refute.
- **Three items are fully BLOCKED on Supabase access**: confirming BUG-01's data is intact,
  BUG-03's real JWT expiry setting, and identifying BUG-07/08/09's two stuck jobs.
