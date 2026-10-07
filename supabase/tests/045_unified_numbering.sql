-- 045 — the unified numbering system (migration 0106)
--
-- [SHOP_CODE]-[PREFIX]-[DDMMYY][NNN]: shop codes F01, F02 … assigned by the database and never
-- changed or reused; seven prefixes and no others; a counter per shop, per prefix, per shop-day
-- that starts at 001 and grows a digit after 999. The acceptance criteria of the client's spec,
-- one by one. Concurrency (two tills at the same instant) is the upsert's row lock — not
-- something one pgTAP session can race.

begin;
set local search_path to public, tap, extensions;
select plan(30);

-- ---------------------------------------------------------------------------
-- Shop codes
-- ---------------------------------------------------------------------------

select is((select code from public.shops where is_fulfilment_hub), 'F01', 'the hub is F01');

insert into public.shops (id, name, sort_order) values ('00000000-0000-0000-0000-000000004502', 'Shop Two', 2);
insert into public.shops (id, name, sort_order) values ('00000000-0000-0000-0000-000000004503', 'Shop Three', 3);

select is((select code from public.shops where id = '00000000-0000-0000-0000-000000004502'), 'F02',
          'the next shop added is F02');
select is((select code from public.shops where id = '00000000-0000-0000-0000-000000004503'), 'F03',
          'and the one after that F03');

select throws_ok(
  $$ insert into public.shops (code, name) values ('F09', 'Picked by hand') $$,
  '22023', null, 'a shop code cannot be typed in');
select throws_ok(
  $$ update public.shops set code = 'F42' where id = '00000000-0000-0000-0000-000000004503' $$,
  '22023', null, 'a shop code cannot be changed');

-- Closing a shop retires its code: the next shop still gets a new one.
update public.shops set is_active = false where id = '00000000-0000-0000-0000-000000004503';
insert into public.shops (id, name, sort_order) values ('00000000-0000-0000-0000-000000004504', 'Shop Four', 4);
select is((select code from public.shops where id = '00000000-0000-0000-0000-000000004504'), 'F04',
          'a closed shop''s code is never handed out again');

-- Several in one statement are numbered one after another.
insert into public.shops (id, name, sort_order) values
  ('00000000-0000-0000-0000-000000004505', 'Shop Five', 5),
  ('00000000-0000-0000-0000-000000004506', 'Shop Six', 6);
select is((select string_agg(code, ',' order by code) from public.shops
            where id in ('00000000-0000-0000-0000-000000004505', '00000000-0000-0000-0000-000000004506')),
          'F05,F06', 'two shops added in one statement get F05 and F06');

-- Past F99 the number simply grows.
update public.shop_code_counter set last_number = 99;
insert into public.shops (id, name, sort_order) values ('00000000-0000-0000-0000-000000004599', 'Shop 100', 100);
select is((select code from public.shops where id = '00000000-0000-0000-0000-000000004599'), 'F100',
          'the hundredth shop is F100');

-- ---------------------------------------------------------------------------
-- Fixtures: a cashier at the hub and one at Shop Two
-- ---------------------------------------------------------------------------

insert into public.user_accounts (id, email) values
  ('00000000-0000-0000-0000-000000004511', 'num-hub@example.invalid'),
  ('00000000-0000-0000-0000-000000004512', 'num-two@example.invalid');
insert into public.staff (id, email, name, role, shop_id) values
  ('00000000-0000-0000-0000-000000004511', 'num-hub@example.invalid', 'Hub Cashier', 'employee', public.default_shop_id()),
  ('00000000-0000-0000-0000-000000004512', 'num-two@example.invalid', 'Two Cashier', 'employee', '00000000-0000-0000-0000-000000004502');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, shop_id) values
  ('00000000-0000-0000-0000-000000004521', 'num-hub', 'Num Hub', 'cases', 1000, 100, 20, public.default_shop_id()),
  ('00000000-0000-0000-0000-000000004522', 'num-two', 'Num Two', 'cases', 1000, 100, 20, '00000000-0000-0000-0000-000000004502');

insert into public.devices (id, name, brand, price_multiplier)
values ('00000000-0000-0000-0000-000000004530', 'Numbering Test Device', 'apple', 1.0);
insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy)
values ('00000000-0000-0000-0000-000000004531', 'Numbering Test Repair', 5000, 5000, 5000);

create temp table t_today as select to_char(public.shop_day(now()), 'DDMMYY') as d;

-- ---------------------------------------------------------------------------
-- All seven series, with the exact shape
-- ---------------------------------------------------------------------------

insert into public.orders (id, guest_email, delivery_method, subtotal, delivery_fee, discount)
values ('00000000-0000-0000-0000-000000004540', 'num-order@example.invalid', 'collect', 1000, 0, 0);
select is((select reference from public.orders where id = '00000000-0000-0000-0000-000000004540'),
          'F01-ORD-' || (select d from t_today) || '001', 'an online order: F01-ORD-<today>001');

select public.complete_sale('00000000-0000-0000-0000-000000004511',
  '[{"product_id":"00000000-0000-0000-0000-000000004521","quantity":1,"unit_price":1000}]'::jsonb,
  '[{"tender":"cash","amount":1000}]'::jsonb);
select is((select reference from public.sales where staff_id = '00000000-0000-0000-0000-000000004511'),
          'F01-SAL-' || (select d from t_today) || '001', 'a till sale: F01-SAL-<today>001');

insert into public.bookings (id, device_id, repair_type_id, tier, quoted_price, customer_name, phone, email,
                             address_line1, city, postcode, preferred_contact)
values ('00000000-0000-0000-0000-000000004541', '00000000-0000-0000-0000-000000004530',
        '00000000-0000-0000-0000-000000004531', 'original', 5000, 'Num Booker', '07000000000',
        'num-book@example.invalid', '1 Test Street', 'Testville', 'TE1 1ST', 'email');
select is((select reference from public.bookings where id = '00000000-0000-0000-0000-000000004541'),
          'F01-REQ-' || (select d from t_today) || '001', 'a repair request: F01-REQ-<today>001');

insert into public.jobs (id, source, customer_name, device_description, problem_description, shop_id)
values ('00000000-0000-0000-0000-000000004542', 'walk_in', 'Num Job 1', 'Phone', 'Screen', public.default_shop_id());
select is((select reference from public.jobs where id = '00000000-0000-0000-0000-000000004542'),
          'F01-JOB-' || (select d from t_today) || '001', 'a repair job: F01-JOB-<today>001');

insert into public.sell_requests (id, name, phone, email, preferred_contact, device_id, condition)
values ('00000000-0000-0000-0000-000000004543', 'Num Seller', '07700900000', 'num-sell@example.invalid', 'email',
        '00000000-0000-0000-0000-000000004530',
        '{"storage":"128GB","screen":"good","body":"good","powers_on":true,"network":"unlocked","accessories":[]}'::jsonb);
select is((select reference from public.sell_requests where id = '00000000-0000-0000-0000-000000004543'),
          'F01-TRD-' || (select d from t_today) || '001', 'a trade-in request: F01-TRD-<today>001');

insert into public.trade_in_payouts (id, device_label, customer_name, amount, method, staff_id, shop_id)
values ('00000000-0000-0000-0000-000000004544', 'Phone', 'Num Seller', -5000, 'cash',
        '00000000-0000-0000-0000-000000004511', public.default_shop_id());
select is((select reference from public.trade_in_payouts where id = '00000000-0000-0000-0000-000000004544'),
          'F01-PAY-' || (select d from t_today) || '001', 'a trade-in payout: F01-PAY-<today>001');

select public.create_refund('00000000-0000-0000-0000-000000004511', 500, 'cash', 'changed mind', '[]'::jsonb,
  (select id from public.sales where staff_id = '00000000-0000-0000-0000-000000004511'));
select is((select reference from public.refunds where staff_id = '00000000-0000-0000-0000-000000004511'),
          'F01-REF-' || (select d from t_today) || '001', 'a refund: F01-REF-<today>001');

select is(
  (select count(*)::int from public.reference_registry
    where reference like 'F01-%' and length(reference) = 17
      and entity_id in ('00000000-0000-0000-0000-000000004540', '00000000-0000-0000-0000-000000004541',
                        '00000000-0000-0000-0000-000000004542', '00000000-0000-0000-0000-000000004543',
                        '00000000-0000-0000-0000-000000004544')),
  5, 'every number is 17 characters and recorded in the registry');

-- ---------------------------------------------------------------------------
-- The counter: per shop, per prefix, per day
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, shop_id) values
  ('00000000-0000-0000-0000-000000004545', 'walk_in', 'Num Job 2', 'Phone', 'Screen', '00000000-0000-0000-0000-000000004502');
insert into public.jobs (id, source, customer_name, device_description, problem_description, shop_id) values
  ('00000000-0000-0000-0000-000000004546', 'walk_in', 'Num Job 3', 'Phone', 'Screen', public.default_shop_id());
insert into public.jobs (id, source, customer_name, device_description, problem_description, shop_id) values
  ('00000000-0000-0000-0000-000000004547', 'walk_in', 'Num Job 4', 'Phone', 'Screen', '00000000-0000-0000-0000-000000004502');

select is((select reference from public.jobs where id = '00000000-0000-0000-0000-000000004545'),
          'F02-JOB-' || (select d from t_today) || '001', 'Shop Two''s first job of the day is 001 too');
select is((select reference from public.jobs where id = '00000000-0000-0000-0000-000000004546'),
          'F01-JOB-' || (select d from t_today) || '002', 'the hub''s next job is 002, unaffected by Shop Two');
select is((select reference from public.jobs where id = '00000000-0000-0000-0000-000000004547'),
          'F02-JOB-' || (select d from t_today) || '002', 'and Shop Two''s next is its own 002');

select public.complete_sale('00000000-0000-0000-0000-000000004512',
  '[{"product_id":"00000000-0000-0000-0000-000000004522","quantity":1,"unit_price":1000}]'::jsonb,
  '[{"tender":"cash","amount":1000}]'::jsonb);
select is((select reference from public.sales where staff_id = '00000000-0000-0000-0000-000000004512'),
          'F02-SAL-' || (select d from t_today) || '001', 'jobs never move the sale counter');

select public.complete_sale('00000000-0000-0000-0000-000000004511',
  '[{"product_id":"00000000-0000-0000-0000-000000004521","quantity":1,"unit_price":1000}]'::jsonb,
  '[{"tender":"cash","amount":1000}]'::jsonb);
select is((select max(reference) from public.sales where staff_id = '00000000-0000-0000-0000-000000004511'),
          'F01-SAL-' || (select d from t_today) || '002', 'the hub''s second sale is 002');

-- Yesterday's series has nothing to do with today's.
insert into public.reference_counters (shop_id, prefix, issued_on, last_number)
values ('00000000-0000-0000-0000-000000004503', 'JOB', public.shop_day(now()) - 1, 57);
insert into public.jobs (id, source, customer_name, device_description, problem_description, shop_id) values
  ('00000000-0000-0000-0000-000000004548', 'walk_in', 'Num Job 5', 'Phone', 'Screen', '00000000-0000-0000-0000-000000004503');
select is((select reference from public.jobs where id = '00000000-0000-0000-0000-000000004548'),
          'F03-JOB-' || (select d from t_today) || '001', 'a new day starts again at 001');
select is((select last_number from public.reference_counters
            where shop_id = '00000000-0000-0000-0000-000000004503' and prefix = 'JOB'
              and issued_on = public.shop_day(now()) - 1), 57, 'and leaves yesterday''s count alone');

-- Past 999 the counter grows a digit instead of failing.
insert into public.reference_counters (shop_id, prefix, issued_on, last_number)
values ('00000000-0000-0000-0000-000000004502', 'TRD', public.shop_day(now()), 998);
select is(public.issue_shop_reference('TRD', '00000000-0000-0000-0000-000000004502', 'test_other',
                                      '00000000-0000-0000-0000-000000004591'),
          'F02-TRD-' || (select d from t_today) || '999', 'the 999th of the day');
select is(public.issue_shop_reference('TRD', '00000000-0000-0000-0000-000000004502', 'test_other',
                                      '00000000-0000-0000-0000-000000004592'),
          'F02-TRD-' || (select d from t_today) || '1000', 'the 1000th grows a digit');

-- ---------------------------------------------------------------------------
-- Valid inputs only
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.issue_shop_reference('FNL', public.default_shop_id(), 'test_other', gen_random_uuid()) $$,
  '22023', null, 'an unknown prefix is refused');
select throws_ok(
  $$ select public.issue_shop_reference('job', public.default_shop_id(), 'test_other', gen_random_uuid()) $$,
  '22023', null, 'prefixes are upper-case only');
select throws_ok(
  $$ select public.issue_shop_reference('JOB', gen_random_uuid(), 'test_other', gen_random_uuid()) $$,
  '23503', null, 'a shop that does not exist cannot issue a number');

-- ---------------------------------------------------------------------------
-- A number never changes
-- ---------------------------------------------------------------------------

update public.jobs set shop_id = public.default_shop_id() where id = '00000000-0000-0000-0000-000000004547';
select is((select reference from public.jobs where id = '00000000-0000-0000-0000-000000004547'),
          'F02-JOB-' || (select d from t_today) || '002', 'a job moved to another shop keeps its number');

select ok(not exists (select 1 from pg_proc where proname = 'issue_job_reference'),
          'the old job-number function is gone, so nothing can mint a JOB- number another way');

select * from finish();
rollback;
