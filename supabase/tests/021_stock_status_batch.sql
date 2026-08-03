-- 021 — Batched stock status (migration 0025)
--
-- GET /products used to call stock_status_for() once per product — 88 round
-- trips for 44 products, all through one Promise.all, so a single failure
-- anywhere took the whole page down. stock_status_for_many() answers the
-- same question for many products in one round trip by delegating to the
-- existing single-product function, so there is exactly one definition of
-- what a stock status means.
--
-- The only thing worth proving here is that delegation: the batched path
-- must return the identical answer the single-product path already gives,
-- for every branch stock_status_for() has — in stock, restocking (a receipt
-- within 30 days but currently empty), and out of stock (empty, no recent
-- receipt).

begin;
set local search_path to public, tap, extensions;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures — one product per branch of stock_status_for()
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values
  ('00000000-0000-0000-0000-000000002101', 'batch-in-stock', 'Batch In Stock', 'cases', 2000, 500, 5),
  ('00000000-0000-0000-0000-000000002102', 'batch-restocking', 'Batch Restocking', 'cases', 2000, 500, 0),
  ('00000000-0000-0000-0000-000000002103', 'batch-out-of-stock', 'Batch Out Of Stock', 'cases', 2000, 500, 0);

-- A receipt in the last 30 days on the empty "restocking" product, and
-- nothing at all on the empty "out of stock" one — the exact distinction
-- stock_status_for() draws.
insert into public.stock_movements (product_id, kind, qty_delta, unit_cost)
values ('00000000-0000-0000-0000-000000002102', 'receipt', 3, 500);

update public.products set stock_qty = 0 where id = '00000000-0000-0000-0000-000000002102';

-- ---------------------------------------------------------------------------
-- Each product's batched answer matches its own single-product answer
-- ---------------------------------------------------------------------------

select is(
  (select status from public.stock_status_for_many(array['00000000-0000-0000-0000-000000002101'::uuid])),
  public.stock_status_for('00000000-0000-0000-0000-000000002101'),
  'in-stock product: batched answer matches the single-product function'
);

select is(
  (select status from public.stock_status_for_many(array['00000000-0000-0000-0000-000000002101'::uuid])),
  'in-stock'::stock_status,
  'in-stock product: the answer really is in-stock, not just internally consistent'
);

select is(
  (select status from public.stock_status_for_many(array['00000000-0000-0000-0000-000000002102'::uuid])),
  public.stock_status_for('00000000-0000-0000-0000-000000002102'),
  'restocking product: batched answer matches the single-product function'
);

select is(
  (select status from public.stock_status_for_many(array['00000000-0000-0000-0000-000000002102'::uuid])),
  'restocking'::stock_status,
  'restocking product: the answer really is restocking, not just internally consistent'
);

select is(
  (select status from public.stock_status_for_many(array['00000000-0000-0000-0000-000000002103'::uuid])),
  public.stock_status_for('00000000-0000-0000-0000-000000002103'),
  'out-of-stock product: batched answer matches the single-product function'
);

select is(
  (select status from public.stock_status_for_many(array['00000000-0000-0000-0000-000000002103'::uuid])),
  'out-of-stock'::stock_status,
  'out-of-stock product: the answer really is out-of-stock, not just internally consistent'
);

-- ---------------------------------------------------------------------------
-- Asked together, all three come back in one call, each correct — proving
-- the batching itself (not just that the delegation is correct in isolation)
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.stock_status_for_many(array[
     '00000000-0000-0000-0000-000000002101'::uuid,
     '00000000-0000-0000-0000-000000002102'::uuid,
     '00000000-0000-0000-0000-000000002103'::uuid
   ])),
  3::bigint,
  'asking for all three products in one call returns exactly three rows'
);

select is(
  (select status from public.stock_status_for_many(array[
     '00000000-0000-0000-0000-000000002101'::uuid,
     '00000000-0000-0000-0000-000000002102'::uuid,
     '00000000-0000-0000-0000-000000002103'::uuid
   ]) where product_id = '00000000-0000-0000-0000-000000002101'),
  'in-stock'::stock_status,
  'in the batched three-product call, product 2101 is still correctly in-stock'
);

select is(
  (select status from public.stock_status_for_many(array[
     '00000000-0000-0000-0000-000000002101'::uuid,
     '00000000-0000-0000-0000-000000002102'::uuid,
     '00000000-0000-0000-0000-000000002103'::uuid
   ]) where product_id = '00000000-0000-0000-0000-000000002103'),
  'out-of-stock'::stock_status,
  'in the batched three-product call, product 2103 is still correctly out-of-stock — not shadowed by its neighbours'
);

select * from finish();
rollback;
