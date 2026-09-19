-- 030 — Staff cannot quote below the admin-defined repair price
-- Change request item 6 / migration 0082.
--
-- The floor is repair_quote_price(), the same function /admin/repair-pricing
-- prices with and the public /repair wizard quotes with. What these tests pin
-- is that the trigger reads that function and not a number from anywhere else,
-- and that the two legitimate ways to have NO floor still work — because a
-- guard that also blocks free-text jobs and goodwill repairs would be
-- unusable on a shop floor and would be turned off within a week.

begin;
set local search_path to public, tap, extensions;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures: a device with a non-1 multiplier, so the floor cannot accidentally
-- equal the base price and pass for the wrong reason.
-- ---------------------------------------------------------------------------

insert into public.devices (id, name, brand, price_multiplier)
values ('00000000-0000-0000-0000-000000000a10', 'Floor Test Device', 'apple', 1.50);

insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy)
values ('00000000-0000-0000-0000-000000000a11', 'Floor Test Screen', 10000, 6000, 4000);

-- Diagnosis-only: all three null, per repair_types_all_or_no_pricing.
insert into public.repair_types (id, name)
values ('00000000-0000-0000-0000-000000000a12', 'Floor Test Diagnosis Only');

-- 10000p base x 1.50 = 15000p at 'original'.
select is(
  public.repair_quote_price(
    '00000000-0000-0000-0000-000000000a11',
    '00000000-0000-0000-0000-000000000a10',
    'original'
  )::integer,
  15000,
  'the floor is base x multiplier, not the bare base price'
);

-- ---------------------------------------------------------------------------
-- 1. Below the floor is refused on INSERT
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, part_tier, quoted_price)
     values ('walk_in', 'Too Cheap', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', 'original', 14900) $$,
  null, null,
  'a quote one penny under the floor is refused'
);

select lives_ok(
  $$ insert into public.jobs (id, source, customer_name, device_description, problem_description, repair_type_id, device_id, part_tier, quoted_price)
     values ('00000000-0000-0000-0000-000000000a20', 'walk_in', 'Exactly Right', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', 'original', 15000) $$,
  'a quote exactly at the floor is allowed — the constraint is "not lower", not "higher"'
);

select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, part_tier, quoted_price)
     values ('walk_in', 'Quoted Up', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', 'original', 20000) $$,
  'staff can quote above the floor'
);

-- ---------------------------------------------------------------------------
-- 2. The tier is part of the floor, not decoration
-- ---------------------------------------------------------------------------
-- 4000p copy x 1.50 = 6000p. A quote of 6000 is fine at 'copy' and far below
-- the floor at 'original' — the same number, two different answers.

select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, part_tier, quoted_price)
     values ('walk_in', 'Copy Part', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', 'copy', 6000) $$,
  'the copy-tier floor is what a copy-tier job is measured against'
);

-- ---------------------------------------------------------------------------
-- 3. The two ways to have no floor at all
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, quoted_price)
     values ('walk_in', 'Free Text', 'Something Unlisted', 'Odd fault', 100) $$,
  'a free-text job with no catalogue repair has no floor — £1 is allowed'
);

select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, part_tier, quoted_price)
     values ('walk_in', 'Diagnosis Only', 'Test Phone', 'Water damage', '00000000-0000-0000-0000-000000000a12', '00000000-0000-0000-0000-000000000a10', 'original', 100) $$,
  'a diagnosis-only repair type has no price at any tier, so nothing to be below'
);

-- "Blank = on diagnosis" survives picking a priced repair: staff often look up
-- the price, then find the device needs opening before they will commit.
select lives_ok(
  $$ insert into public.jobs (source, customer_name, device_description, problem_description, repair_type_id, device_id, part_tier)
     values ('walk_in', 'No Quote Yet', 'Test Phone', 'Screen', '00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-000000000a10', 'original') $$,
  'a priced repair with no quote yet is allowed — no quote is not a low quote'
);

-- ---------------------------------------------------------------------------
-- 4. The revision path, which is how a floor gets bypassed if it is missed
-- ---------------------------------------------------------------------------
-- Create at the floor, then "revise" down to nothing. 000a20 above is at 15000.

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000a20';

select throws_ok(
  $$ update public.jobs set status = 'waiting_approval', revised_quote = 500 where id = '00000000-0000-0000-0000-000000000a20' $$,
  null, null,
  'a revised quote below the floor is refused too — otherwise the floor is two clicks away from useless'
);

select * from finish();
rollback;
