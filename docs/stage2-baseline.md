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
