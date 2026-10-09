-- 030 — Staff cannot quote below the shop's repair price
-- Change request item 6 / migration 0082; prices per device since 0109 (tester change C-3).
--
-- The floor is repair_price() — the device's own price for the chosen repair and sub-type, the
-- same figure the website and job creation show. What these tests pin is that the trigger reads
-- that and nothing else; that the legitimate ways to have NO floor still work (a guard that
-- blocked free-text jobs would be turned off within a week); and that a job keeps the price it was
-- created with — a later change to the price list never stops an older job from moving on.

begin;
set local search_path to public, tap, extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures: Original £150, Copy £60 on this device; OEM left blank (not offered).
-- ---------------------------------------------------------------------------

insert into public.devices (id, name, brand)
values ('00000000-0000-0000-0000-000000000a10', 'Floor Test Device', 'apple');

insert into public.repair_types (id, name)
values ('00000000-0000-0000-0000-000000000a11', 'Floor Test Screen');

insert into public.repair_types (id, name, diagnosis_only)
values ('00000000-0000-0000-0000-000000000a12', 'Floor Test Diagnosis Only', true);

insert into public.repair_type_sub_types (repair_type_id, sub_type_id)
select '00000000-0000-0000-0000-000000000a11', id from public.repair_sub_types where legacy_tier is not null;

insert into public.device_repair_prices (device_id, repair_type_id, sub_type_id, price)
select '00000000-0000-0000-0000-000000000a10', '00000000-0000-0000-0000-000000000a11', id,
       case legacy_tier when 'original' then 15000 else 6000 end
  from public.repair_sub_types where legacy_tier in ('original', 'copy');

insert into public.device_repair_prices (device_id, repair_type_id, sub_type_id, price)
values ('00000000-0000-0000-0000-000000000a10', '00000000-0000-0000-0000-000000000a12', null, 2000);

create temp table st as
select (select id from public.repair_sub_types where legacy_tier = 'original') as original,
       (select id from public.repair_sub_types where legacy_tier = 'copy') as copy,
       (select id from public.repair_sub_types where legacy_tier = 'oem') as oem;

select is(
  public.repair_price('00000000-0000-0000-0000-000000000a10', '00000000-0000-0000-0000-000000000a11',
                      (select original from st))::integer,
  15000,
  'the floor is the price typed for this device and sub-type'
);

-- ---------------------------------------------------------------------------
-- 1. Below the floor is refused on INSERT
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, sub_type_id, quoted_price)
     values ('walk_in', 'Too Cheap', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', (select original from st), 14900) $$,
  null, null,
  'a quote one penny under the floor is refused'
);

select lives_ok(
  $$ insert into public.jobs (id, source, customer_name, device_description, problem_description, repair_type_id, device_id, sub_type_id, quoted_price)
     values ('00000000-0000-0000-0000-000000000a20', 'walk_in', 'Exactly Right', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', (select original from st), 15000) $$,
  'a quote exactly at the floor is allowed — the constraint is "not lower", not "higher"'
);

select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, sub_type_id, quoted_price)
     values ('walk_in', 'Quoted Up', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', (select original from st), 20000) $$,
  'staff can quote above the floor'
);

-- ---------------------------------------------------------------------------
-- 2. The sub-type is part of the floor, not decoration
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, sub_type_id, quoted_price)
     values ('walk_in', 'Copy Part', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', (select copy from st), 6000) $$,
  'the Copy price is what a Copy job is measured against'
);

select throws_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, quoted_price)
     values ('walk_in', 'Cheap Diagnosis', 'Test Phone', 'Water damage', '00000000-0000-0000-0000-000000000a12', '00000000-0000-0000-0000-000000000a10', 1000) $$,
  null, null,
  'a diagnosis-only repair has a flat price per device, and a quote below it is refused too'
);

-- ---------------------------------------------------------------------------
-- 3. The ways to have no floor at all
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, quoted_price)
     values ('walk_in', 'Free Text', 'Something Unlisted', 'Odd fault', 100) $$,
  'a free-text job with no catalogue repair has no floor — £1 is allowed'
);

-- "Blank = on diagnosis" survives picking a priced repair: staff often look up the price, then
-- find the device needs opening before they will commit.
select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, sub_type_id)
     values ('walk_in', 'No Quote Yet', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', (select original from st)) $$,
  'a priced repair with no quote yet is allowed — no quote is not a low quote'
);

-- ---------------------------------------------------------------------------
-- 4. The revision path, which is how a floor gets bypassed if it is missed
-- ---------------------------------------------------------------------------

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000a20';

select throws_ok(
  $$ update public.jobs set status = 'waiting_approval', revised_quote = 500 where id = '00000000-0000-0000-0000-000000000a20' $$,
  null, null,
  'a revised quote below the floor is refused too — otherwise the floor is two clicks away from useless'
);

-- ---------------------------------------------------------------------------
-- 5. A job keeps the price it was created with (0109)
-- ---------------------------------------------------------------------------
-- The shop raises the device's Original price after 000a20 was quoted at £150. That job's quote
-- was right when it was given; moving it on must not now be refused for being "below" a price it
-- never had.

update public.device_repair_prices set price = 18000
 where device_id = '00000000-0000-0000-0000-000000000a10'
   and repair_type_id = '00000000-0000-0000-0000-000000000a11'
   and sub_type_id = (select original from st);

select lives_ok(
  $$ update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000a20' $$,
  'a job quoted before the price went up still moves on — the floor guards a quote being set, not every update'
);

select throws_ok(
  $$ update public.jobs set quoted_price = 15500 where id = '00000000-0000-0000-0000-000000000a20' $$,
  null, null,
  'but changing its quote now is measured against the price as it is today'
);

select * from finish();
rollback;
