-- 042 — Goods in (migration 0103, Log A; reshaped by 0108)
-- Since 0108 a delivery is a record of typed items (name + quantity, not linked to products) and
-- one optional price for the whole delivery: booking it in moves no stock. It is numbered per
-- shop, stays in the person's own shop, matches its supplier, and can never be edited or deleted.

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

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, shop_id) values
  ('00000000-0000-0000-0000-000000004211', 'gin-a', 'Gin A', 'cases', 1000, 100, 5, public.default_shop_id());

-- ---------------------------------------------------------------------------
-- Booking a delivery in
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.record_goods_in('00000000-0000-0000-0000-000000004201',
       '[{"name":"iPhone 13 screens","qty":10},{"name":"USB-C cables","qty":25}]'::jsonb,
       12550, 'Acme Parts', 'INV-1', 'two boxes') $$,
  'a cashier books a delivery in at their own shop');

select is(
  (select count(*)::integer from public.stock_intake_lines l join public.stock_intakes i on i.id = l.intake_id
    where i.supplier_ref = 'INV-1'),
  2, 'every typed item is a line');
select is(
  (select string_agg(l.item_name || ' x' || l.qty, ', ' order by l.item_name)
     from public.stock_intake_lines l join public.stock_intakes i on i.id = l.intake_id
    where i.supplier_ref = 'INV-1'),
  'iPhone 13 screens x10, USB-C cables x25', 'with its name and quantity');
select is((select total_price::integer from public.stock_intakes where supplier_ref = 'INV-1'), 12550,
  'the delivery keeps its one price');
select is((select notes from public.stock_intakes where supplier_ref = 'INV-1'), 'two boxes',
  'and its notes');
select matches((select reference from public.stock_intakes where supplier_ref = 'INV-1'), '^GIN-[0-9]+$',
  'a hub delivery is numbered GIN-');
select is((select stock_qty from public.products where id = '00000000-0000-0000-0000-000000004211'), 5,
  'booking a delivery in moves no stock — the items are not linked to products');
select is((select count(*)::integer from public.suppliers where lower(name) = 'acme parts'), 1,
  'a new supplier name creates the supplier');

select public.record_goods_in('00000000-0000-0000-0000-000000004201',
  '[{"name":"Cases","qty":1}]'::jsonb, null, 'ACME parts', null);
select is((select count(*)::integer from public.suppliers where lower(name) = 'acme parts'), 1,
  'the same supplier typed differently is matched, not duplicated');
select ok(
  exists (select 1 from public.stock_intakes where supplier_name = 'ACME parts'
            and supplier_ref is null and total_price is null),
  'the reference and the price are optional');

select public.record_goods_in('00000000-0000-0000-0000-000000004202',
  '[{"name":"Chargers","qty":2}]'::jsonb, 900, null, 'S2-INV');
select matches((select reference from public.stock_intakes where supplier_ref = 'S2-INV'), '^F02-GIN-[0-9]+$',
  'another shop''s delivery carries its shop code');
select is((select shop_id from public.stock_intakes where supplier_ref = 'S2-INV'),
  '00000000-0000-0000-0000-000000004290'::uuid, 'and is filed under that shop');

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.record_goods_in('00000000-0000-0000-0000-000000004203', '[{"name":"x","qty":1}]'::jsonb) $$,
  'P0001', 'This account is not assigned to a shop, so it cannot book a delivery in',
  'an owner with no shop cannot book a delivery in');
select throws_ok(
  $$ select public.record_goods_in('00000000-0000-0000-0000-000000004201', '[]'::jsonb) $$,
  'P0001', 'Add at least one item',
  'an empty delivery is refused');
select throws_ok(
  $$ select public.record_goods_in('00000000-0000-0000-0000-000000004201', '[{"name":" ","qty":1}]'::jsonb) $$,
  'P0001', 'Every item needs a name',
  'an item needs a name');
select throws_ok(
  $$ select public.record_goods_in('00000000-0000-0000-0000-000000004201', '[{"name":"Screens","qty":0}]'::jsonb) $$,
  'P0001', 'The quantity for "Screens" must be a positive number',
  'a quantity must be positive');

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
