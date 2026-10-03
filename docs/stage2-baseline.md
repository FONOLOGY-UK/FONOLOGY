# Stage 2 baseline — measured 2026-10-03, before any stage-2 change

Where: local machine, `fonology_bench` database (`scripts/bench/seed-bench.sql`:
400 products, 100 with 3 variants, 3,000 till sales, 300 orders, 150 refunds), API in dev
mode (`tsx`), web as a production build (`next start`). Raw numbers are the
`baseline-*.json` files next to the scripts in `scripts/bench/`. Re-run the same
scripts at the end of stage 2 and compare.

Reproduce: `pnpm stack:up` → create/migrate/seed `fonology_bench` → start the API with
`DATABASE_URL` pointing at it → `node scripts/bench/api-timings.mjs`,
`node scripts/bench/bundle-sizes.mjs` (after `next build`), `node scripts/bench/lighthouse.mjs`.

## API (ms, 20 requests, p50 / p95)

| Endpoint                             | p50     | p95 | Size       | Note                             |
| ------------------------------------ | ------- | --- | ---------- | -------------------------------- |
| GET /admin/products (till catalogue) | **318** | 617 | 249 kB     | N+1: ~23 queries per product     |
| GET /reports/transactions (120 days) | **243** | 288 | **3.7 MB** | unbounded, no paging             |
| GET /pos/refunds                     | **123** | 356 | 61 kB      | N+1: 3 extra queries per refund  |
| GET /reports/analytics (120 d)       | 60      | 118 | 4 kB       |                                  |
| GET /pos/today/report                | 43      | 55  | 14 kB      |                                  |
| GET /orders                          | 26      | 31  | 159 kB     | unbounded                        |
| GET /products (storefront)           | 24      | 41  | 148 kB     | whole catalogue                  |
| GET /pos/today                       | 22      | 25  |            |                                  |
| GET /auth/session                    | 20      | 38  |            | 4 sequential queries per request |
| everything else                      | 4–18    |     |            |                                  |

## Database — pg_stat_statements, one harness pass (22 endpoints x 23 runs)

Biggest by call count (the N+1s): `product_images where product_id = $1` 9,223 calls;
`categories where id = $1` 9,200; `sales where id = $1` 3,450; `refund_lines where refund_id`
3,450; the four session queries (staff, staff_permissions, staff_sessions, auth_sessions)
~460 each.
Biggest by time: `revenue_by_category` 37 ms mean, `transactions` list 28 ms (314k rows read),
`busiest_times` 26, `tender_totals` 23, `analytics_series` 22, `pos_today_report` 21.

## Web — first-load JS per route (gzip, all chunks the page loads)

Largest: /shop/[slug] 235 kB, /pos/inventory 225, /shop 223, storefront home 222,
/admin/inventory 221, /checkout 216, /admin/jobs 216. Smallest real pages ~160 kB;
static legal pages 101 kB (the framework floor).

## Lighthouse (mobile emulation, performance, median of 3)

| Page        | Score | FCP   | LCP   | TBT        | CLS      |
| ----------- | ----- | ----- | ----- | ---------- | -------- |
| Home        | 37    | 2.0 s | 5.6 s | **10.4 s** | 0        |
| /shop       | 29    | 2.0 s | 6.1 s | **9.6 s**  | 0.17     |
| PDP         | 52    | 1.8 s | 7.2 s | 1.0 s      | 0.01     |
| Till (/pos) | 45    | 1.7 s | 4.2 s | 1.2 s      | **0.32** |

Home and shop block the main thread for ~10 s under Lighthouse's 4x CPU throttle: that is
the cart drawer fetching the whole catalogue plus Stripe.js loading site-wide (2b #3).
Caveat: dev-machine, throttled-CPU numbers — compare like with like, not with the web.

---

# Stage 2 results — measured 2026-10-03, after

Same bench shop, same scripts. **The dev machine was at ~70% CPU from other applications for most of
these runs**, so absolute numbers are pessimistic and run-to-run noise is large; the comparisons below
were therefore made _back to back on the same machine_, old code vs new code, not against the quiet-machine
baseline above.

## API — old code vs new code, alternating, median of 2 rounds (p50 ms)

| Endpoint                                                            | Old       | New                                       |
| ------------------------------------------------------------------- | --------- | ----------------------------------------- |
| GET /admin/products (till catalogue)                                | 910       | 66                                        |
| GET /pos/refunds                                                    | 308       | 25                                        |
| GET /auth/session                                                   | 31        | 7.6                                       |
| Typical signed-in endpoints (settings, cash, folders, day-close, …) | 18–25     | 11–14                                     |
| GET /pos/today, /orders, /pos/today/report                          | ~same     | ~same                                     |
| GET /reports/transactions (120 days), /reports/analytics            | 607 / 119 | 643 / 172 (no gain; needs paging)         |
| GET /products                                                       | 50        | 60 (gzip CPU; 163 kB → 19 kB on the wire) |

Isolated runs taken as each fix landed (quiet machine): till catalogue 318 → 50 ms, refunds 123 → 21 ms,
session 19.5 → 5.6 ms. Database: ~23 queries per product in the till list → 3 queries total; refunds 3 per
refund → 4 total; session 4 sequential queries → 1.

## Web

- First-load JS: /pos/inventory and /admin/inventory 225 → 198 kB (product dialog + cropper load on first open).
- Lighthouse /shop (mobile, median of 3, loaded machine): score 18 → 49, layout shift 1.0 → 0.000,
  blocking time 22 s → 7 s. Cause of the shift: a Suspense boundary streamed the grid in after first paint.
  CLS is 0.000 on /shop, /shop?category=…, and /.
- Lighthouse /: 28 → 30 (within noise). /pos and the PDP were not re-measured on a quiet machine.

## Not done in stage 2b (decisions or follow-ups)

- Server-side paging of /reports/transactions, /orders, /pos/refunds, /pos/cash, /repair/bookings: the
  screens compute totals and exports from the whole list, so paging needs UI changes and server totals.
- Print agent: health checks still queue behind prints (heartbeat.ts).
- The `costs.view` data leak (till reads cost prices client-side for its below-cost warning).
