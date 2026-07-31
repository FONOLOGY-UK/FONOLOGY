-- 0025 — Batched stock status lookup
--
-- `GET /products` built its response with one `stock_status_for()` RPC and one
-- product_images query PER PRODUCT. At 44 active products that is 88 separate
-- HTTP round trips to the database for a single storefront page load, fired
-- concurrently through one `Promise.all`.
--
-- That is slow on a good day and broken on a bad one: if any single one of the
-- 88 fails, `Promise.all` rejects and the whole request dies. It was observed
-- failing repeatedly under ordinary network latency.
--
-- This function answers the same question for many products in one round trip.
-- It CALLS the existing `stock_status_for()` rather than reimplementing the
-- restocking/out-of-stock rule, so there is exactly one definition of what a
-- stock status means and this cannot drift from it.
--
-- Additive: nothing existing is altered, and `stock_status_for()` is untouched.

-- Same shape as stock_status_for() beside it: plain `stable sql`, no
-- security definer, default grants. The API reaches it with the service-role
-- key like every other call, and RLS stays deny-all for everyone else.
create or replace function public.stock_status_for_many(p_product_ids uuid[])
returns table (product_id uuid, status public.stock_status)
language sql
stable
as $$
  select p.id, public.stock_status_for(p.id)
  from public.products p
  where p.id = any(p_product_ids);
$$;

comment on function public.stock_status_for_many(uuid[]) is
  'Stock status for many products in one round trip. Delegates to stock_status_for() so the rule lives in exactly one place. Added in 0025 to remove an N+1 in GET /products.';
