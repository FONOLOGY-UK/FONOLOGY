# Stage 3 — multi-shop design

Source: client Q&A (2026-10-03) + the four follow-up decisions made in chat the same day.
Earlier decisions still stand (per-shop stock, no transfers, staff on one shop, owner global and never
works a till, per-shop till/float/day close/settings/card limits/printers, new shops are data not code).

## Decisions (final)

| Topic                              | Rule                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website price                      | Highest price among the linked copies (per variant).                                                                                                                                    |
| Online stock                       | Sum across shops. Orders may span shops (qty 2 with 1+1 is allowed).                                                                                                                    |
| Stock taken                        | Shop 1 first, then other shops in `shops.sort_order`.                                                                                                                                   |
| Dispatch                           | Always Shop 1 (a flag on `shops`: `is_fulfilment_hub`), whichever shop's stock is decremented.                                                                                          |
| Online repairs, mail-in, trade-ins | Always the hub shop.                                                                                                                                                                    |
| Master list                        | `master_products` links shop products. Tick "Add to Master List" on create, or "Add from Master List" to copy one into your shop. Any staff may do both and set their own shop's price. |
| Not on master                      | Till-only. Never shown online. Can be linked later.                                                                                                                                     |
| Manager                            | New `staff_role` value `manager`. Reads every shop; writes and till only in the assigned shop.                                                                                          |
| Cross-shop refund                  | Cash out of the REFUNDING shop's drawer and day close; restocked at the refunding shop; stored with `original_sale_shop_id` for reporting.                                              |
| Promotions                         | `promotion_shops` (promotion_id, shop_id): none = off, one, or all.                                                                                                                     |
| Card machines                      | Limits per shop (`card_limits.shop_id`).                                                                                                                                                |
| Printers                           | `print_agents.shop_id`; jobs route by shop; payload uses that shop's address/phone.                                                                                                     |
| Reports                            | Shop / combined / side-by-side comparison.                                                                                                                                              |
| Numbers                            | Unified in 0106: `F01-JOB-061026001` — shop code (auto F01, F02 …), one of 7 prefixes, shop-day, per-shop/prefix/day counter (`issue_shop_reference()`).                                |
| Job cancel                         | Voids the job's payment and subtracts it from that day's totals (see risks).                                                                                                            |
| Job payment                        | "Take payment" opens the POS till with the job loaded; no separate payment path.                                                                                                        |
| Shop 2                             | Address, hours, phone, opening date are data entered later; no opening stock count.                                                                                                     |

## Schema (migrations 0095+, additive)

1. `shops` (id, name, code, sort_order, is_fulfilment_hub, active, address, phone, email, hours, till/printer/return settings that are per shop). Existing data becomes Shop 1. `shop_settings` keeps only site-wide fields.
2. `shop_id not null` (backfilled to Shop 1) on: staff, products, product_variants stock rows, stock_movements, sales, refunds, jobs, job_payments, bookings, repair_enquiries, cash_entries, day_close (unique per shop+day), card_limits, print_agents, print_jobs, devices. Orders get `fulfilment_shop_id` plus an allocation table `order_line_allocations(order_line_id, shop_id, qty)`.
3. `master_products` (+ variants/images) and `products.master_product_id`.
4. `promotion_shops`.
5. `auth_sessions.device_id`; a lock or PIN switch affects one device only.
6. RLS stays deny-all. Isolation is enforced in `apps/api` plus DB functions that take `p_shop_id` and check it against the caller.

## API rules

- Staff request: shop comes from the session, applied to every query. Never from the body.
- Owner and manager: optional `?shop=` filter (default all); manager writes still pinned to own shop.
- Creating stock from admin requires an explicit shop.
- The public catalogue reads a view grouped by `master_product_id`.
- Long lists (transactions, orders, refunds, cash, bookings) get server paging, a shop filter and server totals in the same change.

## Build order

1. 0095 `shops` + `shop_id` backfill + manager role + pgTAP isolation tests.
2. API: shop scoping in session/middleware and every route; sessions per device.
3. Master list + website grouping + highest price + multi-shop allocation at checkout.
4. Per-shop till (day close, float, card limits), promotions, print routing.
5. Reports (3 views) + server paging + below-cost flag from the server (costs.view leak).
6. Job-cancel void and job-payment-through-till.
7. Admin UI: shop switcher, shop management, assignment of staff.
8. e2e for two shops; schema-audit; Docker builds.

## Risks to confirm while building

- **Job cancel on a card-paid or already-closed day:** a void only works before day close. After that it has to become a refund (cash leaves the drawer). Default: void on the same open day, refund otherwise.
- **Oversell:** two shops selling the last unit at once. The allocation runs in one transaction with row locks.
- **Higher price vs till price:** the website charge is the highest; the till always uses its own shop's price.
- **Merged listing:** copies must share the master record. Un-linked duplicates (e.g. same barcode) are flagged for staff, not auto-merged.

## Progress

- **Step 1 done** (0095, 0096): shops, shop_id everywhere, manager role.
- **Step 2 done** (0097, 0098 + API): the database and every API route enforce the shop (see CLAUDE.md
  "Shops"); settings split between `shop_settings` (site-wide, owner only) and `shops` (per shop);
  staff admin can assign a shop and add managers; print agents, jobs and the queue are per shop;
  till sessions are per device. pgTAP 037 and `scripts/e2e-shops.ts` prove isolation.
  Deliberately left for later steps: the `shop_id` defaults stay (see the migrations README);
  an owner keeps their Shop 1 assignment so the existing till/e2e flows work — the "owner has no shop"
  model arrives with the admin shop switcher (step 7).
- **Step 3 done** (0099 + API): master list, one website listing per master at the highest price with
  combined stock, orders split into one line per supplying shop (Shop 1 first). This replaced the
  planned `order_line_allocations` table: since each order line names the shop copy it came from,
  paying/cancelling/restocking already act per shop. New products join the master list unless
  unticked (`addToMaster: false`). API: `GET /admin/master`, `POST /admin/master/:id/copy`,
  `POST|DELETE /admin/products/:id/master`. `scripts/e2e-shops.ts` now covers it (83 checks).
  Not built yet (step 7, admin UI): the checkbox and the "Add from Master List" picker on screen.
- **Step 4 done** (0100 + API): per-shop receipt/job/refund/payout numbers (temporary prefixes, the shop
  code in front for every shop but the hub); an offer can run in several shops (`shopIds` on
  `POST /admin/promotions/bulk`, each shop prices its own copy, only the owner may name other shops,
  unticking a shop removes it from that shop); print wake-ups are per shop and the print-agent README
  explains one agent per shop. Day close, float, card limits and printer config were already per shop
  from step 2. The "which shops" tick-boxes on the promotion screen come with the admin UI (step 7).
- **Step 5 done** (API + till/inventory screens):
  - Cost privacy: cost prices (and the cost-based inventory value, a sale's cost) go only to people with
    `costs.view` (`lib/costs.ts`, `hideCosts()` on the admin product/inventory/master routes and
    `/pos/sales`). Anyone can still WRITE a cost (adding stock); an edit by someone who can't read it
    leaves the stored cost alone. The till's below-cost warning is now a server answer
    (`POST /pos/sales/below-cost`, priced by the same `routes/pos/pricing.ts` the sale uses) and no
    longer shows a cost figure.
  - Reports: `GET /reports/analytics/compare` returns every open shop side by side plus the combined
    total (owner/manager only); one shop / combined are `?shop=<id>` / `?shop=all` on the existing
    analytics.
  - Paging: orders, refunds, cash, day closes, repair requests and the payments ledger accept
    `?limit=&offset=` and then return `{ items, total, limit, offset, totals }` with whole-list figures;
    with no `limit` they return the same plain array as before, so no screen changed. **The screens
    still use the plain arrays** — they move to paging in step 7, where each also gets its shop filter.
- **Step 6 done** (API + job/till screens):
  - Repairs are paid at the till. `POST /pos/job-payments` records a job's payment from the same
    checkout a sale uses (split tenders, card-limit check, slip references), one transaction, one job
    payment per tender, the server deciding the amounts are legal. The job sheet's "Take payment" is a
    link that opens `/pos?job=<id>` with the job on the ticket; Add Job's deposit sends the counter
    there too. A repair ticket holds only that one line (no products, no discount). The old
    `POST /jobs/:id/payments` is left for direct API use; no screen calls it.
  - Cancelling a job refunds what was paid, in the same transaction as the status move: one job refund
    per payment method (cash back as cash, card back to the card), `refundPayments: false` keeps a
    deposit. It is a normal refund, so it nets the original payment out of that day's revenue and the
    drawer's expected cash; there is no separate "void" record, because a refund does the same job
    whether or not the day has been closed. The response lists what the counter must hand back.
  - Not built: a printed receipt for a repair payment (the till's receipt prints sales).
- **Step 7 done** (admin screens):
  - **Shop switcher** at the top of the dashboard sidebar for owners and managers with more than one shop.
    Choosing a shop (or "All shops") sends `?shop=` with every dashboard request, on /admin pages only —
    the till always works in the signed-in person's own shop. A change made while it is on "All shops" is
    refused by the API. `lib/stores/shop.store.ts`, `withShopSelection()` in the API client.
  - **Shops screen** (`/admin/shops`, owner): add, edit, close/reopen. `GET /shops` (staff),
    `/admin/shops` (owner). The hub and any shop with active staff can't be closed. The till header names its shop.
  - **Staff**: Shop and Manager choices (owner only); roster shows each person's shop.
  - **Master list on screen**: "Add to Master List" box on the product form (ticked by default), "Add from
    master list" picker on Inventory (also on the counter's inventory), "Till only" marker on unlinked products.
  - **Promotions**: "Runs in" shop tick-boxes (owner); Pause keeps the offer in every shop it runs in.
  - **Reports**: "Shops side by side" view (owner/manager) next to the single-shop/combined view (which is the switcher);
    a closed shop that traded in the range still appears, so the rows add up to the total.
  - **Paging**: Payments, Returns history, Cash drawer, Day-close history, Online orders and Repair Requests
    now page on the server (DataTable `server` mode) with server-side search; orders' tiles come from
    server totals. Found and fixed while testing: the cash `?date=` filter's regex had lost its
    backslashes (it matched nothing), and the refund count ignored the search.
