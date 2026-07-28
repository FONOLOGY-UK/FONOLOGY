# Requirements audit — Fonology backend

Verified today, against the real code and the dev Supabase project (`ohkvwqqtppvnxbvvdsfr`), not against earlier phase reports. Every item below states exactly how it was checked — a query, a live request, or a file+line. Where a past report claimed something I couldn't re-verify now, it's marked PARTIAL or NOT DONE, not DONE. Production (`sbqqpuqoizyjzdcydqid`) was not touched — read-only `list_migrations` calls only.

Verdict key: **DONE** (verified now) · **PARTIAL** (some holds, gap stated) · **NOT DONE** · **FRONTEND-PENDING** (backend proven, needs frontend work) · **NEEDS CLIENT** (blocked on a client decision).

---

## Section 1 — The non-negotiable business rules

**1. Money is integer pence everywhere — no float/decimal/money column anywhere.**
**DONE.** `select table_name, column_name, data_type from information_schema.columns where data_type in ('numeric','real','double precision','money')` returns exactly one row: `devices.price_multiplier` (numeric) — a repair-price _multiplier_ (e.g. `1.4x` for a premium device tier), not a money amount; every actual price it's applied to is integer pence. Separately, every genuinely monetary column across all 40 tables uses the `pence` domain (`integer` under the hood) — confirmed by listing every column of type `pence` via `pg_attribute`/`pg_type` (41 columns across `orders`, `sales`, `refunds`, `jobs`, `trade_in_payouts`, `shop_settings`, etc.). No VAT/tax column exists (see next item's query, same pass).

**2. No VAT anywhere — no column, calculation, or label.**
**DONE.** Same schema query as above with `column_name ilike '%vat%' or column_name ilike '%tax%'` — zero rows. `grep -ri vat apps/api/src` and the pricing docstrings in `apps/web/src/lib/data/types/order.ts` ("NO VAT (HARD RULE #3)") confirm no VAT calculation path exists anywhere in either app.

**3. Customers never see stock counts — only 3-state status; no customer endpoint returns a raw count or cost.**
**DONE.** Live request: `curl http://127.0.0.1:4000/products/crystal-case-dev-proof` → response has `"stockStatus":"in-stock"` and no `stockQty`, `costPrice`, `cost_price`, or `stock_qty` key at all. `apps/api/src/routes/products.routes.ts:11` states the rule explicitly in comment and the handler only ever selects/returns `stockStatusFor()`'s 3-value result (`in-stock`/`out-of-stock`/`restocking`), never the row's `stock_qty`/`cost_price` columns.

**4. Vapes can't be bought online, but can be sold at the till.**
**DONE, live-tested both directions.** `POST /orders` with a vape product line → `400 {"error":"Vapes are in-store only and cannot be ordered online."}`. `POST /pos/sales` with the same product → `201`, sale completes normally (`pos.routes.ts:164`: "no kind check here at all, deliberately, unlike orders.routes.ts's vape rejection").

**5. Promotions are till-only, never online; bulk tiers same-product only.**
**DONE.** Till-only: `grep -i promo apps/api/src/routes/orders.routes.ts` finds nothing but a comment saying promo codes are accepted-and-ignored (no discount-code redemption path exists at all online); only `pos.routes.ts` calls `resolve_sale_unit_price()`, which reads `promo_tiers`. Same-product-only: `promotions.product_id` is a single required FK column (not an array) — the schema cannot represent a cross-product promotion at all, confirmed live in the connect-and-test pass (creating one promotion across 2 products produced 2 separate rows, never one).

**6. Trade-in payouts are money OUT — negative, `BUY-` series, excluded from every revenue figure.**
**DONE.** `trade_in_payouts.amount pence not null check (amount < 0)` ([0007_sell.sql:196](supabase/migrations/0007_sell.sql)) — structurally cannot be positive. Reference series: `issue_reference('trade_in_payout', id, 'BUY')` ([0007_sell.sql:220]). Revenue exclusion re-verified today two ways: (a) `select stream, sum(amount) filter (where amount>0)` over a 7-day window showed trade-in stream contributing **zero** to positive revenue; (b) the connect-and-test E2E script's day-close step hand-verified `expected = floatOpen + ... − cashPayouts` matched the server's own figure exactly, including a real −£150 cash payout.

**7. Employees see today's takings only — no history, no margins, no cost; prove the lockout.**
**DONE, re-proven live today** three separate ways: direct curl as the restricted employee fixture, the same session inside a real signed-in browser tab (`fetch()` from the actual page, not curl), and the automated E2E script. All three: `GET /reports/analytics` → 403, `GET /reports/transactions` → 403, `GET /admin/settings` → 403, `GET /admin/staff` → 403, `GET /pos/today` → 200 with only `{date, total, sales}` (no cost/margin/history fields exist in that response shape at all — `pos.routes.ts:209-219`).

**8. Below-cost sales warn but never block.**
**DONE, live-tested both with and without a reason.** `POST /pos/sales` at a price below `cost_price`, with `belowCostReason` supplied → `201`, `belowCost:true`. Same call with **no** `belowCostReason` → still `201`, `belowCost:true, belowCostReason:null`. `shop_settings.below_cost_prompts_for_reason` exists as a setting but is never read by `complete_sale()` or `pos.routes.ts` to gate anything — it's a pure UI-prompt flag, confirmed by `grep -rn belowCostPrompts apps/api/src` returning only the settings read/write, never a conditional check on the sale path.

**9. Split payments must sum to the total exactly.**
**DONE, live-tested.** `POST /pos/sales` with payments summing to 200p against a 500p total → `409 {"error":"Sale ... payments (200) do not equal the total (500)"}`. Enforced by a deferred constraint (`sale_payments_sum_matches_total`) explicitly set `immediate` then `deferred` around the insert in `complete_sale()` — a real DB constraint, not app-layer arithmetic.

**10. Return window default 30 days, configurable in settings, single source, no hardcoded constant reintroduced.**
**DONE, re-proven live today.** Refunded a sale within the default 30-day window (succeeded, no override). Patched `returnWindowDays` to `0` via `PATCH /admin/settings`. A second-old sale then correctly required override (`409` without it, succeeded with it). `grep -rn returnWindow apps/web/src/components` finds no hardcoded day count anywhere in a component — the frontend's `ShopSettings.returnWindowDays` is the only place the number lives.

**11. Permissions are per-person, enforced server-side on every action.**
**PARTIAL.** Per-person storage and enforcement is real: `staff_permissions` is a per-`staff_id` table (role is only the insert-time template — [0002_identity.sql:133-134]), and every admin/POS/reports mutation I inventoried (44 route handlers across 9 files) is gated with `requirePermission()` reading that per-person set — **except** five endpoints that are `requireStaff`-only with no specific permission check: `GET /orders` (admin order list), `POST /orders/:reference/paid`, `POST /orders/id/:id/status`, `GET /repair/bookings` (admin list), `GET /repair/enquiries`. These are all _documented in code_ as deliberate ("no dedicated `orders.manage` permission exists in the 15-value enum" — `orders.routes.ts:95`), and `/paid` is explicitly a temporary payment-webhook stand-in pending real Stripe/Clearpay signature verification — but as written today, any signed-in staff member (not just ones with a specific permission) can move an order's status or mark it paid. Not a security hole in the sense of an unauthenticated gap, but not strictly "per-person permission-gated" either.

**12. Every money/stock record carries the staff member who did it.**
**PARTIAL.** Every genuinely monetary/stock-moving table has a `staff_id`-shaped attribution column, confirmed by listing every `%staff_id%`/`%_by`/`%reviewed%` column across the schema: `sales.staff_id`, `refunds.staff_id`, `cash_entries.staff_id`, `day_close.staff_id`, `stock_movements.staff_id`, `trade_in_payouts.staff_id`, `job_payments.staff_id`, `job_parts.added_by`, `staff_permissions.granted_by`, `order_documents.reviewed_by`. Live-verified today: viewing an ID document writes a real `audit_log` row attributed to the actual signed-in staff member (`actor_id`, `actor_label` both correct — see item 13). **Gap:** an online order's status transitions (`paid`, `ready`, `shipped`, `cancelled`, etc.) carry no "changed by" column at all on `orders` — the trigger validates the transition but nothing records which staff member moved it, only that `requireStaff` let them through.

**13. ID documents: private bucket, signed URLs, owner-only, audit-logged, retention enforced.**
**PARTIAL.** `select id, public from storage.buckets` confirms `id-documents` is `public: false`. `select * from pg_policies where schemaname='storage'` returns **zero** RLS policies on `storage.objects` — meaning no client (anon or authenticated) can read this bucket via any path at all; the only access is the server's service-role key via `createSignedUrl()`, gated behind `requireStaff + requirePermission('settings.manage')` (the closest fit to "owner-only" in the 15-permission enum). Audit logging is real and re-verified live today: calling `GET /orders/:ref/documents/:kind/view` produced a genuine `audit_log` row (`action:'document.view'`, correct `actor_id`/`actor_label`, correct `entity_id`) — this had never actually been exercised in any prior phase's proof, only claimed. **Gap:** retention is a _mechanism_, not an _enforcement_ — `purge_expired_order_documents()` and a "due for deletion" listing endpoint both exist and work, but `select extname from pg_extension where extname='pg_cron'` returns nothing: there is no scheduled job that ever calls purge automatically. Someone (a cron, a manual admin action, or an external scheduler) has to trigger it.

**14. All timestamps UTC, "today"/daily/hourly grouping via the UK-time functions.**
**DONE.** `select ... from information_schema.columns where data_type like '%timestamp%' and data_type not like '%time zone%'` returns zero rows — every single timestamp column in the schema is `timestamptz`, never a naive timestamp. `shop_day(ts timestamptz) returns date` does `(ts at time zone 'Europe/London')::date` ([source read live today](supabase/migrations/0001_foundation.sql:109)) and is the sole date-bucketing mechanism used by `analytics_series`, `busiest_times`, `pos_today_summary`, and `day-close`'s trading-day math — confirmed by reading each function's definition live.

---

## Section 2 — The client-confirmed decisions

**Individual staff logins; no middle role.** **DONE.** `select enumlabel from pg_enum ... where typname='staff_role'` → exactly `owner`, `employee`. `staff.email citext not null unique` ([0002_identity.sql:21]) — no shared logins possible.

**Customers can have accounts (Google + email/password).** **DONE for both endpoints; Google needs a frontend piece (see Section 3).** Email/password fully live-tested today (signup → session → signin, real browser and curl). Google: `POST /auth/customer/google` genuinely validates against Supabase Auth (`curl` with a fake token → real `401`, not a stub).

**Guest order lookup by reference + email.** **DONE**, live-tested today including the negative case (wrong email → `200 null`, indistinguishable from "no such order," per `orders.routes.ts:196-200`'s own comment).

**Guest orders attach to an account if they later register with the same email — or at least aren't blocked from doing so.** **PARTIAL.** The weaker bar holds: `grep guest_email apps/api/src/routes/auth.routes.ts` finds nothing — registration never checks against existing guest orders, so nothing blocks it. The stronger bar (automatic attach) does **not** exist: there is no code path anywhere that links a pre-existing `orders.guest_email` row to a `customers.id` on signup. A returning guest's old orders stay guest-orders forever unless a human re-associates them.

**Repair parts come out of the same stock as counter sales.** **DONE.** Both `complete_sale()` (till) and the job-parts-add route call the same `stock_consume()` function against the same `products.stock_qty` column and the same `stock_movements` ledger (`'sale'` vs `'repair_part'` kind, same table) — one shared inventory, not two.

**Bought-in devices become stock manually, staff-priced.** **DONE at the schema/backend level** (`trade_in_payouts.restocked_product_id`, `resale_price`, `restocked boolean` — nothing is auto-priced or auto-listed). **FRONTEND-PENDING**: the walk-in counter form (`TradeInPayoutInput`) has an `addToStock` boolean but no product picker at all, so there's nothing for the backend to attach stock to from that screen yet — already on the handover list.

**Weighted-average cost.** **DONE, live-verified today.** Two receipts (10@600p, then 10@1000p) on a fresh product → server returned `costPrice: 800` = `(6000+10000)/20` exactly, via the E2E script.

**Staff can write off stock with a reason.** **DONE, live-verified today** (E2E script + a direct call this session): `POST /admin/products/:id/write-off {quantity, reason}` → stock decrements, reason is stored, call is attributed to the signed-in staff member.

**Low-stock alert per product, optional, with its own threshold.** **DONE.** `products.low_stock_alert boolean`, `low_stock_threshold integer`, per-row (not a global setting) — live-verified this session: an active product with `stock < threshold` appears in `GET /admin/products/low-stock`; a deactivated one, or one with the alert off, does not.

**Vapes stocked and sold at the till.** **DONE**, see Section 1 item 4.

**EPOS import is one-time (not a built feature).** **DONE, correctly absent.** `grep -ri epos apps/api/src supabase/migrations` — zero matches. No import route, no import table.

**Repair "sent back" stage + mail-in marker.** **DONE.** `job_status` includes `sent_back`; `job_source` is `walk_in | mail_in | online`. Live-read the actual trigger function today: `sent_back` requires `source = 'mail_in'` AND a non-null `return_tracking_number`, and rejects `collected` for a mail-in job outright.

**Repair waiting-for-approval stop when a job costs more than quoted.** **DONE**, verified by reading `validate_job_status_transition()` live today: entering `waiting_approval` requires `revised_quote` to be set first; leaving it back to `in_progress` requires `revised_quote_approved_by` **and** `_approved_at` to be recorded — can't silently resume.

**Deposits allowed on repairs, with an amount.** **DONE.** `jobs.deposit_amount`, capped by `jobs_deposit_not_over_price` CHECK (confirmed present via grep of [0006_repairs.sql:246]).

**Unlisted models use an "Other" enquiry path.** **DONE.** `repair_enquiries` table + `POST /repair/enquiries` (public) + `GET /repair/enquiries` (staff) — a real enquiry row, not a fake device.

**Trade-in quotes always set by a person.** **DONE.** `sell_requests.quoted_by uuid`; `POST /sell/requests/:id/quote` is `requireStaff + requirePermission('tradein.manage')` — no auto-quote path exists.

**Returns: no enforced policy, staff can override, override recorded.** **DONE**, re-proven live today (Section 1 item 10) — `windowOverrideBy` is recorded on the refund row with the actual staff id.

**Refund can use a different method than the original sale; both recorded.** **DONE.** `refunds.refund_tender` and the API's returned `originalTender` (captured from `sale_payments`/order at refund time) are two distinct fields — confirmed structurally by reading `pos.routes.ts:256-267` and the E2E script's cash refund against a cash+card split sale.

**No walk-in customer records.** **DONE.** `sales` table has no `customer_id`/name/phone/email column at all (checked its full column list live) — a till sale cannot create or reference a customer record.

**Delivery priced by postcode; free-delivery per-product; next-day cut-off.** **PARTIAL.** Postcode zone pricing and per-product `free_delivery` are both real and live in `create_order()` (read the function body today). The next-day cut-off is **not enforced anywhere**: `shop_settings.next_day_cutoff_time` is stored and editable via the settings API, but `grep -rn next_day apps/api/src` shows it is never read by `create_order()` or anywhere else — an order can be placed as `next-day` delivery at any hour with no cutoff check, rejection, or automatic bump to standard.

**Mixed free/normal basket → full delivery fee.** **DONE**, verified by reading `create_order()` live: `v_all_free` requires _every_ line to be `free_delivery`; one non-free line makes the whole order pay the full zone rate (not prorated).

**No VAT.** **DONE**, duplicate of Section 1 item 2.

**End-of-day cash-up with variance recorded (not accusatory).** **DONE, live-verified today** including a genuinely negative-expected-cash trading day (a real scenario the schema initially _blocked_ — see the bug fix below) reconciling correctly: `variance = countedAmount − expectedAmount`, stored as a signed number, no pass/fail judgement anywhere in the schema or response.

**Trade-in payout by cash or bank transfer.** **DONE.** `trade_in_payouts.method check (method in ('cash','bank_transfer'))`.

**Below-cost sale: reason optional, not required.** **DONE**, see Section 1 item 8.

**Bulk discounts same-item only.** **DONE**, duplicate of Section 1 item 5.

**Number-plate documents reviewed; order held until approved; rejected → refund path.** **DONE for reviewed/held, live-re-proven today**: created a real plate order, marked paid, attempted `→ ready` (blocked — "unresolved verification documents"), approved one doc + rejected the other (still blocked), approved both (succeeded). "Rejected → refund path" exists as the **general** order-refund mechanism (`source:'order'` on `POST /pos/refunds`) — there is no _automatic_ refund fired the instant a document is rejected; a staff member processes it manually via the normal refund endpoint. That matches how every other refund in this system works (always a deliberate staff action, never automatic) and I believe is the intended design, not a gap — flagging the distinction so it isn't assumed to be automatic.

**ID document retention (currently 30 days, settings-editable) — flag it's still pending final client confirmation.** **NEEDS CLIENT.** Mechanism is real (`idDocumentRetentionDays`, default 30, editable) — the number itself was never confirmed by the client per the original brief, and per item 13 above, nothing runs the purge automatically yet regardless of what the number is set to.

---

## Section 3 — Google login specifically

- **Is the backend endpoint built?** Yes. `POST /auth/customer/google` ([auth.routes.ts:99](apps/api/src/routes/auth.routes.ts)) — verifies the incoming Supabase access token against real Supabase Auth (`supabaseAuth.auth.getUser()`), creates the `customers` profile row on first sign-in, and issues the same httpOnly session cookies as every other sign-in path. Live-tested today: a fake token is correctly rejected with a real `401 "Invalid Google session."`, not a stub response.
- **What's missing for it to work end to end?** Confirmed by direct inspection today, more precisely than previously stated: (1) `apps/web/package.json` has **no** `@supabase/supabase-js` (or `@supabase/ssr`) dependency at all — the browser-side SDK needed to _start_ the OAuth redirect isn't even installed; (2) there is no callback route/page anywhere under `apps/web/src/app` for the provider to redirect back to; (3) `signInWithGoogle()` in the adapter is an unwired stub. All three are frontend work — no backend gap.
- **Is email/password sign-in fully working as the interim?** **Yes, confirmed live today**: registration → session → sign-in all work end to end, both via direct API calls and through an actual signed-in browser session.
- **One-line state:** Google login is **~70% done** — the server-side verification and session issuance are built and proven; what's missing is entirely frontend (install the Supabase JS SDK, add an OAuth callback page, wire the adapter method).

---

## Section 4 — Coverage of the full feature surface

| Area                                                                           | Backend                                                                                | Connected to frontend?                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Storefront** (browse, search, product, categories)                           | Complete                                                                               | Connected — live-verified through the real browser today (category filter 9→3 items, product page, real API data)                                  |
| **Customer accounts & auth**                                                   | Complete (email/password + Google server-side)                                         | Connected for email/password (live-verified); Google needs the frontend piece above                                                                |
| **Checkout & online orders** (delivery, documents, paid, stock)                | Complete, including the number-plate document gate                                     | Connected — order create/read-back wired; admin order list newly wired this pass                                                                   |
| **The till** (sales, splits, refunds, cash, day-close, today)                  | Complete                                                                               | Connected, except day-close has no frontend screen yet (handover item)                                                                             |
| **Repairs** (booking, pricing, jobs, parts, deposits)                          | Complete                                                                               | Booking/pricing/read-back connected; the real job board is **FRONTEND-PENDING** (mock's 4-status enum can't represent the real 7-status lifecycle) |
| **Trade-ins** (request, quote, accept-token, payout, restock)                  | Complete and proven (submitted→quoted→accepted→received→paid, signed single-use token) | **FRONTEND-PENDING** entirely — the mock's status model and the payout form's missing product-picker both block wiring                             |
| **Admin** (products, stock, suppliers, promotions, staff, settings, documents) | Complete                                                                               | Connected, except promotion create/update/delete (`productIds[]` vs one-row-per-product mismatch — **FRONTEND-PENDING**)                           |
| **Reports** (analytics, busiest times, ledger, category/tender, lockout)       | Complete                                                                               | Connected — analytics, transactions, and the employee lockout all live-verified today                                                              |

---

## Section 5 — What's genuinely unbuilt (vs. built-but-unwired)

**Genuinely unbuilt (no backend at all):**

- **Customer reviews** — `apps/web/src/components/storefront/home/reviews.tsx` renders `listReviews()`; no `reviews` table exists anywhere in the schema.

**Correction to an earlier claim — this audit found the previous handover note wrong:**

- **Label templates** — the previous handover doc (written earlier today) said "no schema exists at all." That was incorrect and this audit caught it live: `label_templates` **does** exist (`id, name, lines jsonb, linked_product_id, barcode_value, created_by, created_at, updated_at` — built in [0009_settings.sql](supabase/migrations/0009_settings.sql), part of the original Phase A design). What's actually true: the table exists, but **no API route was ever built against it** (`grep -rn label apps/api/src/routes` finds zero label-template endpoints), so it's schema-only, not "genuinely unbuilt." Correct verdict: **PARTIAL** — needs a thin route layer (the table already fits the mock's `LabelTemplate`/`LabelTemplateInput` shape closely), not a schema redesign.

**Dead/unused schema (built, never connected to anything, not on the client's requirements list — noted for completeness, not flagged as a gap):**

- `documents` (a generic polymorphic document table, superseded by `order_documents`) and `audit_log`'s general-purpose shape are both present but only `audit_log` is actually used (via `log_document_view()`).
- `customer_addresses` — a saved-address table with zero rows and zero API routes touching it.

---

## Section 6 — The honest risk list

**Proven only by curl/API, not yet through a real browser:**

- The full click-driven storefront flow (add-to-bag → checkout form submission → placed order) was **not** verified by clicking through the actual UI this session — the sandbox's Browser pane doesn't composite visual frames (confirmed by repeated failed screenshots and every interactive element reporting a zero-size bounding rect), so scroll/animation-gated buttons couldn't be clicked. What **was** verified through a real, signed-in browser tab: registration, customer sign-in, staff sign-in, the admin dashboard fetching real data, and the employee report-lockout, all via genuine `fetch()` calls from the live page (confirmed via network-request logs, not curl). The equivalent add-to-bag→order→sale→refund→booking chain **was** proven end-to-end via the scripted API test, exercising the identical endpoints the UI calls — but that is still API-level proof, not a mouse click.
- The real job board, trade-in screens, PIN-lock screen, and day-close screen have never been exercised through any UI at all, real or otherwise, because no frontend component exists for them yet.

**Depends on Tanoli's integrations — untestable until built:**

- Stripe/Clearpay online payment (the `/orders/:reference/paid` endpoint is an explicitly-documented stand-in for the real payment webhook — currently gated by staff auth only, "NOT a stand-in for real webhook security" per its own code comment).
- Real card terminal at the till (`pos1`/`pos2` tenders are just labels today; no terminal integration exists or was ever in scope for this backend).
- Receipt/label printers (no printer integration exists anywhere in this codebase).

**Works on dev, untested path to production:**

- **Storage RLS** — confirmed zero policies on `storage.objects` in dev, which is safe _because_ the app only ever uses the service-role key. This same posture needs to exist in production's storage config; not verified there (production was not touched, per the standing rule).
- **Service-role key setup** — dev's `.env.local` config was never compared against what production's runtime environment actually has configured; assumed but not verified.
- **Migration file/history mismatch**: dev's tracked migration history has 20 entries (`0015_order_phone_fix_overload` and `0015b_order_phone_column` as two separate applied steps), but only **19** files exist on disk in `supabase/migrations/` (`0015_order_phone.sql` is a single consolidated file). If production is set up by replaying the files on disk (not by replaying dev's exact history), the _end state_ should still be correct — but this hasn't been verified by actually doing a from-scratch replay against an empty database. Worth a dry run before using this migration set against production.
- **`pg_cron` / scheduled purge** — not installed on dev at all; needs to be set up on whichever environment is meant to actually enforce document retention, dev or prod.

**The `/track` reference-only privacy gap.**
Still present, unresolved, already on the handover list: `getTracking(reference)` has no email parameter, and every reference in this system (`FNL-xxxx`) is sequential and shared across orders/sales/bookings/sell-requests — building it as specified would let anyone who can guess a nearby reference number see another customer's name, address, phone, and order contents. Deliberately left unwired rather than shipped insecure.

**Permission-scope question left for the client.**
`payments.view` (needed by `cash-view.tsx`'s float/petty-cash screen, via `listTransactions`) is **not** in the default employee permission template (confirmed today: `default_permissions('employee')` = `pos.operate, jobs.manage, inventory.manage, labels.manage, cash.manage, tradein.manage, sales.today` — no `payments.view`). A normal cashier can open a float and close the day, but the specific screen that shows today's cash reconciliation would 403 on part of its data for them unless the owner grants `payments.view` per-person. Not patched — this is a policy call, not a bug.

---

## Bottom line

**Is the backend done? Mostly, with a short, specific list of real gaps** — not a clean yes. Every core money rule (integer pence, no VAT, split-payment sums, below-cost non-blocking, trade-in exclusion, the employee lockout, weighted-average cost, the return window) is genuinely done and was re-proven live today, not just cited from an old report. The gaps that remain are narrow and named, not systemic: two settings that are stored but never enforced (next-day delivery cutoff, automatic document-retention purge), one client decision only half-built (guest-order auto-linking on registration), one permission gap (five staff-wide-not-per-person endpoints), one missing attribution column (order status changes), a label-templates route layer that was never written against an already-existing table, and the Google-login frontend piece.

### Must-fix-before-launch shortlist (privacy, security, feature-can't-go-live — not nice-to-haves)

1. **`/track` reference-only lookup** — do not wire this as originally specified; it's a real PII exposure via guessable sequential references. (Already correctly left unwired — flagging so it stays that way until the frontend adds an email field.)
2. **Automatic document retention** — no scheduled job purges expired ID documents anywhere. Needs `pg_cron` (or an external scheduler) wired to `purge_expired_order_documents()` before this can be considered actually enforced, not just capable of being enforced.
3. **Next-day delivery cutoff is not enforced** — a customer can order "next day" at 11pm with no rejection or fee adjustment; if next-day delivery is genuinely time-sensitive for the courier relationship, this needs the setting actually wired into `create_order()`.
4. **`/orders/:reference/paid` has no real payment-webhook security** — it's staff-auth-gated only, explicitly documented as a stand-in. Must not go live accepting real payments until Tanoli's real webhook signature verification replaces it.
5. **`storage.objects` has zero RLS policies** — safe today only because every access goes through the service-role key; this posture must be confirmed (not assumed) in whatever production storage config gets set up.

### Needs-client-decision shortlist

1. **ID document retention period** — currently defaults to 30 days and is settings-editable, but the number itself was never finally confirmed.
2. **`payments.view` for cashiers** — should the default employee template include it (so the cash-up screen fully works for a normal till operator), or is that screen meant to stay owner-only?
3. **Next-day cutoff behaviour** — once wired, should a late order be rejected outright, silently bumped to standard delivery, or something else? (Currently moot since it isn't enforced at all yet.)
4. **Guest-order-to-account linking** — is automatic attach-on-registration actually wanted, or is "not blocked from happening manually" genuinely sufficient, as the original decision's wording ("or at least") suggests?

---

## Plain-language summary

The backend is in good shape — almost everything the client asked for is really built and I re-tested the important, money-related parts myself today rather than trusting the old write-ups, and they hold up. The real gaps are small and specific: a couple of settings (like the next-day delivery cutoff, and automatically deleting old ID documents) exist as fields you can edit but don't actually do anything yet; one place where a member of staff's name isn't recorded when an order's status changes; a "label templates" feature that has its database table built but no working screen behind it yet; and Google login needs some frontend plumbing before customers can actually use it (the server side is ready). Nothing here is a surprise rebuild — it's a short, named list, and I've flagged the handful of things (payment security stand-in, storage permissions, the public tracking page) that genuinely should not go live as-is.
