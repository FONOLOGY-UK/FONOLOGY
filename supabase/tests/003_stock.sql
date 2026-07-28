-- 003 — Stock
-- Every scenario here writes real stock_movements against a real seeded
-- product and reads the result back — nothing is asserted from the
-- migration source, only from what the database actually did.
--
-- One test in the spec for this file can't run inside this file at all:
-- two real concurrent sessions racing to sell the last unit. pgTAP tests are
-- one transaction, one connection — there is no way to hold a second,
-- independent session open from inside a single SQL script without an
-- extension like dblink, and dblink's self-connect on this project requires
-- a password in the connection string, which means a credential sitting in
-- a committed file. That's a worse outcome than not automating this one
-- case in the committed suite, so it isn't done that way here.
--
-- It WAS proven for real, external to this file, with two genuine
-- concurrent `pg` client connections against this same database:
--   Session A: BEGIN; stock_consume(product, 1, 'sale')  -- holds the lock
--   Session B: BEGIN; stock_consume(product, 1, 'sale')  -- blocks
--   Session A: COMMIT
--   Session B: unblocks, re-reads the now-committed row, fails with
--              "Not enough stock for product ..." — exactly the message
--              stock_consume raises on a check_violation
--   Final stock_qty: 0. Never negative. Session B's transaction rolled back.
-- What follows here is the closest a single-session proxy gets: proving the
-- FOR UPDATE row lock and the >= 0 check the real proof depends on both
-- exist and are wired together correctly.

begin;
set local search_path to public, tap, extensions;
select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000000301', 'stock-test-widget', 'Stock Test Widget', 'cases', 2000, 0, 3);

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000000302', 'stock-test-empty', 'Stock Test Empty Shelf', 'cases', 2000, 0, 0);

-- ---------------------------------------------------------------------------
-- Selling more than is in stock
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.stock_consume('00000000-0000-0000-0000-000000000301', 5, 'sale') $$,
  null, 'Not enough stock for product 00000000-0000-0000-0000-000000000301',
  'selling 5 when 3 are in stock fails with the friendly not-enough-stock message'
);

select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000301'),
  3,
  'the failed oversell left stock_qty unchanged at 3'
);

select lives_ok(
  $$ select public.stock_consume('00000000-0000-0000-0000-000000000301', 3, 'sale') $$,
  'selling exactly 3 of 3 succeeds'
);
select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000301'),
  0,
  'selling exactly the whole shelf leaves stock_qty at 0'
);

-- ---------------------------------------------------------------------------
-- Concurrency proxy (see header — the real proof is external)
-- ---------------------------------------------------------------------------

select ok(
  pg_get_functiondef('public.apply_stock_movement'::regproc) ~* 'for update',
  'the trigger that applies a movement takes a row lock (FOR UPDATE) on the product — the mechanism the external concurrency proof relies on'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and pg_get_constraintdef(oid) ~* 'stock_qty\s*>=\s*0'
  ),
  'products.stock_qty has a >= 0 check — the second half of the mechanism the external proof relies on'
);

-- ---------------------------------------------------------------------------
-- Movements are immutable
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  update public.stock_movements
     set reason = 'tampered'
   where id = (select id from public.stock_movements where product_id = '00000000-0000-0000-0000-000000000301' limit 1)
  $$,
  null, 'Stock movements cannot be changed or deleted. Add a correction instead.',
  'updating a stock_movements row is refused'
);

select throws_ok(
  $$
  delete from public.stock_movements
   where id = (select id from public.stock_movements where product_id = '00000000-0000-0000-0000-000000000301' limit 1)
  $$,
  null, 'Stock movements cannot be changed or deleted. Add a correction instead.',
  'deleting a stock_movements row is refused'
);

-- ---------------------------------------------------------------------------
-- write_off requires a reason
-- ---------------------------------------------------------------------------

insert into public.stock_movements (product_id, kind, qty_delta, unit_cost)
values ('00000000-0000-0000-0000-000000000302', 'receipt', 10, 100);

select throws_ok(
  $$ select public.stock_consume('00000000-0000-0000-0000-000000000302', 1, 'write_off') $$,
  null, null,
  'a write_off with no reason fails'
);

select lives_ok(
  $$ select public.stock_consume('00000000-0000-0000-0000-000000000302', 1, 'write_off', null, null, null, 'damaged in transit') $$,
  'a write_off with a reason succeeds'
);

-- ---------------------------------------------------------------------------
-- Direction constraints (bypassing the helper functions, straight at the table)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.stock_movements (product_id, kind, qty_delta)
  values ('00000000-0000-0000-0000-000000000302', 'sale', 1)
  $$,
  null, null,
  'a sale movement with a POSITIVE quantity is rejected (sales must be negative)'
);

select throws_ok(
  $$
  insert into public.stock_movements (product_id, kind, qty_delta, unit_cost)
  values ('00000000-0000-0000-0000-000000000302', 'receipt', -1, 100)
  $$,
  null, null,
  'a receipt movement with a NEGATIVE quantity is rejected (receipts must be positive)'
);

-- ---------------------------------------------------------------------------
-- stock_receive can record a positive stocktake correction, reason required
-- ---------------------------------------------------------------------------
-- 0004 originally had no way to pass a reason into stock_receive at all,
-- which meant a 'correction' call could never satisfy
-- stock_movements_reason_required and would always fail — found here, fixed
-- in the migration (p_reason added), tested directly below.

select throws_ok(
  $$ select public.stock_receive('00000000-0000-0000-0000-000000000302', 1, null, 'correction') $$,
  null, null,
  'a positive correction with no reason still fails (the constraint, not just the missing parameter)'
);

select lives_ok(
  $$ select public.stock_receive('00000000-0000-0000-0000-000000000302', 1, null, 'correction', null, null, null, 'recount found one extra') $$,
  'a positive correction with a reason now succeeds, now that stock_receive can carry one'
);

-- ---------------------------------------------------------------------------
-- Weighted average cost — worked by hand
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000000303', 'stock-test-wavg', 'Stock Test Weighted Average', 'cases', 5000, 0, 0);

-- Empty shelf: incoming price becomes the cost outright, no division by zero.
do $$ begin perform public.stock_receive('00000000-0000-0000-0000-000000000303', 10, 400, 'receipt'); end $$;
select is(
  (select cost_price from public.products where id = '00000000-0000-0000-0000-000000000303')::integer,
  400,
  'receiving into an empty shelf sets cost to the incoming price'
);

-- 10 @ 400p already on the shelf, 10 more arrive @ 500p:
-- (10*400 + 10*500) / 20 = (4000 + 5000) / 20 = 9000 / 20 = 450p exactly.
do $$ begin perform public.stock_receive('00000000-0000-0000-0000-000000000303', 10, 500, 'receipt'); end $$;
select is(
  (select cost_price from public.products where id = '00000000-0000-0000-0000-000000000303')::integer,
  450,
  'weighted average after the second delivery is exactly 450p (10@400 + 10@500 over 20 units)'
);

-- 20 @ 450p on the shelf, 5 more arrive @ 300p:
-- (20*450 + 5*300) / 25 = (9000 + 1500) / 25 = 10500 / 25 = 420p exactly.
do $$ begin perform public.stock_receive('00000000-0000-0000-0000-000000000303', 5, 300, 'receipt'); end $$;
select is(
  (select cost_price from public.products where id = '00000000-0000-0000-0000-000000000303')::integer,
  420,
  'weighted average after the third delivery is exactly 420p (20@450 + 5@300 over 25 units)'
);

-- Cost does not move on an outbound movement.
do $$ begin perform public.stock_consume('00000000-0000-0000-0000-000000000303', 5, 'sale'); end $$;
select is(
  (select cost_price from public.products where id = '00000000-0000-0000-0000-000000000303')::integer,
  420,
  'selling stock does not change cost_price — cost only moves on inbound movements'
);
select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000303'),
  20,
  'the sale of 5 correctly reduced stock_qty from 25 to 20'
);

-- ---------------------------------------------------------------------------
-- Repair parts consume stock and record the movement kind
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000000304', 'walk_in', 'Stock Test Customer', 'Test Phone', 'Test fault');

do $$ begin perform public.add_job_part('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000303', 2, null); end $$;

select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000303'),
  18,
  'adding a job part consumed exactly the quantity fitted (20 -> 18)'
);
select ok(
  exists (
    select 1 from public.stock_movements
    where product_id = '00000000-0000-0000-0000-000000000303'
      and kind = 'repair_part' and qty_delta = -2
  ),
  'the job part consumption wrote a repair_part movement for the right quantity'
);

-- ---------------------------------------------------------------------------
-- A refund with restock increases stock
-- ---------------------------------------------------------------------------

do $$ begin perform public.stock_receive('00000000-0000-0000-0000-000000000303', 3, null, 'refund_restock'); end $$;
select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000303'),
  21,
  'a refund_restock movement increases stock by the returned quantity'
);

-- ---------------------------------------------------------------------------
-- The running total always equals the sum of its own history
-- ---------------------------------------------------------------------------
-- Product 303 has had a scripted run of mixed movements above (three
-- receipts, a sale, a repair-part consumption, a restock — six so far);
-- add enough more to comfortably clear "twenty mixed movements" and check
-- the invariant holds against the ledger, not against arithmetic reasoned
-- about by eye.

do $$
begin
  perform public.stock_receive('00000000-0000-0000-0000-000000000303', 4, 410, 'receipt');
  perform public.stock_consume('00000000-0000-0000-0000-000000000303', 1, 'sale');
  perform public.stock_consume('00000000-0000-0000-0000-000000000303', 1, 'sale');
  perform public.stock_receive('00000000-0000-0000-0000-000000000303', 2, 415, 'buy_in');
  perform public.stock_consume('00000000-0000-0000-0000-000000000303', 1, 'online_order');
  perform public.add_job_part('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000303', 1, null);
  perform public.stock_receive('00000000-0000-0000-0000-000000000303', 1, null, 'refund_restock');
  perform public.stock_consume('00000000-0000-0000-0000-000000000303', 1, 'write_off', null, null, null, 'dropped on the floor');
  perform public.stock_receive('00000000-0000-0000-0000-000000000303', 5, null, 'correction', null, null, null, 'stocktake found 5 more than expected');
  perform public.stock_consume('00000000-0000-0000-0000-000000000303', 2, 'sale');
  perform public.stock_receive('00000000-0000-0000-0000-000000000303', 3, 420, 'receipt');
  perform public.stock_consume('00000000-0000-0000-0000-000000000303', 3, 'sale');
  perform public.stock_receive('00000000-0000-0000-0000-000000000303', 6, 405, 'receipt');
  perform public.stock_consume('00000000-0000-0000-0000-000000000303', 2, 'online_order');
end $$;

select ok(
  (select count(*) from public.stock_movements where product_id = '00000000-0000-0000-0000-000000000303') >= 20,
  'at least twenty movements have now been recorded against the test product'
);

select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000303'),
  (select coalesce(sum(qty_delta), 0)::integer
   from public.stock_movements where product_id = '00000000-0000-0000-0000-000000000303'),
  'products.stock_qty equals the sum of that product''s own movement history after twenty-plus mixed movements'
);

select * from finish();
rollback;
