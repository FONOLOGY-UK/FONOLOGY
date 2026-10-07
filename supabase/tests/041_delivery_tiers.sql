-- 041 — Delivery tiers, remote postcodes, free delivery over the threshold (0102)
-- Mainland standard £3.00 / next-day £5.50; remote standard £5.50, no
-- next-day; free mainland standard when the goods come to MORE than £50.00.

begin;
set local search_path to public, tap, extensions;
select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures: £25 and £50.01 items
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000004110', 'tier-test-25',   'Tier Test £25',    'cases', 2500, 1000, 50),
  ('00000000-0000-0000-0000-000000004111', 'tier-test-5001', 'Tier Test £50.01', 'cases', 5001, 1000, 50);

create function pg_temp._t041_fee(p_product text, p_qty int, p_method delivery_method, p_postcode text)
returns integer language sql as $$
  select delivery_fee::integer from public.delivery_quote(
    jsonb_build_array(jsonb_build_object('product_id', p_product, 'quantity', p_qty)), p_method, p_postcode);
$$;

-- ---------------------------------------------------------------------------
-- Rates
-- ---------------------------------------------------------------------------

select is(
  (select price::integer from public.delivery_rates dr join public.delivery_zones dz on dz.id = dr.zone_id
    where dz.code = 'standard' and dr.method = 'standard'), 300, 'mainland standard is £3.00');
select is(
  (select price::integer from public.delivery_rates dr join public.delivery_zones dz on dz.id = dr.zone_id
    where dz.code = 'standard' and dr.method = 'next_day'), 550, 'mainland next-day is £5.50');
select is(
  (select price::integer from public.delivery_rates dr join public.delivery_zones dz on dz.id = dr.zone_id
    where dz.code = 'remote' and dr.method = 'standard'), 550, 'remote standard is £5.50');
select is(
  (select available from public.delivery_rates dr join public.delivery_zones dz on dz.id = dr.zone_id
    where dz.code = 'remote' and dr.method = 'next_day'), false, 'remote next-day is switched off');

-- ---------------------------------------------------------------------------
-- New remote districts (Jeez Mart list) and their mainland neighbours
-- ---------------------------------------------------------------------------

select is((select code from public.delivery_zones where id = public.delivery_zone_for('AB35 5AA')), 'remote',   'AB35 is remote');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('FK17 8AA')), 'remote',   'FK17 is remote');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('PO30 1AA')), 'remote',   'PO30 (Isle of Wight) is remote');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('PO3 5AA')),  'standard', 'PO3 (Portsmouth) is standard — a stored PO30 never catches PO3');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('PH30 4AA')), 'remote',   'PH30 is remote in its own right');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('G46 6AB')),  'standard', 'Thornliebank is standard');

-- ---------------------------------------------------------------------------
-- Free delivery: strictly over the threshold, mainland standard only
-- ---------------------------------------------------------------------------

select is(pg_temp._t041_fee('00000000-0000-0000-0000-000000004110', 2, 'standard', 'G46 6AB'), 300,
  'goods of exactly £50.00 still pay mainland standard');
select is(pg_temp._t041_fee('00000000-0000-0000-0000-000000004111', 1, 'standard', 'G46 6AB'), 0,
  'goods of £50.01 get free mainland standard');
select is(pg_temp._t041_fee('00000000-0000-0000-0000-000000004111', 1, 'next_day', 'G46 6AB'), 550,
  'next-day is still charged over the threshold');
select is(pg_temp._t041_fee('00000000-0000-0000-0000-000000004111', 1, 'standard', 'IV1 1AA'), 550,
  'remote standard is still charged over the threshold');
select is(pg_temp._t041_fee('00000000-0000-0000-0000-000000004111', 1, 'standard', 'JE2 3AB'), 550,
  'Channel Islands are delivered at the remote rate');

update public.shop_settings set free_delivery_threshold = 7000;
select is(pg_temp._t041_fee('00000000-0000-0000-0000-000000004111', 1, 'standard', 'G46 6AB'), 300,
  'the threshold is read from shop_settings');
update public.shop_settings set free_delivery_threshold = 5000;

select is(
  (select free_delivery from public.delivery_quote_detail(
     jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000004111', 'quantity', 1)),
     'standard', 'G46 6AB')),
  true, 'delivery_quote_detail says why the fee is zero');

-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select pg_temp._t041_fee('00000000-0000-0000-0000-000000004110', 1, 'next_day', 'IV1 1AA') $$,
  'P0001', 'Next-day delivery isn''t available to this postcode.',
  'next-day to a remote postcode is refused by the database');
select throws_ok(
  $$ select pg_temp._t041_fee('00000000-0000-0000-0000-000000004110', 1, 'standard', null) $$,
  'P0001', 'A delivery postcode is required.',
  'a delivery with no postcode is refused, not priced as mainland');
select throws_ok(
  $$ select pg_temp._t041_fee('00000000-0000-0000-0000-000000004110', 1, 'standard', 'BFPO 123') $$,
  'P0001', 'We can''t deliver to BFPO addresses.',
  'BFPO is refused');
select is(pg_temp._t041_fee('00000000-0000-0000-0000-000000004110', 1, 'collect', null), 0,
  'collect needs no postcode and is free');

-- ---------------------------------------------------------------------------
-- delivery_options drives the checkout's method picker
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select method::text, available, delivery_fee::integer from public.delivery_options(
       jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000004110', 'quantity', 1)),
       'IV1 1AA') $$,
  $$ values ('standard', true, 550), ('next_day', false, null::integer) $$,
  'a remote postcode is offered standard at £5.50 and no next-day');
select results_eq(
  $$ select method::text, available, delivery_fee::integer from public.delivery_options(
       jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000004111', 'quantity', 1)),
       'G46 6AB') $$,
  $$ values ('standard', true, 0), ('next_day', true, 550) $$,
  'a mainland basket over £50 is offered free standard and £5.50 next-day');

-- ---------------------------------------------------------------------------
-- create_order charges what the quote showed
-- ---------------------------------------------------------------------------

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000004111', 'quantity', 1)),
  'standard'::delivery_method, null, 'tier-free@example.invalid'::citext,
  'Free', '1 Test Street', null, 'Glasgow', null, 'G46 6AB'
);
select is(
  (select delivery_fee::integer from public.orders where guest_email = 'tier-free@example.invalid'), 0,
  'an order over £50 to a mainland postcode is created with free delivery');

select * from finish();
rollback;
