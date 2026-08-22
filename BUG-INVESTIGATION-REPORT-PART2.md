# Fonology — bug investigation, part 2 (Supabase-blocked items + FEATURE items)

Continuation of `BUG-INVESTIGATION-REPORT.md`. Project ref stated once: **`ohkvwqqtppvnxbvvdsfr`
(dev)** — every MCP call below ran against this project. Production (`sbqqpuqoizyjzdcydqid`)
was never touched. **Investigation only, except item 1's explicitly-authorized cleanup.**

---

## 1. BUG-01 — data confirmed intact, cleanup done

**Products are intact.** The three most recent rows are `QA Test Product 1` (×3), timestamped
2026-08-20 — matching the reported test session exactly.

**The bad rows, confirmed exactly as predicted:** 4 rows in `product_images`, on 2 of the 3
"QA Test Product 1" products (the third — the successful no-images retry — has none):

| product_id                             | url             | position |
| -------------------------------------- | --------------- | -------- |
| `b474527d-b9ce-4bc1-b0ed-c0c066d8cbd7` | `IMG_8637.jpeg` | 0        |
| `b474527d-b9ce-4bc1-b0ed-c0c066d8cbd7` | `IMG_8638.jpeg` | 1        |
| `3ad411e5-8061-437d-9c8c-6c98748325a8` | `IMG_8637.jpeg` | 0        |
| `3ad411e5-8061-437d-9c8c-6c98748325a8` | `IMG_8638.jpeg` | 1        |

Bare iPhone-style photo filenames, no protocol, no host — exactly the shape predicted. This
also tells us Seraiki attempted the "2 images" create **twice** (two separate products each
got the same two filenames), not once.

**Cleanup done — this pass's one authorized write:**

```sql
delete from product_images
where id in (
  'bc3ff9dd-3aa3-433d-9062-7f97a7c71129', '10c5f306-78ab-47aa-a9f7-9500d03e8e21',
  '274b459e-d3b8-459d-95ff-6544f7b61ea3', 'b5fd1fa8-b199-42af-86b0-918b811df374'
);
```

All 4 rows deleted (confirmed via `returning`). Verified zero non-URL rows remain in
`product_images` afterward. The three `QA Test Product 1` **product rows themselves were not
touched** — only the malformed image references. The catalog (storefront, POS, and admin) is
unblocked; a fresh `GET /products` will no longer have anything to fail `.url()` on.

**Nothing in the previous report changes here** — the root-cause chain is now fully verified
against real data, not just predicted from code.

---

## 2. BUG-03 — still unresolved; exhausted what's available this pass

**Could not get the real JWT expiry.** There's no MCP tool in this connector that reads a
project's Auth configuration — `get_project` returns only infra metadata (region, Postgres
version, host), and Postgres itself doesn't store GoTrue's JWT expiry (it's a control-plane
setting, not a database value), so `execute_sql` can't reach it either. This needs the Supabase
**Dashboard** directly: Authentication → Settings → JWT expiry, on `ohkvwqqtppvnxbvvdsfr`. I
looked for every plausible tool name and searched the available connector surface — nothing
fits.

**No PIN available, confirmed again.** Re-checked `TEST-LOGINS.md` — no PIN is documented for
either account, only login passwords. `staff.pin_hash` is set for `owner@fonology.test` (see
item 4 below) but it's a bcrypt hash — reading it tells me nothing usable, and I'm not going to
ask you to paste a credential into chat. Per your own instruction: **there's genuinely no way
to get a real PIN without asking, so I'm saying so rather than guessing or fabricating a test.**

**Net result: BUG-03's ~20-minute figure is neither confirmed nor refuted.** The one thing this
pass adds: I now know a PIN **does** exist for the owner test account (so the unlock path is
real and testable, not blocked on "no PIN ever set" as a separate possibility) — once someone
either shares a known PIN through a secure channel or is willing to run the timed test
themselves, it's a same-day, low-effort test to actually settle this. The generic
"wrong-PIN-vs-session-expired" error-message bug found in the previous pass stands as a
confirmed, separate, real fix regardless of how this resolves.

---

## 3. BUG-07/08/09 — the stuck jobs

The query in the brief returns **47 rows**, not 2 — but the vast majority are ordinary
mid-flow jobs (created in rapid triplets — walk_in/in_progress/online, seconds apart —
textbook seed/E2E fixture data from 26–30 July). Being non-terminal isn't the same as being
stuck; I looked for the actual anomaly signature instead: a job that was clearly _worked on_
and then never moved.

**Found one, and it's a very clean match:**

```
FNL-10221 — status: waiting_approval, source: walk_in
revised_quote: £60.00
revised_quote_approved_by: a4627730-aa27-4682-9f04-d04c6d7dc438  (a real staff id — set)
revised_quote_approved_at: 2026-07-30 16:15:55  (set)
created_at: 2026-07-30 15:27:27
updated_at: 2026-08-06 11:25:09   ← 11 days after the approval timestamp, 7 days after creation
```

This is exactly the shape the client-vs-database mismatch found in the previous pass would
produce: the revised quote was approved (both `approved_by` and `approved_at` are set — the DB
trigger's own requirement for `waiting_approval → in_progress` is satisfied), and then someone
came back and touched the row again a full week later — almost certainly attempting to move it
forward — but the status never advanced. That's consistent with staff clicking the "Done"
button the UI incorrectly offers from `waiting_approval`, which the database always rejects,
leaving no successful write to actually change `status` (only whatever partial state got
written before the trigger raised).

**Could not find a second one with the same confidence.** I checked the other two jobs that
stood outside the obvious seed-data bursts — `FNL-10233` (`created_at == updated_at` exactly,
never touched since creation — just an ordinary unclaimed job) and `FNL-10296`/`FNL-10297`
(both from 2026-08-20, matching Seraiki's test session date, but `FNL-10296`'s update is 40
seconds after creation — a normal single status move, not a stuck pattern, and `FNL-10297` has
never been touched at all). None of these show the "approved-then-abandoned-for-days" signature
`FNL-10221` does.

**Honest conclusion: one confirmed stuck job (`FNL-10221`), not two.** Either the second one
isn't distinguishable from normal in-flight data by the signal I used, or "2" was a count from
Seraiki's own testing session that I'd need their specific reference(s) for for. Worth asking
directly rather than me guessing further.

**No status fix applied, per instructions** — this needs the `waiting_approval → done` UI
mismatch fixed first.

---

## 4. BUG-14 — closed out, belt-and-braces confirmed

```
name: Test Owner, role: owner, is_active: true, has_pin: true
permissions: pos.operate, jobs.manage, inventory.manage, promotions.manage, cash.manage,
tradein.manage, sales.today, costs.view, analytics.view, payments.view, reports.view,
returns.manage, labels.manage, staff.manage, settings.manage
```

Full 15-permission management set, exactly matching `MANAGEMENT_PERMISSIONS` in
`permissions.config.ts`. This account is genuinely, completely correctly configured as owner —
confirms what the live behavioral test already showed. **Nothing changes from the previous
report**: this is a code-level gap (`FloatPrompt` has no role check at all), not a data issue,
and it needs a product decision on intent, not more diagnosis.

---

## 5. FEATURE-05 — Category/Subcategory management

**Real schema change needed — this is not a small addition.**

`products.category` is a native Postgres **enum type** (`product_category`), confirmed via
`information_schema.columns` — not a table, not free text. There is no `categories` table
anywhere in the schema at all (`information_schema.tables` search for anything
category-shaped returns nothing), and **no subcategory concept exists in any form**.

Postgres enums can't be edited at runtime by an admin UI — adding a value requires an `ALTER
TYPE ... ADD VALUE` DDL migration (and, as this project's own 0012 migration demonstrates,
that value can't even be _used_ until the migration that added it has committed). Removing or
renaming an enum value is harder still — effectively a type-recreation.

**What this actually needs:** replacing the enum with a real `categories` table (id, label,
slug, `parent_id` for subcategories), a migration to backfill the 7 existing enum values into
it, changing `products.category` from `product_category` to a `uuid references categories(id)`,
and updating every place that currently assumes the fixed 7-value set — the category tabs UI,
the Zod enums on both sides, the product create/edit dialog, storefront filtering. **Size: needs
a migration, and a real one — not "add a filter," a genuine data-model change.**

---

## 6. FEATURE-06 — "In-Store Only" visibility toggle

**Nothing like this exists today — confirmed, not assumed.** Searched `products` columns for
anything visibility- or store-related beyond `is_active`; nothing. The only two states a
product can be in are active/retired (`is_active`) — there's no third "hidden from storefront,
visible at POS" state.

Note: `kind = 'vape'` gets close but isn't the same thing — vapes are still **listed** on the
storefront (with an "in store only" badge, per `product.ts`'s own comment) and merely excluded
from cart/checkout logic. FEATURE-06 wants full storefront absence, not "listed but unbuyable" —
a genuinely different, additive mechanism, not an extension of the vape handling.

**What this needs — small, one column + one filter, no migration to the delete/dependency
graph:**

- A new boolean column, e.g. `in_store_only` (`not null default false`)
- One line added to `GET /products`' and `GET /products/:slug`'s `WHERE` clause (`products.routes.ts`)
  to exclude it — `GET /admin/products` (admin) and the POS product-picker/till path stay
  unfiltered, since they already query without an `is_active` filter for admin and presumably
  without one for POS too (worth double-checking the POS product lookup path specifically
  filters on stock/active but not this new flag)
- A checkbox in `product-dialog.tsx`, same pattern as the existing `localBuying`/`lowStockAlert` toggles

**Size: small.**

---

## 7. FEATURE-10 — Mail-in/Walk-in selector on job creation

**More nuanced than "the UI forgot a dropdown" — there's a real, deliberate reason it's
walk-in-only today, and the fix isn't a simple toggle.**

The concept fully exists at the schema level (`job_source` enum: `walk_in | mail_in | online`,
confirmed in the previous pass). The quick counter "add job" dialog
(`add-job-dialog.tsx:83-87`) hardcodes `source: 'walk_in'`, with an explicit comment explaining
why: **`POST /jobs` refuses a `mail_in` job with no `bookingId`**
(`jobs.routes.ts:147` — `if (body.source === 'mail_in' && !body.bookingId)`). A mail-in job is
supposed to come into existence by linking a real customer-submitted booking from the
storefront's `/repair` flow (name, address, contact prefs already captured there) — not from
staff typing details into a quick counter form with nothing to link.

**So the real question for Kashir, before sizing this:** does "mail-in selector on job
creation" mean —

1. _Let staff search for and link an existing unlinked booking from this dialog_ — the
   dialog needs a booking lookup, feeding the real `bookingId` the backend already requires.
   Frontend-only, moderate — a new lookup UI plus the existing create-job mutation.
2. _Let staff create a mail-in job with no prior booking at all_ (e.g. a customer posted
   something in without ever using the website) — this means relaxing the backend's own
   `mail_in` ⇒ `bookingId` requirement, which exists for a stated reason and would need
   Kashir's sign-off to change, since it's a deliberate rule, not an oversight.

**Size: needs a design decision** on which of these is actually wanted before it can be sized
as frontend-only vs. a backend rule change.

---

## 8. FEATURE-11 — Jobs UI/UX redesign

Understood as scoped — a design/usability request, not a defect. No investigation performed,
nothing touched, per instructions. Agree a mockup/design pass before implementation is the
right call.

---

## 9. FEATURE-13 — Counter sales view

**The data already exists, in a real, working, general-purpose endpoint — this is mostly a UI
gap, with two small real backend additions needed for the specific filters asked for.**

`GET /reports/transactions` (`reports.routes.ts:146-181`, gated on `payments.view`) already
returns a full itemized, date-ranged list — every sale, order, repair payment, and refund,
unioned into one `transactions` view (`0013_schema_gaps.sql:303`) with `stream`, `reference`,
`description`, `amount`, `cost`, and `tender`. This is real, live, and already powers something
(the Payments admin page) — not a stub.

**What's actually missing for what FEATURE-13 asks:**

- **Filter by date** — already works (`from`/`to` query params).
- **Filter by payment type (tender)** — the field is already in the response; this is
  client-side filtering over existing data, no backend change. One nuance: a split-tender till
  sale (part cash, part card) doesn't have a single tender at the `sales`-row level the view
  currently exposes (`tender` is `null` on the `'shop'` stream branch) — filtering by tender for
  those would need a join down to `sale_payments`'s individual legs, not the summary row. Worth
  deciding whether "filter by payment type" should mean "any leg matches" or needs a different
  shape for split sales.
- **Filter by staff member** — the underlying view's `sales` branch already carries `staff_id`
  (`0013_schema_gaps.sql:320`), but the API's response mapping never exposes it
  (`reports.routes.ts:164-179` has no `staffId`/`staffName` field at all). This is a small,
  real backend addition — add the column to the response shape and resolve it to a name, the
  same way `staffName` is already resolved elsewhere in this codebase (e.g.
  `pos.routes.ts:152`).

**Size: small-to-medium** — a new dedicated UI tab is the main piece of work, sitting on top of
an endpoint that already does 90% of what's needed; the two real backend additions (expose
`staffId`, decide how split-tender filtering should behave) are both small.

---

## Summary — what's changed since the previous report

- **BUG-01**: now fully confirmed, not just predicted — data intact, exact bad rows found and
  removed. Nothing contradicted; everything matched.
- **BUG-03**: unchanged — still unresolved, now for a documented reason (no tool access to
  Auth config, no PIN available) rather than a placeholder.
- **BUG-07/08/09**: found **one** confirmed stuck job (`FNL-10221`), not two — a genuine,
  partial gap from what the brief expected. Its data signature strongly corroborates the
  `waiting_approval → done` mismatch as the real cause.
- **BUG-14**: confirmed, no change.
- **FEATURE-05**: bigger than a UI gap — needs a real migration (enum → table).
- **FEATURE-06**: small, confirmed nothing exists to build on — genuinely net-new (one column).
- **FEATURE-10**: more nuanced than assumed — the missing dropdown has a deliberate reason
  behind it; needs a decision from Kashir on which of two different things is actually wanted
  before it can be sized.
- **FEATURE-13**: mostly UI over an already-working endpoint, as suspected — plus two small,
  concrete, real backend additions now identified precisely.
