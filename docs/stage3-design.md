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
| Numbers                            | Temporary per-shop prefix via `issue_reference(.., prefix)`; unify before launch (Sohaib + Kashir).                                                                                     |
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
  "Shops"); settings split between (site-wide, owner only) and (per shop); staff
  admin can assign a shop and add managers; print agents, jobs and the queue are per shop; till
  sessions are per device. and prove isolation.
  Deliberately left for later steps: the defaults stay (see the migrations README);
  an owner keeps their Shop 1 assignment so the existing till/e2e flows work — the "owner has no shop"
  model arrives with the admin shop switcher (step 7).
