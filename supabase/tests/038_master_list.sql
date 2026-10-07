-- 038 — the master list (migration 0099)
--
-- Copies of one product in different shops share a master. The website sells the master: the
-- HIGHEST price, COMBINED stock, and an order split into one line per supplying shop (Shop 1's
-- stock first). A product off the master list is till-only.

begin;
set local search_path to public, tap, extensions;
select plan(32);

insert into public.shops (id, name, sort_order)
values ('00000000-0000-0000-0000-000000003890', 'Shop Two', 2);

-- Shop 1's product, at £15, 1 in stock. It joins the master list by default.
insert into public.products (id, slug, name, category, price, cost_price, stock_qty, barcode)
values ('00000000-0000-0000-0000-000000003811', 'master-case', 'Master Case', 'cases', 1500, 500, 1, '5000000003811');

select isnt((select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003811'),
            null, 'a new product joins the master list by default');
select is((select m.slug from public.master_products m join public.products p on p.master_product_id = m.id
            where p.id = '00000000-0000-0000-0000-000000003811'),
          'master-case', 'the master keeps the product''s slug as the public URL');

-- Shop 2 copies it.
select lives_ok(
  $$ select public.copy_master_to_shop(
       (select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003811'),
       '00000000-0000-0000-0000-000000003890') $$,
  'a shop can copy a master product into its own inventory');
select is((select count(*)::int from public.products where master_product_id =
            (select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003811')), 2,
          'the master now has two copies');
select is((select price::int from public.products where shop_id = '00000000-0000-0000-0000-000000003890' and name = 'Master Case'),
          1500, 'the copy starts at the online price');
select is((select stock_qty from public.products where shop_id = '00000000-0000-0000-0000-000000003890' and name = 'Master Case'),
          0, 'and with no stock (each shop counts its own)');
select throws_ok(
  $$ select public.copy_master_to_shop(
       (select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003811'),
       '00000000-0000-0000-0000-000000003890') $$,
  'P0001', 'This shop already has a copy of that master product', 'a shop cannot hold two copies');

-- Shop 2 sets its own price (£20) and gets 1 in stock.
update public.products set price = 2000, stock_qty = 1
 where shop_id = '00000000-0000-0000-0000-000000003890' and name = 'Master Case';

select is(public.online_unit_price('00000000-0000-0000-0000-000000003811')::int, 2000,
          'the website charges the higher of the two prices');
select is((select price::int from public.products where id = '00000000-0000-0000-0000-000000003811'), 1500,
          'while Shop 1 still sells at its own price');
select is(public.online_available_qty('00000000-0000-0000-0000-000000003811'), 2, 'online stock is combined');
select is(public.online_stock_status('00000000-0000-0000-0000-000000003811')::text, 'in-stock', 'in stock online');
select is((select slug from public.online_products where master_id =
            (select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003811')),
          'master-case', 'one online listing per master');
select is((select id from public.online_products where slug = 'master-case'),
          '00000000-0000-0000-0000-000000003811'::uuid, 'represented by Shop 1''s copy');

-- Allocation: Shop 1 first, then Shop 2.
select is((select count(*)::int from public.allocate_online_stock('00000000-0000-0000-0000-000000003811', null, 1)), 1,
          'one unit comes from one shop');
select is((select shop_id from public.products where id =
            (select product_id from public.allocate_online_stock('00000000-0000-0000-0000-000000003811', null, 1))),
          public.default_shop_id(), '...Shop 1''s');
select is((select count(*)::int from public.allocate_online_stock('00000000-0000-0000-0000-000000003811', null, 2)), 2,
          'two units with one in each shop are met together');
select throws_ok(
  $$ select * from public.allocate_online_stock('00000000-0000-0000-0000-000000003811', null, 3) $$,
  'P0001', null, 'more than the shops hold together is refused');

-- An order for 2 splits into one line per shop, at the higher price, and paying takes both stocks.
select lives_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-0000-0000-000000003811","quantity":2}]'::jsonb,
       'collect', null, 'master@example.com', 'M Test', null, null, null, null, null, 0, '07700900000', null) $$,
  'an order the shops can only meet together is accepted');
select is((select count(*)::int from public.order_lines ol join public.orders o on o.id = ol.order_id
            where o.guest_email = 'master@example.com'), 2, 'it becomes one line per shop');
select is((select unit_price::int from public.order_lines ol join public.orders o on o.id = ol.order_id
            where o.guest_email = 'master@example.com' limit 1), 2000, 'each at the higher price');
select is((select subtotal::int from public.orders where guest_email = 'master@example.com'), 4000, 'subtotal is 2 x £20');
update public.orders set status = 'paid' where guest_email = 'master@example.com';
select is((select sum(stock_qty)::int from public.products where name = 'Master Case'), 0,
          'paying takes the stock from both shops');
update public.orders set status = 'cancelled' where guest_email = 'master@example.com';
select is((select sum(stock_qty)::int from public.products where name = 'Master Case'), 2,
          'cancelling puts each unit back in the shop it came from');
select is((select stock_qty from public.products where id = '00000000-0000-0000-0000-000000003811'), 1,
          '...Shop 1''s unit back in Shop 1');

-- A closed shop stops counting online.
update public.shops set is_active = false where id = '00000000-0000-0000-0000-000000003890';
select is(public.online_available_qty('00000000-0000-0000-0000-000000003811'), 1, 'a closed shop''s stock is not for sale online');
select is(public.online_unit_price('00000000-0000-0000-0000-000000003811')::int, 1500, 'nor does its price count');
update public.shops set is_active = true where id = '00000000-0000-0000-0000-000000003890';

-- Off the master list: till-only.
select lives_ok(
  $$ select public.unlink_product_from_master(
       (select id from public.products where shop_id = '00000000-0000-0000-0000-000000003890' and name = 'Master Case')) $$,
  'a shop can take its copy off the master list');
select is(public.online_available_qty('00000000-0000-0000-0000-000000003811'), 1, 'and its stock leaves the website');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000003812', 'till-only', 'Till Only', 'cases', 500, 100, 5);
select public.unlink_product_from_master('00000000-0000-0000-0000-000000003812');
select throws_ok(
  $$ select public.create_order(
       '[{"product_id":"00000000-0000-0000-0000-000000003812","quantity":1}]'::jsonb,
       'collect', null, 'till@example.com', 'T Test', null, null, null, null, null, 0, '07700900000', null) $$,
  'P0001', null, 'a product off the master list cannot be ordered online');

-- Variants are matched across shops by their options.
insert into public.products (id, slug, name, category, price, cost_price, stock_qty, has_variants)
values ('00000000-0000-0000-0000-000000003813', 'master-cover', 'Master Cover', 'cases', 1000, 0, 0, true);
insert into public.product_variants (id, product_id, options, sku, price_adjustment, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000003814', '00000000-0000-0000-0000-000000003813', '{"Colour":"Black"}', 'MC-B', 0, 100, 1);
select public.copy_master_to_shop(
  (select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003813'),
  '00000000-0000-0000-0000-000000003890');
update public.product_variants set stock_qty = 1, price_adjustment = 250
 where product_id = (select id from public.products where shop_id = '00000000-0000-0000-0000-000000003890' and name = 'Master Cover');

select is(public.online_available_qty('00000000-0000-0000-0000-000000003813', '00000000-0000-0000-0000-000000003814'), 2,
          'a variant''s stock is combined across shops by its options');
select is(public.online_unit_price('00000000-0000-0000-0000-000000003813', '00000000-0000-0000-0000-000000003814')::int, 1250,
          'and its price is the highest price + adjustment');
select is((select count(distinct variant_id)::int from public.allocate_online_stock(
            '00000000-0000-0000-0000-000000003813', '00000000-0000-0000-0000-000000003814', 2)), 2,
          'an order for both is met from each shop''s own variant');

select * from finish();
rollback;
