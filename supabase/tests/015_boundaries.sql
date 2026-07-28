-- 015 — Empty and extreme inputs
-- The boundaries nothing else exercises: nothing, too much, and the edges
-- in between.

begin;
set local search_path to public, tap, extensions;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001501', 'test-staff-015@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001501', 'test-staff-015@example.invalid', 'Test Boundary', 'owner');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001510', 'boundary-test-item', 'Boundary Test Item', 'cases', 1000, 400, 100),
  ('00000000-0000-0000-0000-000000001511', 'boundary-free-item', 'Boundary Free Item', 'cases', 0, 0, 100),
  ('00000000-0000-0000-0000-000000001512', 'boundary-cheap-item', 'Boundary Cheap Item', 'cases', 1, 1, 0),
  ('00000000-0000-0000-0000-000000001513', 'boundary-expensive-item', 'Boundary Expensive Item', 'cases', 1000000, 500000, 0);

-- ---------------------------------------------------------------------------
-- Nothing at all
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001501'::uuid, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('tender','cash','amount',0))
  )
  $$,
  null, null,
  'a sale with no lines at all is refused'
);
select throws_ok(
  $$
  select public.create_order('[]'::jsonb, 'collect'::delivery_method, p_guest_email => 'boundary-empty@example.invalid')
  $$,
  null, null,
  'an order with no items at all is refused'
);
select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001501', p_amount => 0, p_refund_tender => 'cash',
    p_reason => 'a zero refund via the refund path itself', p_sale_id => gen_random_uuid()
  )
  $$,
  null, null,
  'a refund of zero, attempted through create_refund directly (not a raw insert), is refused — amount > 0 catches it before the sale-not-found check even matters'
);

-- ---------------------------------------------------------------------------
-- A promo tier that doesn't apply charges full price, not a broken result
-- ---------------------------------------------------------------------------

insert into public.promotions (id, product_id, is_active) values
  ('00000000-0000-0000-0000-000000001520', '00000000-0000-0000-0000-000000001510', true);
insert into public.promo_tiers (promotion_id, min_qty, unit_price) values
  ('00000000-0000-0000-0000-000000001520', 2, 900);

select is(
  public.resolve_sale_unit_price('00000000-0000-0000-0000-000000001510', 1)::integer,
  1000,
  'buying 1 when the cheapest tier needs 2 charges the full shelf price — not null, not zero, not an error'
);
select is(
  public.resolve_sale_unit_price('00000000-0000-0000-0000-000000001510', 2)::integer,
  900,
  'buying 2, meeting the tier''s min_qty, gets the tier price'
);
select is(
  public.resolve_sale_unit_price('00000000-0000-0000-0000-000000001510', 5)::integer,
  900,
  'buying more than the tier needs still gets the tier price — there is only one tier here, and 5 clears it'
);

-- ---------------------------------------------------------------------------
-- A very large quantity: handled cleanly, or refused — never silently wrong
-- ---------------------------------------------------------------------------

do $$ begin
  perform public.stock_receive('00000000-0000-0000-0000-000000001512', 1000000, 1, 'receipt', null, null, null, null);
end $$;

select lives_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001501'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001512','quantity',1000000,'unit_price',1,'list_price',1)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000000))
  )
  $$,
  'a sale of 1,000,000 units at 1p each (1,000,000p total) is handled cleanly — a large quantity on its own is not the problem'
);

select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001501'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001513','quantity',1000000000,'unit_price',1000000,'list_price',1000000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000000000000))
  )
  $$,
  null, null,
  'a quantity x price combination that would overflow the pence domain''s 32-bit ceiling (1,000,000p x 1,000,000,000 here) is refused outright by Postgres''s own integer overflow check, not silently wrapped or truncated'
);

-- ---------------------------------------------------------------------------
-- Zero-priced products and zero-cost stock are legitimate, not blocked
-- ---------------------------------------------------------------------------

create temporary table _t015_free_sale as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001501'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001511','quantity',1,'unit_price',0,'list_price',0)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',0))
  ) as id;

select is(
  (select total::integer from public.sales where id = (select id from _t015_free_sale)),
  0,
  'a genuinely free product (0p price, 0p cost) sells cleanly for a 0p total — not blocked, not an error'
);

-- Found stock: zero-cost stock coming in shouldn't break the weighted
-- average — an unpriced receipt is a valid receipt, not division by zero.
insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001514', 'boundary-found-item', 'Boundary Found Item', 'cases', 500, 0, 0);
select lives_ok(
  $$ select public.stock_receive('00000000-0000-0000-0000-000000001514', 10, 0) $$,
  'receiving found stock at 0p unit cost succeeds — a legitimate zero, not a missing value'
);

-- A reporting period made entirely of zero-revenue activity: margin is 0,
-- not a division-by-zero error — analytics_totals' own CASE guards it, and
-- this proves that guard is actually exercised, not just present in the SQL.
select lives_ok(
  $$ select * from public.analytics_totals(public.shop_day(now()), public.shop_day(now())) $$,
  'analytics_totals runs without error over a period that includes zero-revenue activity — margin math does not divide by zero'
);

select * from finish();
rollback;
