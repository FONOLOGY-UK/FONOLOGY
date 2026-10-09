-- 035 — Stage 2 performance migration (0094)
--
-- 1. A product WITH variants is judged on its variants, not on the parent's
--    frozen stock_qty (which sits at 0) — stock_status_for(uuid) and the
--    batched stock_status_for_many() that delegates to it.
-- 2. card_payment_usage() reads only as far back as its widest window, and
--    still returns the same figures: today's payment counts in all three,
--    an older one in the same month counts in monthly only, and one from
--    last year in none.

begin;
set local search_path to public, tap, extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Variant products
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, has_variants)
values
  ('00000000-0000-0000-0000-000000003501', 'perf-variants-instock', 'Perf Variants In Stock', 'cases', 1500, 0, 0, true),
  ('00000000-0000-0000-0000-000000003502', 'perf-variants-restocking', 'Perf Variants Restocking', 'cases', 1500, 0, 0, true),
  ('00000000-0000-0000-0000-000000003503', 'perf-variants-out', 'Perf Variants Out', 'cases', 1500, 0, 0, true),
  ('00000000-0000-0000-0000-000000003504', 'perf-variants-inactive', 'Perf Variants Inactive', 'cases', 1500, 0, 0, true),
  ('00000000-0000-0000-0000-000000003505', 'perf-plain', 'Perf Plain', 'cases', 1500, 500, 4, false);

-- In stock: one variant empty, one with stock — the parent itself is 0.
insert into public.product_variants (product_id, options, price, stock_qty, cost_price)
values
  ('00000000-0000-0000-0000-000000003501', '{"Colour":"Black"}', 1500, 0, 100),
  ('00000000-0000-0000-0000-000000003501', '{"Colour":"Blue"}', 1500, 7, 100),
  ('00000000-0000-0000-0000-000000003502', '{"Colour":"Black"}', 1500, 0, 100),
  ('00000000-0000-0000-0000-000000003503', '{"Colour":"Black"}', 1500, 0, 100);

-- Stock held only by a RETIRED variant does not make the product available.
insert into public.product_variants (product_id, options, price, stock_qty, cost_price, is_active)
values ('00000000-0000-0000-0000-000000003504', '{"Colour":"Black"}', 1500, 9, 100, false);

-- A receipt for one of the empty variants in the last 30 days.
insert into public.stock_movements (product_id, variant_id, kind, qty_delta, unit_cost)
select '00000000-0000-0000-0000-000000003502', id, 'receipt', 3, 100
  from public.product_variants where product_id = '00000000-0000-0000-0000-000000003502';
update public.product_variants set stock_qty = 0 where product_id = '00000000-0000-0000-0000-000000003502';

select is(public.stock_status_for('00000000-0000-0000-0000-000000003501'), 'in-stock',
  'a variant product is in stock when a variant has stock, although the parent row says 0');
select is(public.stock_status_for('00000000-0000-0000-0000-000000003502'), 'restocking',
  'a variant product with empty variants and a recent receipt for one is restocking');
select is(public.stock_status_for('00000000-0000-0000-0000-000000003503'), 'out-of-stock',
  'a variant product with nothing anywhere is out of stock');
select is(public.stock_status_for('00000000-0000-0000-0000-000000003504'), 'out-of-stock',
  'stock on a retired variant does not count');
select is(public.stock_status_for('00000000-0000-0000-0000-000000003505'), 'in-stock',
  'a product without variants is judged on its own stock, as before');

select is(
  (select status from public.stock_status_for_many(array['00000000-0000-0000-0000-000000003501'::uuid])),
  'in-stock',
  'the batched function gives the variant-aware answer too'
);

-- ---------------------------------------------------------------------------
-- card_payment_usage(): same figures from a bounded read
-- ---------------------------------------------------------------------------

insert into public.user_accounts (id, email) values ('00000000-0000-0000-0000-000000003510', 'test-staff-035@example.invalid');
insert into public.staff (id, email, name, role)
values ('00000000-0000-0000-0000-000000003510', 'test-staff-035@example.invalid', 'Test Perf', 'owner');

insert into public.sales (id, staff_id, subtotal, discount, cost)
values
  ('00000000-0000-0000-0000-000000003511', '00000000-0000-0000-0000-000000003510', 1000, 0, 100),
  ('00000000-0000-0000-0000-000000003512', '00000000-0000-0000-0000-000000003510', 2000, 0, 100),
  ('00000000-0000-0000-0000-000000003513', '00000000-0000-0000-0000-000000003510', 4000, 0, 100);
insert into public.sale_payments (sale_id, tender, amount, created_at)
values
  ('00000000-0000-0000-0000-000000003511', 'pos1', 1000, now()),
  -- Earlier this month (or, on the 1st, still today): in monthly, not daily.
  ('00000000-0000-0000-0000-000000003512', 'pos1', 2000, date_trunc('month', now()) + interval '1 hour'),
  -- A year ago: in no window.
  ('00000000-0000-0000-0000-000000003513', 'pos1', 4000, now() - interval '400 days');

select is((select daily::int from public.card_payment_usage('pos1', public.default_shop_id())), 1000 + case when public.shop_day(date_trunc('month', now()) + interval '1 hour') = public.shop_day(now()) then 2000 else 0 end,
  'daily counts today''s payment (and the month-start one only on the 1st)');
select is((select monthly::int from public.card_payment_usage('pos1', public.default_shop_id())), 3000,
  'monthly counts this month''s payments and not last year''s');
select ok((select weekly::int from public.card_payment_usage('pos1', public.default_shop_id())) >= 1000,
  'weekly counts at least today''s payment');
select is((select monthly::int from public.card_payment_usage('pos2', public.default_shop_id())), 0,
  'another terminal''s usage is separate');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public'
     and indexname in ('sale_payments_tender_created_idx', 'job_payments_tender_at_idx', 'sales_created_at_idx',
                       'refunds_created_at_idx', 'orders_created_at_idx', 'trade_in_payouts_created_at_idx')),
  6,
  'the six window indexes exist'
);

select * from finish();
rollback;
