# Multi-shop rules

Source: client Q&A (2026-10-03) and follow-up decisions the same day.
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

## Known risks

- **Job cancel:** cancelling a job refunds what was paid, in the same transaction, as a normal refund per payment method (cash back as cash, card back to the card); there is no separate void record.
- **Oversell:** two shops selling the last unit at once. The allocation runs in one transaction with row locks.
- **Higher price vs till price:** the website charge is the highest; the till always uses its own shop's price.
- **Merged listing:** copies must share the master record. Un-linked duplicates (e.g. same barcode) are flagged for staff, not auto-merged.
