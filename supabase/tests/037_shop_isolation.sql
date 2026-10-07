-- 037 — shop isolation (migration 0097)
--
-- A cashier in one shop cannot sell, pay, refund-restock or print against another
-- shop's rows; reports, card limits and the print queue are per shop; refunds
-- remember both the shop that paid out and the shop of the original sale.

begin;
set local search_path to public, tap, extensions;
select plan(22);

-- Two shops (Shop 1 already exists), one cashier in each, one owner with no shop.
insert into public.shops (id, name, sort_order)
values ('00000000-0000-0000-0000-000000003790', 'Shop Two', 2);

insert into public.user_accounts (id, email) values
  ('00000000-0000-0000-0000-000000003701', 'iso-a@example.com'),
  ('00000000-0000-0000-0000-000000003702', 'iso-b@example.com'),
  ('00000000-0000-0000-0000-000000003703', 'iso-own@example.com');
insert into public.staff (id, email, name, role, shop_id) values
  ('00000000-0000-0000-0000-000000003701', 'iso-a@example.com', 'Cashier A', 'employee', public.default_shop_id()),
  ('00000000-0000-0000-0000-000000003702', 'iso-b@example.com', 'Cashier B', 'employee', '00000000-0000-0000-0000-000000003790'),
  ('00000000-0000-0000-0000-000000003703', 'iso-own@example.com', 'Owner', 'owner', null);

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, shop_id) values
  ('00000000-0000-0000-0000-000000003711', 'iso-a', 'Iso A', 'cases', 1000, 100, 5, public.default_shop_id()),
  ('00000000-0000-0000-0000-000000003712', 'iso-b', 'Iso B', 'cases', 1000, 100, 5, '00000000-0000-0000-0000-000000003790');

-- ---------------------------------------------------------------------------
-- Selling
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.complete_sale('00000000-0000-0000-0000-000000003702',
       '[{"product_id":"00000000-0000-0000-0000-000000003711","quantity":1,"unit_price":1000}]'::jsonb,
       '[{"tender":"cash","amount":1000}]'::jsonb) $$,
  'P0001', 'Product 00000000-0000-0000-0000-000000003711 belongs to another shop',
  'a Shop 2 cashier cannot sell a Shop 1 product');

select throws_ok(
  $$ select public.complete_sale('00000000-0000-0000-0000-000000003703',
       '[{"product_id":"00000000-0000-0000-0000-000000003711","quantity":1,"unit_price":1000}]'::jsonb,
       '[{"tender":"cash","amount":1000}]'::jsonb) $$,
  'P0001', null, 'an account with no shop cannot ring up a sale');

select lives_ok(
  $$ select public.complete_sale('00000000-0000-0000-0000-000000003702',
       '[{"product_id":"00000000-0000-0000-0000-000000003712","quantity":2,"unit_price":1000}]'::jsonb,
       '[{"tender":"cash","amount":2000}]'::jsonb) $$,
  'a Shop 2 cashier can sell a Shop 2 product');

select is((select shop_id from public.sales where staff_id = '00000000-0000-0000-0000-000000003702'),
          '00000000-0000-0000-0000-000000003790'::uuid, 'the sale belongs to the cashier''s shop');
select is((select shop_id from public.stock_movements where product_id = '00000000-0000-0000-0000-000000003712' and kind = 'sale'),
          '00000000-0000-0000-0000-000000003790'::uuid, 'the stock movement takes the product''s shop');
select is((select stock_qty from public.products where id = '00000000-0000-0000-0000-000000003711'), 5,
          'Shop 1 stock is untouched by Shop 2''s sale');

-- A Shop 1 sale for the refund and report checks below.
select public.complete_sale('00000000-0000-0000-0000-000000003701',
  '[{"product_id":"00000000-0000-0000-0000-000000003711","quantity":1,"unit_price":1000}]'::jsonb,
  '[{"tender":"cash","amount":1000}]'::jsonb);

-- ---------------------------------------------------------------------------
-- Cross-shop refund: Shop 2 pays out a Shop 1 sale
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_refund('00000000-0000-0000-0000-000000003702', 1000, 'cash', 'changed mind',
       jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000003711','quantity',1,'unit_price',1000,'name','Iso A','restock',true)),
       (select id from public.sales where staff_id = '00000000-0000-0000-0000-000000003701')) $$,
  'a Shop 2 cashier can refund a Shop 1 sale');
select is((select shop_id from public.refunds order by created_at desc limit 1),
          '00000000-0000-0000-0000-000000003790'::uuid, 'the refund is paid out of the refunding shop');
select is((select original_shop_id from public.refunds order by created_at desc limit 1),
          public.default_shop_id(), 'the refund remembers the original sale''s shop');
select is((select stock_qty from public.products where id = '00000000-0000-0000-0000-000000003711'), 4,
          'a product from another shop is not restocked by the refunding shop');
select is((select restocked from public.refund_lines order by created_at desc limit 1), false,
          'and the refund line says so');

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000003720', 'walk_in', 'Iso Customer', 'Phone', 'Screen', 20000);

select throws_ok(
  $$ select public.record_job_payment('00000000-0000-0000-0000-000000003720', 'deposit', 1000, 'cash', '00000000-0000-0000-0000-000000003702') $$,
  'P0001', null, 'a Shop 2 cashier cannot take a payment on a Shop 1 job');
select lives_ok(
  $$ select public.record_job_payment('00000000-0000-0000-0000-000000003720', 'deposit', 1000, 'cash', '00000000-0000-0000-0000-000000003701') $$,
  'a Shop 1 cashier can');
select is((select shop_id from public.job_payments where job_id = '00000000-0000-0000-0000-000000003720'),
          public.default_shop_id(), 'the payment is in the job''s shop');
select throws_ok(
  $$ select public.add_job_part('00000000-0000-0000-0000-000000003720', '00000000-0000-0000-0000-000000003712', 1, '00000000-0000-0000-0000-000000003701') $$,
  'P0001', null, 'a Shop 2 product cannot be used as a part on a Shop 1 job');

-- ---------------------------------------------------------------------------
-- Reports, card limits, promotions, print queue
-- ---------------------------------------------------------------------------

select is((select total::int from public.pos_today_summary('00000000-0000-0000-0000-000000003790')), 2000,
          'today''s takings for Shop 2 count only Shop 2 sales');
select is((select total::int from public.pos_today_summary(public.default_shop_id())), 1000,
          'and Shop 1''s count only Shop 1''s');
select is((select revenue::int from public.analytics_totals(current_date - 1, current_date + 1, '00000000-0000-0000-0000-000000003790')), 1000,
          'analytics can be cut to one shop (Shop 2 sold £20 and paid out a £10 refund)');

update public.shops set card1_daily_limit = 1500 where id = '00000000-0000-0000-0000-000000003790';
select is(public.card_limit_breach('pos1', 5000, public.default_shop_id()), null,
          'Shop 1 has no card limit, Shop 2''s limit does not apply to it');
select isnt(public.card_limit_breach('pos1', 5000, '00000000-0000-0000-0000-000000003790'), null,
          'Shop 2''s own limit does');

select throws_ok(
  $$ select public.upsert_promotion_group(
       array['00000000-0000-0000-0000-000000003711','00000000-0000-0000-0000-000000003712']::uuid[],
       '[{"minQty":2,"unitPrice":500}]'::jsonb) $$,
  'P0001', 'A promotion cannot mix products from different shops.', 'a promotion cannot span shops');

insert into public.print_agents (id, name, token_hash, is_primary, shop_id)
values ('00000000-0000-0000-0000-000000003730', 'Agent S2', 'iso-hash-s2', true, '00000000-0000-0000-0000-000000003790');
insert into public.print_jobs (id, kind, target, payload, dedupe_key, shop_id) values
  ('00000000-0000-0000-0000-000000003731', 'sale_receipt', 'receipt', '{}'::jsonb, 'iso:s1', public.default_shop_id()),
  ('00000000-0000-0000-0000-000000003732', 'sale_receipt', 'receipt', '{}'::jsonb, 'iso:s2', '00000000-0000-0000-0000-000000003790');
select is((select id from public.claim_print_job('00000000-0000-0000-0000-000000003730')),
          '00000000-0000-0000-0000-000000003732'::uuid, 'a Shop 2 agent claims only Shop 2 jobs');

select * from finish();
rollback;
