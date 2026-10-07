-- 042 — Goods in (migration 0103, Log A)
-- A delivery booked in at the till raises stock through receipt movements, is
-- numbered per shop, stays in the person's own shop, keeps the cost when none is
-- entered, and can never be edited or deleted.

begin;
set local search_path to public, tap, extensions;
select plan(18);

insert into public.shops (id, name, sort_order)
values ('00000000-0000-0000-0000-000000004290', 'Shop Two', 2);

insert into public.user_accounts (id, email) values
  ('00000000-0000-0000-0000-000000004201', 'gin-a@example.com'),
  ('00000000-0000-0000-0000-000000004202', 'gin-b@example.com'),
  ('00000000-0000-0000-0000-000000004203', 'gin-own@example.com');
insert into public.staff (id, email, name, role, shop_id) values
  ('00000000-0000-0000-0000-000000004201', 'gin-a@example.com', 'Cashier A', 'employee', public.default_shop_id()),
  ('00000000-0000-0000-0000-000000004202', 'gin-b@example.com', 'Cashier B', 'employee', '00000000-0000-0000-0000-000000004290'),
  ('00000000-0000-0000-0000-000000004203', 'gin-own@example.com', 'Owner', 'owner', null);

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, shop_id, is_active, has_variants) values
  ('00000000-0000-0000-0000-000000004211', 'gin-a',       'Gin A',       'cases', 1000, 100, 5, public.default_shop_id(), true,  false),
  ('00000000-0000-0000-0000-000000004212', 'gin-b',       'Gin B',       'cases', 1000, 100, 5, '00000000-0000-0000-0000-000000004290', true, false),
  ('00000000-0000-0000-0000-000000004213', 'gin-retired', 'Gin Retired', 'cases', 1000, 100, 0, public.default_shop_id(), false, false),
  ('00000000-0000-0000-0000-000000004214', 'gin-colours', 'Gin Colours', 'cases', 1000, 100, 0, public.default_shop_id(), true,  true);
insert into public.product_variants (id, product_id, options, sku, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000004215', '00000000-0000-0000-0000-000000004214', '{"Colour": "Red"}', 'GIN-RED', 50, 0);

-- ---------------------------------------------------------------------------
-- Booking a delivery in
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.record_stock_intake('00000000-0000-0000-0000-000000004201',
       '[{"product_id":"00000000-0000-0000-0000-000000004211","qty":3,"unit_cost":120}]'::jsonb,
       'Acme Parts', 'INV-1', 'two boxes') $$,
  'a cashier books a delivery in at their own shop');

select is((select stock_qty from public.products where id = '00000000-0000-0000-0000-000000004211'), 8,
  'the delivery raised the stock');
select is((select cost_price::integer from public.products where id = '00000000-0000-0000-0000-000000004211'), 120,
  'the unit cost entered becomes the cost price');
select matches((select reference from public.stock_intakes where supplier_ref = 'INV-1'), '^GIN-[0-9]+$',
  'a hub delivery is numbered GIN-');
select is(
  (select count(*)::integer from public.stock_movements
    where product_id = '00000000-0000-0000-0000-000000004211' and kind = 'receipt' and source_type = 'stock_intake'),
  1, 'it moved stock as one receipt, sourced to the goods-in record');
select is((select count(*)::integer from public.suppliers where lower(name) = 'acme parts'), 1,
  'a new supplier name creates the supplier');

select public.record_stock_intake('00000000-0000-0000-0000-000000004201',
  '[{"product_id":"00000000-0000-0000-0000-000000004211","qty":1}]'::jsonb, 'ACME parts', 'INV-2');
select is((select count(*)::integer from public.suppliers where lower(name) = 'acme parts'), 1,
  'the same supplier typed differently is matched, not duplicated');
select is((select unit_cost::integer from public.stock_intake_lines l join public.stock_intakes i on i.id = l.intake_id
            where i.supplier_ref = 'INV-2'), 120,
  'a line with no cost is recorded at the current cost');
select is((select cost_price::integer from public.products where id = '00000000-0000-0000-0000-000000004211'), 120,
  'and the cost price is not zeroed');

select public.record_stock_intake('00000000-0000-0000-0000-000000004201',
  '[{"product_id":"00000000-0000-0000-0000-000000004214","variant_id":"00000000-0000-0000-0000-000000004215","qty":4,"unit_cost":60}]'::jsonb);
select is((select stock_qty from public.product_variants where id = '00000000-0000-0000-0000-000000004215'), 4,
  'a variant delivery raises that variant');

select public.record_stock_intake('00000000-0000-0000-0000-000000004202',
  '[{"product_id":"00000000-0000-0000-0000-000000004212","qty":2,"unit_cost":90}]'::jsonb, null, 'S2-INV');
select matches((select reference from public.stock_intakes where supplier_ref = 'S2-INV'), '^F02-GIN-[0-9]+$',
  'another shop''s delivery carries its shop code');

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.record_stock_intake('00000000-0000-0000-0000-000000004202',
       '[{"product_id":"00000000-0000-0000-0000-000000004211","qty":1}]'::jsonb) $$,
  'P0001', 'Product 00000000-0000-0000-0000-000000004211 belongs to another shop',
  'a Shop 2 cashier cannot book stock into a Shop 1 product');
select throws_ok(
  $$ select public.record_stock_intake('00000000-0000-0000-0000-000000004203',
       '[{"product_id":"00000000-0000-0000-0000-000000004211","qty":1}]'::jsonb) $$,
  'P0001', 'This account is not assigned to a shop, so it cannot book stock in',
  'an owner with no shop cannot book stock in');
select throws_ok(
  $$ select public.record_stock_intake('00000000-0000-0000-0000-000000004201',
       '[{"product_id":"00000000-0000-0000-0000-000000004213","qty":1}]'::jsonb) $$,
  'P0001', '"Gin Retired" has been retired — restore it before booking stock in',
  'a retired product cannot take a delivery');
select throws_ok(
  $$ select public.record_stock_intake('00000000-0000-0000-0000-000000004201',
       '[{"product_id":"00000000-0000-0000-0000-000000004214","qty":1}]'::jsonb) $$,
  'P0001', 'Choose which option of "Gin Colours" arrived',
  'a product with options needs the option that arrived');
select throws_ok(
  $$ select public.record_stock_intake('00000000-0000-0000-0000-000000004201', '[]'::jsonb) $$,
  'P0001', 'A delivery needs at least one line',
  'an empty delivery is refused');

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.stock_intakes set notes = 'edited' where supplier_ref = 'INV-1' $$,
  'P0001', 'Goods-in records cannot be changed or deleted. Book a correction on the product instead.',
  'a goods-in record cannot be edited');
select throws_ok(
  $$ delete from public.stock_intake_lines $$,
  'P0001', 'Goods-in records cannot be changed or deleted. Book a correction on the product instead.',
  'a goods-in line cannot be deleted');

select * from finish();
rollback;
