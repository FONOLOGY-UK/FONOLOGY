-- 036 — shops (migrations 0095, 0096)
--
-- Shop 1 exists and is the only hub; every till-owned table carries a shop_id that
-- is filled and indexed; "one per business" uniqueness became "one per shop"; a
-- variant takes its product's shop; the manager role exists.

begin;
set local search_path to public, tap, extensions;
select plan(21);

select is((select count(*)::int from public.shops where is_fulfilment_hub), 1, 'exactly one hub shop');
select is((select code from public.shops where is_fulfilment_hub), 'S1', 'the hub is Shop 1');
select is(public.default_shop_id(), (select id from public.shops where code = 'S1'), 'default_shop_id() is Shop 1');

select throws_ok(
  $$ insert into public.shops (code, name, is_fulfilment_hub) values ('S9', 'Second hub', true) $$,
  '23505', null, 'a second hub is refused');
select throws_ok(
  $$ insert into public.shops (code, name) values ('s 2', 'Bad code') $$,
  '23514', null, 'a shop code must be 1-6 upper-case letters or digits');

select is_empty(
  $$
  select t.table_name from (values
    ('staff'),('products'),('product_variants'),('stock_movements'),('sales'),('refunds'),('jobs'),
    ('job_payments'),('bookings'),('repair_enquiries'),('sell_requests'),('trade_in_payouts'),
    ('cash_entries'),('day_close'),('print_agents'),('print_jobs')
  ) as t(table_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'shop_id')
  $$,
  'every till-owned table has a shop_id');

select is_empty(
  $$
  select c.table_name from information_schema.columns c
  where c.table_schema = 'public' and c.column_name = 'shop_id'
    and c.table_name <> 'staff'
    and c.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
    and c.is_nullable = 'YES'
  $$,
  'shop_id is NOT NULL everywhere except staff (owners are global)');

select is_empty(
  $$ select p.id from public.promotions p
     where not exists (select 1 from public.promotion_shops ps where ps.promotion_id = p.id) $$,
  'every existing promotion runs in Shop 1 after the backfill');

-- staff: an employee or manager must have a shop, an owner need not.
insert into public.user_accounts (id, email) values
  ('00000000-0000-0000-0000-000000003601', 'shops-emp@example.com'),
  ('00000000-0000-0000-0000-000000003602', 'shops-own@example.com'),
  ('00000000-0000-0000-0000-000000003603', 'shops-mgr@example.com');

select throws_ok(
  $$ insert into public.staff (id, email, name, role, shop_id)
     values ('00000000-0000-0000-0000-000000003601', 'shops-emp@example.com', 'Emp', 'employee', null) $$,
  '23514', null, 'an employee without a shop is refused');
select lives_ok(
  $$ insert into public.staff (id, email, name, role, shop_id)
     values ('00000000-0000-0000-0000-000000003602', 'shops-own@example.com', 'Own', 'owner', null) $$,
  'an owner without a shop is allowed');
select lives_ok(
  $$ insert into public.staff (id, email, name, role)
     values ('00000000-0000-0000-0000-000000003603', 'shops-mgr@example.com', 'Mgr', 'manager') $$,
  'a manager can be created');
select is((select shop_id from public.staff where id = '00000000-0000-0000-0000-000000003603'),
          public.default_shop_id(), 'a new manager is in Shop 1 by default');

-- A second shop for the per-shop uniqueness checks.
insert into public.shops (id, code, name, sort_order)
values ('00000000-0000-0000-0000-000000003690', 'S2', 'Shop Two', 2);

-- day close: one per shop per day
insert into public.day_close (trading_day, shop_id, expected_amount, counted_amount, staff_id)
values ('2030-01-01', public.default_shop_id(), 0, 0, '00000000-0000-0000-0000-000000003603');
select lives_ok(
  $$ insert into public.day_close (trading_day, shop_id, expected_amount, counted_amount, staff_id)
     values ('2030-01-01', '00000000-0000-0000-0000-000000003690', 0, 0, '00000000-0000-0000-0000-000000003603') $$,
  'two shops can each close the same day');
select throws_ok(
  $$ insert into public.day_close (trading_day, shop_id, expected_amount, counted_amount, staff_id)
     values ('2030-01-01', public.default_shop_id(), 0, 0, '00000000-0000-0000-0000-000000003603') $$,
  '23505', null, 'the same shop cannot close the same day twice');

-- products: same barcode in two shops is fine, twice in one is not
insert into public.products (id, slug, name, category, price, cost_price, stock_qty, barcode, shop_id)
values ('00000000-0000-0000-0000-000000003611', 'shops-a', 'Shops A', 'cases', 1000, 100, 1, '5000000000017', public.default_shop_id());
select lives_ok(
  $$ insert into public.products (slug, name, category, price, cost_price, stock_qty, barcode, shop_id)
     values ('shops-a-s2', 'Shops A (S2)', 'cases', 1000, 100, 1, '5000000000017', '00000000-0000-0000-0000-000000003690') $$,
  'the same barcode can exist in two shops');
select throws_ok(
  $$ insert into public.products (slug, name, category, price, cost_price, stock_qty, barcode, shop_id)
     values ('shops-a-dup', 'Dup', 'cases', 1000, 100, 1, '5000000000017', public.default_shop_id()) $$,
  '23505', null, 'the same barcode twice in one shop is refused');

-- variants take their product's shop
insert into public.products (id, slug, name, category, price, cost_price, stock_qty, has_variants, shop_id)
values ('00000000-0000-0000-0000-000000003612', 'shops-v', 'Shops V', 'cases', 1000, 0, 0, true, '00000000-0000-0000-0000-000000003690');
insert into public.product_variants (id, product_id, options, sku, stock_qty, cost_price)
values ('00000000-0000-0000-0000-000000003613', '00000000-0000-0000-0000-000000003612', '{"Colour":"Red"}', 'SHOPS-V-R', 1, 100);
select is((select shop_id from public.product_variants where id = '00000000-0000-0000-0000-000000003613'),
          '00000000-0000-0000-0000-000000003690'::uuid, 'a variant takes its product''s shop');

-- float: one opening float per shop per day
insert into public.cash_entries (kind, amount, note, trading_day, staff_id, shop_id)
values ('float_open', 10000, 'float', '2030-01-02', '00000000-0000-0000-0000-000000003603', public.default_shop_id());
select lives_ok(
  $$ insert into public.cash_entries (kind, amount, note, trading_day, staff_id, shop_id)
     values ('float_open', 10000, 'float', '2030-01-02', '00000000-0000-0000-0000-000000003603', '00000000-0000-0000-0000-000000003690') $$,
  'each shop opens its own float on the same day');
select throws_ok(
  $$ insert into public.cash_entries (kind, amount, note, trading_day, staff_id, shop_id)
     values ('float_open', 10000, 'float', '2030-01-02', '00000000-0000-0000-0000-000000003603', public.default_shop_id()) $$,
  '23505', null, 'a shop cannot open its float twice in a day');

select ok(
  'returns.manage' = any (public.default_permissions('manager')) and 'staff.manage' <> all (public.default_permissions('manager')),
  'a manager starts with returns and reports but not staff management'
);
select ok(
  public.default_permissions('employee') <@ public.default_permissions('manager'),
  'a manager starts with everything an employee has'
);

select * from finish();
rollback;
