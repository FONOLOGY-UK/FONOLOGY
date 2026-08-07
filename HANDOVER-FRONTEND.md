# Handover to Tanoli — where this stands and what's left

This is the one document to start from. It assumes you haven't followed any of the backend/fix work that's happened since you were last on this — everything you need to pick up any single item is either here or pointed to from here.

---

## 1. Where things stand

The backend is complete and proven — real Postgres schema (Supabase, dev project `ohkvwqqtppvnxbvvdsfr`), real API routes, a full end-to-end test script covering signup, ordering, till sales, refunds, repairs, stock receipts, analytics permissions, and day-close (55/55 checks passing as of this handover — rerun it yourself, see §7).

Most storefront and admin surfaces are already connected to that real backend through the `DataAdapter` pattern (`apps/web/src/lib/data/adapters/`) — shop, checkout, repairs, till, refunds, stock, staff, promotions (read), reports, tracking. What's left is **frontend work**: five screens whose current component shape doesn't match what the real backend returns, detailed one by one in §2.

Everything else — money handling, permissions, refund caps, stock costing, delivery pricing — is server-enforced. The frontend's job on those is just to render what the server says, never to compute or re-derive money figures itself.

## 2. The five screens to build/rebuild

These are the five explicitly out of scope for backend-side fix sessions — they're yours. For each: what the backend gives you, why the current component can't consume it as-is, and what the frontend change actually is.

### 2.1 Real repair-job board (bench pipeline)

**Backend provides:** `apps/api/src/routes/jobs.routes.ts` — full job lifecycle: `new → in_progress → waiting_approval → done → sent_back|collected`, plus `cancelled` (with a reason and a device-held/returned resolution for mail-in jobs). Parts consume stock at add-time (not completion) and snapshot cost immutably. Deposits capped at job total.

**Why it doesn't fit:** the current `Job` type (`apps/web/src/lib/data/types/job.ts`) has a 4-value status enum (`new`, `in-progress`, `done`, `collected`) — the real flow has 7: `new → in_progress → waiting_approval → done → sent_back | collected`, plus `cancelled`. There's no `waiting_approval` ("needs customer OK before we proceed") and no stop-and-release step for a cancelled mail-in job at all.

**Frontend change:** extend `jobStatusSchema` to the real 7-value set, and update the board to render `waiting_approval` as its own column/badge and handle the two different valid endings (`sent_back` vs `collected`) plus `cancelled` with its reason. `listJobs`/`createJob`/`updateJob` wire directly once the enum matches — the route shapes already match everything else in `Job`/`JobInput`/`JobPatch`.

### 2.2 Trade-in / sell-request lifecycle

**Backend provides:** `apps/api/src/routes/sell.routes.ts` — the online sell-request flow (`submitted → quoted → accepted|declined → received → paid|rejected`), staff-only quoting, a single-use signed acceptance token (~7 day expiry); `apps/api/src/routes/admin.routes.ts`'s trade-in payout recording (money out, negative, `BUY-` reference, excluded from every revenue figure).

**Why it doesn't fit:** two problems. `SellRequest.status`'s current value set doesn't match the real one, and `'received'` means something different on each side. Separately, the walk-in trade-in form (`TradeInPayoutInput`) has a boolean `addToStock` flag but **no product reference** — just a free-text `deviceLabel`. The real `trade_in_payouts.restocked_product_id` needs an actual product row (price, category, etc.) to attach stock to, which the current form never collects.

**Frontend change:** align the status enum to `submitted, quoted, accepted, declined, received, paid, rejected`, and add a product-picker (or "create a product from this trade-in" step) to the payout form so `addToStock: true` has something real to attach to.

### 2.3 Promotion create/edit internals

**Backend provides:** `POST/PUT/DELETE /admin/promotions` — bulk-tier promotions across multiple products.

**Why it doesn't fit:** the current `Promotion` type covers many products in one object (`productIds: Id[]`). The schema scopes one `promotions` row to exactly **one** product — a create/edit call touches several rows at once, and there's no single object representing the result without losing information (creating one promotion across 2 products returns an array of 2 rows, not 1).

**Frontend change:** either (a) reshape `Promotion`/`PromotionInput` to one-product-per-row and group rows by label for display, or (b) keep the multi-product UI and loop the create/update/delete calls per product client-side, reading the array response back into the multi-product view model. `listPromotions` (read) is already wired.

### 2.4 Day-close screen

**Backend provides:** `POST /pos/day-close` (records the count, computes `expected = floatOpen + pettyIn − pettyOut + cashSales − cashRefunds − cashTradeInPayouts`, returns `variance` and the full breakdown) and `GET /pos/day-close` (history). Proven in this session's E2E run, including a real negative-expected-cash day reconciling correctly.

**Why it doesn't fit:** there's no equivalent at all today — this is a new capability, not a shape mismatch. `apps/web/src/components/admin/cash/cash-view.tsx` currently shows float/petty cash only; no end-of-day count-and-reconcile screen exists.

**Frontend change:** a new screen — a "close the day" form (counted-cash input) that calls `POST /pos/day-close` and renders the returned breakdown and variance. Nothing to adapt; this is new UI.

### 2.5 PIN-lock screen

**Backend provides:** `POST /staff/pin` (set/reset a PIN), `POST /staff/session/lock`, `POST /staff/session/unlock`. Locking is real and server-enforced via `requireUnlocked` on `pos.operate`-gated routes, not a client-only overlay.

**Why it doesn't fit:** the current settings model (`ShopSettings.adminPin`) is a single shared 4-digit PIN with no backing column — the real lock is per-staff (`staff.pin_hash`), a different model entirely (one shared PIN vs. one per person). `adminPin` is now optional in the schema so real API responses validate without it, but that's a compatibility patch, not a fix.

**Frontend change:** build (or wire, if a lock overlay component exists) a real per-staff PIN entry screen calling `/staff/session/lock` and `/staff/session/unlock`, and drop the shared-PIN concept from Settings — there's nowhere for the owner to set one server-side.

## 3. The `/admin/returns` freeze — everything known

**Symptom reported:** clicking "Counter sale" on `/admin/returns` hung the tab. Reproduced earlier on two different browser engines. A prior code review did not find a cause.

**What was tried this pass, in order:**

1. Chased the `setInterval` in the admin shell first (the one lead this pass started with) — checked whether it touches or is touched by returns-view state. No interaction found: the interval doesn't read or write anything the returns view subscribes to.
2. Bisection approach was prepared (stub the counter-sale branch, its data fetch, its list rendering, restore incrementally) but wasn't needed — see below.
3. Instead, drove the real UI end-to-end with a fresh server/session: signed in, opened `/admin/returns`, clicked "Counter sale" (measured at 2.6ms synchronous execution — not a blocking loop), switched Counter sale ↔ Online order repeatedly, searched and added a real product via the line builder, and ran two full refund submissions against a real sale (an over-amount attempt correctly refused with the exact "would exceed what was paid" message; an exact-amount attempt succeeded and is recorded in `refunds`).

**Result: the hang did not reproduce.** The tab stayed fully responsive throughout, including the specific "Counter sale" click that previously froze it. This is not proof the original report was wrong — it's evidence the cause was environmental rather than a persisting code defect: the prior reproduction sessions had documented browser-extension/HMR-churn instability in the dev tooling itself, and a clean server + clean session shows no hang at all.

**What this means for you:** treat this as _currently unreproducible, not fixed_. If it recurs for you or the client, the next lead should be the same one this pass started with and ruled out — the admin-shell `setInterval` — followed by a real bisection (stub counter-sale branch → its fetch → its list render, restore one at a time) if the interval is cleared as a cause again. Nothing was changed in `/admin/returns` or the admin shell this pass.

**The over-refund-via-UI check — previously the one blocked/untested protection — is now verified.** Confirmed live: refunding £2.01 against a £2.00 sale is refused server-side (409, "Refund amount (201) plus what has already been refunded (0) would exceed what was paid (200)"), and a duplicate refund attempt on an already-fully-refunded sale is refused the same way.

**One incidental UX bug found, not fixed (out of scope for this pass):** submitting the returns form with a required field missing shows the raw client-side Zod validation error array as visible text on screen, instead of a formatted message. Worth a quick fix whenever someone's next in that component.

## 4. Files changed under him

Every file touched across the fix sessions since the backend build, so you can review what moved while you were away — this matters, you built these components.

**This session (delivery pricing fix, repair "Other" fix, analytics logging):**

- `supabase/migrations/0021_delivery_quote.sql` (new) — extracts the fee logic into a shared `delivery_quote()` function; `create_order()` now calls it instead of duplicating the logic.
- `apps/api/src/schemas.ts` — delivery enum narrowed to `collect | standard | next-day` (removed `remote` as a selectable value); added `deliveryQuoteBodySchema`.
- `apps/api/src/routes/orders.routes.ts` — new `POST /orders/delivery-quote` endpoint.
- `apps/api/src/routes/reports.routes.ts` — added a server-side log if `analytics_totals` ever returns no row (evidence-gathering only; the empty-body report couldn't be reproduced, 8/8 manual checks returned data).
- `apps/web/src/lib/config.ts` — `DeliveryOption` narrowed, `remote` entry removed from `DELIVERY_OPTIONS`.
- `apps/web/src/lib/data/types/order.ts` — `deliveryMethodSchema` narrowed; added `deliveryQuoteInputSchema`/`deliveryQuoteSchema`.
- `apps/web/src/lib/data/adapters/types.ts`, `http.adapter.ts`, `mock.adapter.ts` — added `getDeliveryQuote`.
- `apps/web/src/lib/data/hooks/query-keys.ts`, `use-orders.ts`, `index.ts` — added `useDeliveryQuote`.
- `apps/web/src/components/storefront/checkout/checkout-flow.tsx` — delivery fee is now always the live, server-quoted figure, not a static lookup; shows a zone message on postcode entry/change.
- `apps/web/src/components/storefront/repair/repair-flow.tsx` — fixed the unlisted-device path: `device === 'other'`/`repair === 'other'` string checks (structurally unreachable — `devices.id`/`repair_types.id` are UUID primary keys, never the literal string `'other'`) replaced with a check on the resolved device's `brand === 'other'` field, which is what the schema already models this with. Applied at `selectDevice`, the free-text-field JSX condition, and the notes-building logic in `submit`.
- **Database (dev project only):** seeded one `devices` row, `brand = 'other'`, name "Other / not listed (dev proof)", so the unlisted-model path is actually testable.

**Prior sessions (connect-and-wire, repair-flow builds, business-rule fixes — for full context, see the sessions' own commits/reports):** `apps/web/src/app/(dashboard)/admin/{labels,payments,promotions,reports,returns,settings,staff}/page.tsx`, `apps/web/src/app/(storefront)/checkout/confirmation/page.tsx`, `apps/web/src/components/auth/staff-login-view.tsx`, `apps/web/src/components/pos/{pos-shell,pos-view,route-guard}.tsx`, `apps/web/src/components/shared/can.tsx`, `apps/web/src/components/storefront/checkout/confirmation-view.tsx`, `apps/web/src/components/storefront/shop/{product-detail,shop-catalog}.tsx`, `apps/web/src/components/storefront/track/track-request.tsx`, `apps/web/src/lib/data/hooks/{use-repair,use-tracking}.ts`, `apps/web/src/lib/data/types/{auth,finance,pos,repair,settings}.ts`, `apps/web/src/lib/permissions.config.ts`, `apps/web/src/styles/storefront{,-extend}.css`, plus the new `apps/web/src/app/(auth)/auth/` OAuth callback route, `apps/web/src/components/auth/google-callback-view.tsx`, and `apps/web/src/lib/supabase-browser.ts`. Run `git status`/`git diff` against `main` for the exact byte-level diff on any of these — this list is for orientation, not a substitute for the diff.

## 5. Known gaps and cosmetics

- **Product photos are still placeholders** — not wired to any real asset pipeline yet.
- **`/admin/returns` form** shows raw Zod validation errors instead of formatted messages on a missing required field (§3, last paragraph).
- ~~Barcode label templates — no backend at all~~ **Stale as of Step 4.** `label_templates` exists (migrations `0009`/`0011`), and the barcode lookup endpoint (`GET /admin/products/barcode/:code`) is live and wired — see `apps/web/src/lib/scanner/`. Flagged wrong in two prior passes; leaving the strikethrough rather than deleting so it's obvious this was checked, not missed.
- **Customer reviews** — no backend table; currently static marketing copy. Worth a product decision (real user-submitted reviews vs. permanently static) before building anything.
- Various pages await final copy (`/terms`, `/privacy`, `/returns-policy`, `/shipping`, `/cookies`, `/about`, `/contact`, `/faq`) and the POS receipt template awaits final branding — content, not code, gaps.

## 6. What needs him vs. what needs the client

**Needs you (Tanoli):** the five screens in §2, the returns-freeze follow-up if it recurs (§3), the Zod-error UX bug (§3), and a decision on customer reviews (§5) once the client weighs in on whether they're real.

**Needs the client — four open questions, still undecided:**

1. **ID-document retention.** "Deleted after 30 days" is checkout/product-page copy only — there is no deletion job, no timestamp field, and no confirmed source for the "30" figure. Needs a real answer before it's a real promise.
2. **Cashier access to the cash/card split.** The float/petty-cash screen (used during day-close by any till operator) reads from an endpoint gated `payments.view`, which isn't in the default employee permission template — a normal employee can open a float and close the day but would get refused fetching this specific screen's data. Needs a decision: give employees `payments.view`, narrow the screen to a `sales.today`-scoped feed instead, or confirm the screen is meant to be owner-only.
3. **Next-day delivery cut-off.** "Order before 2pm for next-day" is checkout copy only — no cut-off time is enforced anywhere server-side. Needs a decision on whether to enforce it and what the actual cut-off should be.
4. **Guest-order linking.** Order/booking tracking by reference always requires reference **and** email (deliberately, to stop a guessable sequential reference exposing someone's full order) — but there's no mechanism yet for a guest to later attach a guest order to an account if they register. Needs a decision on whether that's in scope for v1.

## 7. How to run and test it

See [`HOW-TO-RUN.md`](HOW-TO-RUN.md) for getting both apps running locally, and [`TEST-LOGINS.md`](TEST-LOGINS.md) for seeded owner/employee/customer credentials on the dev project. To re-verify the backend end to end at any point: `cd apps/api && npx tsx scripts/e2e-test.ts` (55 checks, covers signup through day-close reconciliation).
