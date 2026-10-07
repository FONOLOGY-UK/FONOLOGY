-- 039 — per-shop references (0100; the numbering itself since 0106) and multi-shop promotions

begin;
set local search_path to public, tap, extensions;
select plan(14);

insert into public.shops (id, name, sort_order) values ('00000000-0000-0000-0000-000000003990', 'Shop Two', 2);
insert into public.shops (id, name, sort_order) values ('00000000-0000-0000-0000-000000003991', 'Shop Three', 3);

insert into public.user_accounts (id, email) values
  ('00000000-0000-0000-0000-000000003901', 'ref-a@example.com'),
  ('00000000-0000-0000-0000-000000003902', 'ref-b@example.com');
insert into public.staff (id, email, name, role, shop_id) values
  ('00000000-0000-0000-0000-000000003901', 'ref-a@example.com', 'Cashier A', 'employee', public.default_shop_id()),
  ('00000000-0000-0000-0000-000000003902', 'ref-b@example.com', 'Cashier B', 'employee', '00000000-0000-0000-0000-000000003990');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, shop_id) values
  ('00000000-0000-0000-0000-000000003911', 'ref-a', 'Ref A', 'cases', 1000, 100, 5, public.default_shop_id()),
  ('00000000-0000-0000-0000-000000003912', 'ref-b', 'Ref B', 'cases', 1000, 100, 5, '00000000-0000-0000-0000-000000003990');

-- ---------------------------------------------------------------------------
-- References
-- ---------------------------------------------------------------------------

select public.complete_sale('00000000-0000-0000-0000-000000003901',
  '[{"product_id":"00000000-0000-0000-0000-000000003911","quantity":1,"unit_price":1000}]'::jsonb,
  '[{"tender":"cash","amount":1000}]'::jsonb);
select public.complete_sale('00000000-0000-0000-0000-000000003902',
  '[{"product_id":"00000000-0000-0000-0000-000000003912","quantity":1,"unit_price":1000}]'::jsonb,
  '[{"tender":"cash","amount":1000}]'::jsonb);

select matches((select reference from public.sales where staff_id = '00000000-0000-0000-0000-000000003901'),
               '^F01-SAL-\d{9}$', 'the hub''s receipts carry F01');
select matches((select reference from public.sales where staff_id = '00000000-0000-0000-0000-000000003902'),
               '^F02-SAL-\d{9}$', 'another shop''s receipts carry its code');

select public.create_refund('00000000-0000-0000-0000-000000003902', 1000, 'cash', 'changed mind', '[]'::jsonb,
  (select id from public.sales where staff_id = '00000000-0000-0000-0000-000000003902'));
select matches((select reference from public.refunds where staff_id = '00000000-0000-0000-0000-000000003902'),
               '^F02-REF-\d{9}$', 'a refund paid out at another shop carries its code');

insert into public.jobs (source, customer_name, device_description, problem_description, shop_id) values
  ('walk_in', 'Ref Job 1', 'Phone', 'Screen', public.default_shop_id()),
  ('walk_in', 'Ref Job 2', 'Phone', 'Screen', '00000000-0000-0000-0000-000000003990');
select matches((select reference from public.jobs where customer_name = 'Ref Job 1'), '^F01-JOB-\d{9}$',
               'the hub''s jobs carry F01');
select matches((select reference from public.jobs where customer_name = 'Ref Job 2'), '^F02-JOB-\d{9}$',
               'another shop''s jobs carry its code');

insert into public.trade_in_payouts (device_label, customer_name, amount, method, staff_id, shop_id)
values ('Phone', 'Ref Seller', -5000, 'cash', '00000000-0000-0000-0000-000000003902', '00000000-0000-0000-0000-000000003990');
select matches((select reference from public.trade_in_payouts where customer_name = 'Ref Seller'), '^F02-PAY-\d{9}$',
               'and so do its trade-in payouts');

select is((select count(distinct reference)::int from public.reference_registry
            where reference in ((select reference from public.jobs where customer_name = 'Ref Job 1'),
                                (select reference from public.jobs where customer_name = 'Ref Job 2'))), 2,
          'every reference is recorded in the registry');

-- ---------------------------------------------------------------------------
-- A promotion that runs in two shops
-- ---------------------------------------------------------------------------

select public.copy_master_to_shop(
  (select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003911'),
  '00000000-0000-0000-0000-000000003990');
select public.copy_master_to_shop(
  (select master_product_id from public.products where id = '00000000-0000-0000-0000-000000003911'),
  '00000000-0000-0000-0000-000000003991');

select lives_ok(
  $$ select public.upsert_promotion_group(
       array['00000000-0000-0000-0000-000000003911',
             (select id from public.products where name = 'Ref A' and shop_id = '00000000-0000-0000-0000-000000003990')::text]::uuid[],
       '[{"minQty":2,"unitPrice":800}]'::jsonb, null, '2 for less', true, null, null, null, null,
       array[public.default_shop_id(), '00000000-0000-0000-0000-000000003990']) $$,
  'one promotion can cover each chosen shop''s own copy');
select is((select count(*)::int from public.promotions where label = '2 for less'), 2, 'two product rows');
select is((select count(distinct shop_id)::int from public.promotion_shops ps
            join public.promotions p on p.id = ps.promotion_id where p.label = '2 for less'), 2,
          'running in two shops');
select throws_ok(
  $$ select public.upsert_promotion_group(
       array['00000000-0000-0000-0000-000000003911',
             (select id from public.products where name = 'Ref A' and shop_id = '00000000-0000-0000-0000-000000003991')::text]::uuid[],
       '[{"minQty":2,"unitPrice":800}]'::jsonb, null, 'sneaky', true, null, null, null, null,
       array[public.default_shop_id(), '00000000-0000-0000-0000-000000003990']) $$,
  'P0001', null, 'a product from a shop outside the chosen set is refused');
select is(public.resolve_sale_unit_price('00000000-0000-0000-0000-000000003911', 2)::int, 800,
          'the deal prices Shop 1''s copy');
select is(public.resolve_sale_unit_price(
            (select id from public.products where name = 'Ref A' and shop_id = '00000000-0000-0000-0000-000000003990'), 2)::int,
          800, 'and Shop 2''s copy');
select is(public.resolve_sale_unit_price(
            (select id from public.products where name = 'Ref A' and shop_id = '00000000-0000-0000-0000-000000003991'), 2)::int,
          1000, 'but not Shop 3''s, where it does not run');

select * from finish();
rollback;
