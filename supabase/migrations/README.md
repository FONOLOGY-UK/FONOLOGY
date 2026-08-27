# Fonology database

Plain SQL, applied through Supabase migrations. Every change is a numbered file
in here — nothing is created directly in the database, so the whole thing can be
rebuilt from scratch and git always knows how it got its shape.

## Done

| File                                          | What's in it                                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0001_foundation.sql`                         | Money type, UK time helpers, reference numbers, audit log                                                                                                                                                                                  |
| `0002_identity.sql`                           | Customers, addresses, staff, per-person permissions, PIN sessions                                                                                                                                                                          |
| `0003_catalog.sql`                            | Suppliers, products, images, promotions and bulk tiers                                                                                                                                                                                     |
| `0004_inventory.sql`                          | Stock movements, weighted average cost, oversell protection                                                                                                                                                                                |
| `0005_orders.sql`                             | Delivery zones by postcode, orders, order lines, order documents                                                                                                                                                                           |
| `0006_repairs.sql`                            | Devices, repair types, part tiers, mail-in bookings, jobs, parts used                                                                                                                                                                      |
| `0007_sell.sql`                               | Trade-in requests, manual quotes, guest acceptance, payouts                                                                                                                                                                                |
| `0008_till.sql`                               | Sales, sale lines, split payments, refunds, cash entries, day close                                                                                                                                                                        |
| `0009_settings.sql`                           | Shop settings, label templates, documents with approval state                                                                                                                                                                              |
| `0010_views.sql`                              | The money ledger, today's totals, analytics                                                                                                                                                                                                |
| `0011_security.sql`                           | Row level security, storage buckets                                                                                                                                                                                                        |
| `0012_job_status_cancelled.sql`               | Adds `cancelled` to `job_status` — its own file, deliberately: Postgres won't let a new enum value be referenced anywhere in the same transaction it's added in, and 0013 needs to use it in a CHECK constraint and a function body        |
| `0013_schema_gaps.sql`                        | Closes gaps found in review, after the schema had already passed its own test suite once: a job refund path, job cancellation, money-direction constraints the sweep found missing, a customer-delete fix, and a promo-tier price resolver |
| `0014_order_address_relax.sql`                | Relaxes the delivery-address CHECK to match what checkout actually collects                                                                                                                                                                |
| `0015_order_phone.sql`                        | Orders need a contact phone number                                                                                                                                                                                                         |
| `0016_pos_today.sql`                          | Today's takings, computed server-side — impossible to widen past the trading day                                                                                                                                                           |
| `0017_analytics_series_by_stream.sql`         | `analytics_series` split into shop vs repair figures, for the stacked chart                                                                                                                                                                |
| `0018_staff_phone.sql`                        | Staff need a contact phone number                                                                                                                                                                                                          |
| `0019_day_close_expected_can_be_negative.sql` | `expected_amount` on a day-close can legitimately go negative                                                                                                                                                                              |
| `0020_document_retention_job.sql`             | Real ID-document retention — a due-for-deletion function that also removes the Storage object, not just the row                                                                                                                            |
| `0021_delivery_quote.sql`                     | Read-only delivery quote, sharing its fee logic with `create_order` so the checkout screen and the charge can never drift                                                                                                                  |
| `0022_promotion_groups.sql`                   | One promotion across many products, applied atomically (single-transaction `upsert_promotion_group()`)                                                                                                                                     |
| `0023_promotion_group_product_check.sql`      | Readable error when a promotion names a product that doesn't exist                                                                                                                                                                         |
| `0024_day_close_breakdown.sql`                | Stores the six-term breakdown behind each day's expected cash, not just the total                                                                                                                                                          |
| `0025_stock_status_for_many.sql`              | Batched stock-status lookup — `GET /products` down from 2 queries per product to 2 total                                                                                                                                                   |
| `0026_delivery_estimate.sql`                  | Dispatch/arrival dates honouring the next-day cut-off time                                                                                                                                                                                 |
| `0027_link_guest_orders.sql`                  | Attaches a new customer's pre-existing guest orders to their account (Google sign-in only)                                                                                                                                                 |
| `0028_bank_holidays.sql`                      | Bank holidays feed into the delivery estimate, so it stops assuming every weekday is a working day                                                                                                                                         |
| `0029_bank_holidays_2028_2030.sql`            | Extends the bank-holiday list through 2030                                                                                                                                                                                                 |
| `0030_payment_provenance.sql`                 | `sale_payments` gains `confirmed_by`/`provider_reference`/`source` — who confirmed a manual card payment and off which slip; `create_order` stops leaving `payment_provider` null                                                          |
| `0031_day_close_repair_cash.sql`              | Fixes a real money bug: cash taken on repairs was never counted in expected cash, causing a phantom overage on every such day. Breakdown grows to seven terms                                                                              |
| `0032_freeze_card_machine_label.sql`          | Freezes the card machine's display name (Shift4/Dojo) onto each payment at confirm time, so a future provider change can't relabel history                                                                                                 |
| `0033_print_queue.sql`                        | Durable print queue for the in-shop agent: `print_agents`, `print_device_health`, `print_jobs`, an atomic `claim_print_job()`, and the receipt/label asymmetry in `expire_print_leases()`                                                  |
| `0034_real_shop_details.sql`                  | The shop's REAL address, phone, email and opening hours into `shop_settings` — replacing placeholder details that existed in five separate hardcoded copies, one of which was the JSON-LD Google reads                                     |
| `0035_refund_reference.sql`                   | `refunds` mints its own `REF-` reference. It was the only customer-facing record without one, and the API borrowed the original sale's — which makes two partial refunds against one sale identical on the paper the customer keeps        |

**The table above stops at `0035` and the ones after it were never added to
it.** `ls supabase/migrations` is the authoritative list, not this table —
`0036`, `0037` and `0043`–`0051` all exist and are applied to dev. The most
recent:

| File                                      | What's in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0049_order_shipping_tracking.sql`        | `orders` gains `courier` + `tracking_number`. The API refuses to move an order to `shipped` without both, so a dispatched parcel can never exist without the reference the customer needs to chase it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `0050_mail_in_booking_optional.sql`       | Drops `jobs_mail_in_has_booking` — a mail-in job no longer has to link to a booking. `booking_id` stays nullable either way; this only removes the requirement that it be filled in, so a device that arrives by post with no prior booking can still be logged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `0051_mail_in_post_back_after_cancel.sql` | `jobs` gains `courier`. `job_status_allowed_next()` adds `cancelled -> sent_back` (mail-in only — `nextJobStatuses()` on the frontend already narrows `sent_back` to mail-in jobs, and the target-status checks inside the trigger are unchanged, so a walk-in job cancellation still can't reach it). `validate_job_status_transition()`'s existing `sent_back` branch now also requires `courier` to be set, matching the tracking-number requirement it already had. Deliberately does **not** add `cancelled -> collected` — a cancelled walk-in job's "device collected" is still recorded as a same-status update, same as before this migration. Nothing here touches `create_refund()` or any money table: a job's `status` and whether its sale was refunded are separate concerns, and this only ever widens what `jobs.status` itself may become |

Migrations reach the **dev**
project (`ohkvwqqtppvnxbvvdsfr`) via the Supabase MCP connector, applied
directly from an agent session — see `SETUP.md` for the full route and the
mandatory project-ref check before every write. Next step beyond that is
wiring an API up to it — see the note at the end of this file about how
permissions ended up enforced.

## When a migration is frozen

**A migration is frozen the moment it is committed and pushed — not the moment
it is first run against dev.**

Before that point it is a draft. It has only ever touched one database, that
database is dev, and nobody else has a copy — so correcting the file and
re-applying leaves file and database in agreement, which is the state that
actually matters.

After it is pushed, someone else may have applied it. Editing it then means
their database and yours disagree permanently, and nothing will tell either of
you. From that point a mistake is fixed by a NEW numbered migration, however
small and however embarrassing.

This was decided when `0033` shipped with a `CASE` expression that resolved to
`text` where an enum was required. It created cleanly and would have thrown the
first time a label lease expired — weeks later, in the shop. It was caught by a
smoke test before the commit, so the file was corrected in place and the
function replaced on dev. Had it been pushed, it would have been `0034`.

## Five decisions worth knowing about

**Money is integer pence everywhere.** No decimals, no floats. The `pence` type
makes that obvious in every table. Pounds only exist on screen.

**Everything is stored in UTC, but "today" means the shop's today.** The server
runs UTC; the shop runs on UK time with summer time. Use `shop_day()` for every
daily figure. Without it, late sales land on yesterday and the busiest-times
chart is an hour out for half the year.

**Every reference number comes from one place.** `issue_reference()` writes to
`reference_registry`, so two references can never clash, and the track page
becomes one lookup instead of searching three tables and hoping.

**Permissions belong to a person, not a role.** The role only decides which
boxes start ticked. The owner changes them whenever he likes without ringing
anyone. New accounts start with less rather than more — giving access back is
one click, an employee having seen the profit figures isn't undoable.

**Stock counts are the sum of their history.** Every change writes a row to
`stock_movements` saying what happened and why. The number on the product is
kept in step automatically, so reads stay fast and "why is this wrong" is
always answerable. Movements can't be edited or deleted — a mistake gets a
correction row.

## Two things that behave differently to the frontend

**Overselling now fails.** Two tills selling the last item at the same moment:
the first wins, the second is rejected. The frontend silently clamps to zero and
lets both through.

**Cost price is a weighted average.** Ten cases at £4, ten more arrive at £5,
cost becomes £4.50. The frontend just overwrites the old figure, which makes
every past profit number reflect whatever the cost happened to be that day.

## How permissions ended up enforced

Settled: the frontend talks to its own API, never to Supabase directly. So
`0011_security.sql` enables row level security on every table with zero
policies — deny-all — and revokes every default grant from `anon` and
`authenticated`, including for objects created by migrations after it. The API
connects with the service role and checks `staff_can()` itself. RLS here is a
second line of defence, not where the real rules live: if a key ever leaks,
the database still hands over nothing. The one exception is product photos,
which are public-read in Storage because proxying image bytes through the API
buys nothing.

## More decisions worth knowing about, from 0005 onward

**Five sources feed the money ledger, not four.** `0010`'s `transactions` view
was asked to union sale payments, paid orders, job payments and trade-in
payouts. Refunds were left out of that list; added anyway, as a fifth,
always-negative source — omitting them would have overstated every revenue
figure in the system by the full value of every return, silently.

**A sale isn't just ledger rows anymore.** `sale_lines` now exists — the
frontend never persists what was actually on a till receipt, only one ledger
row per payment portion, which is why a counter refund can't prefill anything
today. `complete_sale()` in `0008` writes the lines, the payments and the
stock consumption in one transaction; if the payments don't sum to the total,
the deferred trigger at commit rolls all of it back together.

**Job parts are new structure, not a port.** Nothing in the frontend links a
repair job to the stock it uses. The client has now confirmed repair parts
share stock with counter sales, so `0006` adds `job_parts` and consumes stock
the moment a part is added to a job — when it's physically fitted, not when
the job is marked done.

**Permissions vs. the one-shared-PIN in this file's own brief.** `0002`
already gives every staff member their own PIN (`staff.pin_hash`). The brief
for `0009_settings.sql` asked for a shop-wide admin PIN hash in
`shop_settings`; that would have quietly reintroduced the one-shared-code
model `0002` already deliberately moved away from, so it isn't there.
`shop_settings` keeps `idle_lock_minutes` (genuinely shop-wide) and drops the
PIN field. See the note in `0009` itself.

**Bank transfer as a trade-in payout method is a `text` + `check`, not an
enum**, unlike almost everything else in this schema. The client hasn't
confirmed it yet — a `CHECK` constraint is a one-line migration to narrow;
removing a value from an already-shipped enum is not.

**Below-cost sales prompting for a reason is configurable; below-cost sales
being blocked is not.** The "never required" business rule is fixed in code
(`0008`: `below_cost_reason` has no `NOT NULL`, ever). `shop_settings.
below_cost_prompts_for_reason` only controls whether the till UI shows the box
at all — filling it in stays optional either way.

## Found while writing the test suite, fixed here rather than left broken

**`0010`'s money ledger no longer prorates cost across payment tenders,
anywhere.** Two branches of the `transactions` view used to split a single
cost figure across multiple payment rows — proportional to each payment's
share of the total — and round each row's share independently. That doesn't
guarantee the rows sum back to the real cost: a 1000p job cost split three
equal ways rounds to 333p three times, 999p total, a penny short of the
truth for no reason. Fixed in both places it happened:

- The shop branch is now one row per **sale**, not per payment portion,
  using `sales.total`/`sales.cost` directly (exact) with `tender` left
  `null` — a split-tender sale doesn't have one tender to attach an
  approximate cost slice to, so it stops pretending to. `today_takings_by_
tender` and `tender_totals()` were rewritten to read `sale_payments` and
  `job_payments` directly instead of this view's now-tenderless shop rows.
- The repair branch now attaches a job's real cost once, to whichever
  `job_payments` row's running total first reaches the job's price — not
  prorated across every payment on the job. A job that's only ever taken a
  deposit, and never reaches its quoted price, contributes zero cost to the
  ledger rather than a partial guess; that's deliberate, not a gap — its
  economics were never actually settled.

Both are proven in `supabase/tests/011_rounding.sql`, including the specific
"three equal payments lose a penny" case that exposed the bug in the first
place.

## `0012`/`0013` — gaps closed after the schema had already passed its own suite once

**A refund can now name a job, and refunds are stricter as a result.**
`refunds` gained `job_id` alongside `sale_id`/`order_id`, so a cancelled or
abandoned repair's deposit has somewhere to go back to
(`create_refund(p_job_id => ...)`, capped at what was actually paid on that
job — `sum(job_payments)`, same "can't exceed what came in" rule sale and
order refunds already had). The real decision here: `refunds_exactly_one_
link` now requires **exactly** one of the three, not "at most one". The old
link-less "goodwill, no receipt" refund — previously valid, previously
tested as valid — no longer is. That's a deliberate tightening, not an
oversight: see `supabase/tests/007_till.sql`, which used to assert a
no-link refund succeeds and now asserts the opposite.

**Jobs can be cancelled.** `cancelled` is a new terminal `job_status`
(added in its own file, `0012`, because Postgres won't let a fresh enum
value be referenced anywhere — a CHECK, a function body — inside the same
transaction it was added in), reachable from `new`, `in_progress` or
`waiting_approval` — not from `done`, which already finished. A cancelled
job needs a `cancellation_reason` (never blank/whitespace-only), and a
cancelled **mail-in** job specifically needs `device_returned` recorded —
the shop is physically holding a customer's phone, and "cancelled" can't
mean "and nobody knows where the device went." Walk-in jobs aren't forced
to record it — the customer has their own device in hand either way.

**Two real bugs surfaced by finally exercising `record_job_payment()`
successfully for the first time.** The function's own existing test only
ever expected it to throw (an over-large deposit), which meant a genuine
bug — every single call failing with a type error (`payment_status = CASE
... 'paid' ... END`, where the CASE's all-literal branches resolve to
`text`, which has no implicit cast to the `job_payment_status` enum) — went
undetected: the test still showed green, for entirely the wrong reason.
Fixing that cast revealed a second bug in the same statement:
`deposit_amount`'s own CASE read `payment_status` assuming it saw the
sibling SET clause's just-computed value, but every SET expression in one
UPDATE reads the pre-update row — so the payment that actually completed a
job overwrote `deposit_amount` to the full price paid, not the real deposit
portion. Both fixed together; and once the type bug no longer masked
everything, a third gap turned up on its own: `record_job_payment()` never
actually capped cumulative payments against the job's price at all — the
existing "refuses an overpayment" test had only ever been passing because
of bug #1. All three are proven in `supabase/tests/005_repairs.sql`.

**A discount can no longer exceed the subtotal, on sales or orders.**
Previously `GREATEST(subtotal - discount, 0)` just silently clamped an
over-large discount to a 0p total instead of refusing it. Now
`discount <= subtotal` is its own CHECK — capped against the subtotal
specifically, not subtotal + delivery fee, so a discount can zero out the
goods but a parcel still costs something to send. A **fully** discounted
sale (100% off, or a genuinely free 0p product) is still meant to work —
which turned up its own small gap: `sale_payments.amount` required `> 0`,
but a 0p total sale needs a payment array that sums to 0 while
`complete_sale()` also requires at least one payment row. Relaxed to
`amount >= 0` — one payment row of 0p records "nothing changed hands,
correctly," rather than making a free sale impossible to complete at all.

**A money-column sweep found several prices with no floor at all.**
`repair_types.base_price_*`, `jobs.quoted_price`/`revised_quote`,
`sell_requests.quoted_amount`, `trade_in_payouts.resale_price`, and
`day_close.expected_amount`/`counted_amount` could all previously go
negative — nobody had asked "can this be negative" of them before. All
six now forbid it. `shop_settings.float_target` too. Every other money
column already had the right check; see `supabase/tests/013_money_
direction.sql`'s own header comment for the full sweep, both sides of the
line.

**Deleting a customer with a non-guest order now actually works.**
`orders.customer_id` was already `ON DELETE SET NULL`, but
`orders_guest_or_customer` requires `customer_id` or `guest_email` —
nulling one without the other left a registered customer's order failing
that CHECK the moment the customer was deleted, refusing the delete instead
of the order surviving "guest-shaped" the brief for this asked for. A
`BEFORE DELETE` trigger on `customers` now copies the customer's email onto
their orders' `guest_email` first, so the CHECK still holds once
`customer_id` goes null.

**A promo tier that doesn't apply needed something to actually answer
"what does this quantity cost," and nothing did.** `resolve_sale_unit_price
(product_id, quantity)` is new: the best qualifying bulk tier on an active,
currently-running promotion, or the shelf price if none qualifies — never
null, never an error, for a quantity below every tier's `min_qty` or for no
promotion at all. `complete_sale()` itself still trusts the caller's
`unit_price` (unchanged, out of scope here) — this is the authoritative
answer available for whatever calls it to use.

**`purge_expired_order_documents()` (0009) already existed but had never
actually been run against real rows.** It does exactly what its own comment
claims — deletes an `order_documents` row once its order is resolved
(`collected`/`shipped`/`cancelled`) _and_ past `id_document_retention_days`
— proven now in `supabase/tests/016_document_retention.sql`, including that
an unresolved order's documents survive no matter how old they are.

**The two-connection concurrency proof is a committed file, not a
throwaway script.** `supabase/tests/concurrency_stock_race.js` — see
`supabase/tests/README.md` for how it runs and why it has to be separate
from the `.sql` suite.

**The `product-images` storage policy remains unverified from any
environment available while doing this work** — no Docker, no Supabase
access token, checked directly rather than assumed. See
`supabase/tests/README.md` for the exact manual check a human has to do by
hand after the first real deploy.
