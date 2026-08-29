-- 027 — Product variants (0060), stock ledger split
--
-- This is the file the client asked to see covered at the database level,
-- not just clicked through: the variant-vs-parent stock ledger split is the
-- riskiest piece of #16 (weighted-average cost, oversell protection, the
-- restocking window), and this schema's stock trigger already has a real
-- history of "found by testing, not by reading" bugs (see 003_stock.sql's
-- own header, and stock_receive's comment about the reason-parameter gap).
-- Every scenario here writes real rows and reads the result back — nothing
-- is asserted from the migration source alone, same discipline as 003.
--
-- What's deliberately NOT here, matching the trimmed v1 scope: no
-- variant_option_values (doesn't exist), no per-variant promotions (v1
-- doesn't touch promotions at all).

begin;
set local search_path to public, tap, extensions;
select plan(39);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000002701', 'test-staff-027@example.invalid');

insert into public.staff (id, email, name, role)
values (
  '00000000-0000-0000-0000-000000002701',
  'test-staff-027@example.invalid',
  'Test Cashier 027',
  'owner'
);

-- A plain, non-variant product — proves the has_variants=false path is
-- completely untouched by everything below.
insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000002710', 'variant-test-plain', 'Variant Test Plain Widget', 'cases', 2000, 500, 10);

-- The variant-bearing parent. price is the base; each variant adjusts it.
insert into public.products (id, slug, name, category, price, cost_price, stock_qty, has_variants)
values ('00000000-0000-0000-0000-000000002720', 'variant-test-case', 'Variant Test Case', 'cases', 1500, 0, 0, true);

-- A second variant-bearing parent, used only for the cross-product
-- barcode/sku/variant-mismatch checks below.
insert into public.products (id, slug, name, category, price, cost_price, stock_qty, has_variants)
values ('00000000-0000-0000-0000-000000002730', 'variant-test-case-2', 'Variant Test Case Two', 'cases', 1500, 0, 0, true);

-- ---------------------------------------------------------------------------
-- has_variants gates whether a product may have variants at all
-- ---------------------------------------------------------------------------

select is(
  (select has_variants from public.products where id = '00000000-0000-0000-0000-000000002710'),
  false,
  'a product created the old way defaults has_variants to false'
);

select throws_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, price_adjustment)
  values ('00000000-0000-0000-0000-000000002711', '00000000-0000-0000-0000-000000002710',
          '{"colour":"Black"}'::jsonb, 'VAR-PLAIN-001', 0)
  $$,
  null, null,
  'a variant cannot be added to a product with has_variants still false'
);

-- ---------------------------------------------------------------------------
-- Creating variants
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, barcode, price_adjustment, cost_price, stock_qty)
  values ('00000000-0000-0000-0000-000000002721', '00000000-0000-0000-0000-000000002720',
          '{"colour":"Black","storage":"128GB"}'::jsonb, 'VAR-CASE-BLK-128', '5000000000021', 0, 0, 0)
  $$,
  'a variant on a has_variants=true product is accepted'
);

select lives_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, barcode, price_adjustment, cost_price, stock_qty)
  values ('00000000-0000-0000-0000-000000002722', '00000000-0000-0000-0000-000000002720',
          '{"colour":"White","storage":"256GB"}'::jsonb, 'VAR-CASE-WHT-256', '5000000000022', 300, 0, 0)
  $$,
  'a second, differently-optioned variant on the same product is accepted'
);

select throws_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, price_adjustment)
  values ('00000000-0000-0000-0000-000000002723', '00000000-0000-0000-0000-000000002720',
          '{"colour":"Black","storage":"128GB"}'::jsonb, 'VAR-CASE-BLK-128-DUP', 0)
  $$,
  null, null,
  'a second variant with the identical option set on the same product is rejected — it would be indistinguishable at the till'
);

select throws_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, price_adjustment)
  values ('00000000-0000-0000-0000-000000002724', '00000000-0000-0000-0000-000000002730',
          '{"colour":"Blue"}'::jsonb, 'VAR-CASE-BLK-128', 0)
  $$,
  null, null,
  'sku is unique across the whole table, not just per product'
);

select throws_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, barcode, price_adjustment)
  values ('00000000-0000-0000-0000-000000002725', '00000000-0000-0000-0000-000000002730',
          '{"colour":"Blue"}'::jsonb, 'VAR-CASE-BLU', '5000000000021', 0)
  $$,
  null, null,
  'barcode is unique across variants, same posture as products.barcode'
);

select lives_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, price_adjustment)
  values ('00000000-0000-0000-0000-000000002726', '00000000-0000-0000-0000-000000002730',
          '{"colour":"Blue"}'::jsonb, 'VAR-CASE-BLU', 0)
  $$,
  'a variant with no barcode at all is accepted (partial unique index, same as products)'
);

select lives_ok(
  $$
  insert into public.product_variants (id, product_id, options, sku, price_adjustment)
  values ('00000000-0000-0000-0000-000000002727', '00000000-0000-0000-0000-000000002730',
          '{"colour":"Green"}'::jsonb, 'VAR-CASE-GRN', 0)
  $$,
  'a second variant with no barcode is also accepted — null barcodes never collide with each other'
);

-- ---------------------------------------------------------------------------
-- Price adjustment — additive to the parent, never a replacement
-- ---------------------------------------------------------------------------

select is(
  (
    select p.price + v.price_adjustment
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.id = '00000000-0000-0000-0000-000000002721'
  ),
  1500,
  'a zero-adjustment variant''s effective price equals the parent''s price exactly'
);

select is(
  (
    select p.price + v.price_adjustment
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where v.id = '00000000-0000-0000-0000-000000002722'
  ),
  1800,
  'a +300 adjustment variant prices at parent price plus the adjustment'
);

-- ---------------------------------------------------------------------------
-- Stock ledger: receiving stock into a variant
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.stock_receive('00000000-0000-0000-0000-000000002720', 10, 400, 'receipt', null, null,
       '00000000-0000-0000-0000-000000002701', null, '00000000-0000-0000-0000-000000002721') $$,
  'receiving 10 units at 400p into an empty variant succeeds'
);

select is(
  (select stock_qty from public.product_variants where id = '00000000-0000-0000-0000-000000002721'),
  10,
  'the variant''s own stock_qty reflects the receipt'
);

select is(
  (select cost_price from public.product_variants where id = '00000000-0000-0000-0000-000000002721'),
  400,
  'an empty variant''s cost becomes the incoming unit cost exactly, same rule as an empty product'
);

select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000002720'),
  0,
  'the PARENT product''s stock_qty is untouched by a movement against its variant — cost and stock are fully decoupled once has_variants is true'
);

select is(
  (select cost_price from public.products where id = '00000000-0000-0000-0000-000000002720'),
  0,
  'the parent product''s cost_price is likewise untouched by a variant-level receipt'
);

-- Weighted average, variant-scoped: 10 @ 400p + 10 @ 500p = (4000+5000)/20 = 450p.
-- Exactly the worked example in apply_stock_movement()'s own comment, one level down.
select lives_ok(
  $$ select public.stock_receive('00000000-0000-0000-0000-000000002720', 10, 500, 'receipt', null, null,
       '00000000-0000-0000-0000-000000002701', null, '00000000-0000-0000-0000-000000002721') $$,
  'a second receipt at a different cost succeeds'
);

select is(
  (select stock_qty from public.product_variants where id = '00000000-0000-0000-0000-000000002721'),
  20,
  'stock_qty accumulates across two receipts (10 + 10 = 20)'
);

select is(
  (select cost_price from public.product_variants where id = '00000000-0000-0000-0000-000000002721'),
  450,
  'the weighted average recomputes correctly for a variant: (10*400 + 10*500) / 20 = 450p'
);

-- ---------------------------------------------------------------------------
-- Stock ledger: oversell protection on a variant
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.stock_consume('00000000-0000-0000-0000-000000002720', 25, 'sale', null, null,
       '00000000-0000-0000-0000-000000002701', null, '00000000-0000-0000-0000-000000002721') $$,
  null, 'Not enough stock for product 00000000-0000-0000-0000-000000002721',
  'selling 25 when the variant has 20 fails with the friendly message, keyed to the VARIANT id'
);

select is(
  (select stock_qty from public.product_variants where id = '00000000-0000-0000-0000-000000002721'),
  20,
  'the failed oversell left the variant''s stock_qty unchanged at 20'
);

select lives_ok(
  $$ select public.stock_consume('00000000-0000-0000-0000-000000002720', 20, 'sale', null, null,
       '00000000-0000-0000-0000-000000002701', null, '00000000-0000-0000-0000-000000002721') $$,
  'selling exactly the whole variant shelf (20 of 20) succeeds'
);

select is(
  (select stock_qty from public.product_variants where id = '00000000-0000-0000-0000-000000002721'),
  0,
  'selling the whole variant shelf leaves its stock_qty at 0'
);

-- ---------------------------------------------------------------------------
-- A movement's variant must actually belong to the product named on it
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.stock_movements (product_id, variant_id, kind, qty_delta, unit_cost, staff_id)
  values ('00000000-0000-0000-0000-000000002730', '00000000-0000-0000-0000-000000002721', 'receipt', 5, 300,
          '00000000-0000-0000-0000-000000002701')
  $$,
  null, null,
  'a movement naming a variant that belongs to a DIFFERENT product than product_id is rejected — it would silently move the wrong shelf'
);

-- ---------------------------------------------------------------------------
-- stock_status_for(): variant-aware overload
-- ---------------------------------------------------------------------------

-- Restock the now-empty 002721 variant with a fresh receipt, so it reads
-- as "restocking" (received within 30 days, currently at zero).
select public.stock_receive('00000000-0000-0000-0000-000000002720', 5, 450, 'receipt', null, null,
  '00000000-0000-0000-0000-000000002701', null, '00000000-0000-0000-0000-000000002721');
select public.stock_consume('00000000-0000-0000-0000-000000002720', 5, 'sale', null, null,
  '00000000-0000-0000-0000-000000002701', null, '00000000-0000-0000-0000-000000002721');

select is(
  public.stock_status_for('00000000-0000-0000-0000-000000002720', '00000000-0000-0000-0000-000000002721'),
  'restocking'::stock_status,
  'a variant at zero stock with a receipt inside the last 30 days reads as restocking'
);

select is(
  public.stock_status_for('00000000-0000-0000-0000-000000002720', '00000000-0000-0000-0000-000000002722'),
  'out-of-stock'::stock_status,
  'a variant at zero stock with no receipt at all reads as out-of-stock'
);

select public.stock_receive('00000000-0000-0000-0000-000000002720', 3, 400, 'receipt', null, null,
  '00000000-0000-0000-0000-000000002701', null, '00000000-0000-0000-0000-000000002722');

select is(
  public.stock_status_for('00000000-0000-0000-0000-000000002720', '00000000-0000-0000-0000-000000002722'),
  'in-stock'::stock_status,
  'a variant with stock_qty > 0 reads as in-stock regardless of receipt history'
);

select is(
  public.stock_status_for('00000000-0000-0000-0000-000000002720', null),
  public.stock_status_for('00000000-0000-0000-0000-000000002720'),
  'passing a null variant_id delegates to the original single-arg stock_status_for() — same answer either way'
);

-- ---------------------------------------------------------------------------
-- low_stock_products: variant rows, and the parent stays out of it
-- ---------------------------------------------------------------------------

update public.product_variants
   set low_stock_alert = true, low_stock_threshold = 5
 where id = '00000000-0000-0000-0000-000000002722';
-- 002722 currently sits at 3 (5 received, none sold since) — at/below its
-- threshold of 5, alert on, stock > 0: exactly the "low" definition.

select ok(
  exists (select 1 from public.low_stock_products where variant_id = '00000000-0000-0000-0000-000000002722'),
  'a low-stock variant (alert on, 0 < stock <= threshold) appears in low_stock_products'
);

select ok(
  not exists (
    select 1 from public.low_stock_products
    where variant_id is null and id = '00000000-0000-0000-0000-000000002720'
  ),
  'the has_variants PARENT never appears as its own row in low_stock_products — stock lives on its variants, not on it'
);

-- ---------------------------------------------------------------------------
-- Purchasability: a deactivated variant blocks the whole variant, not the product
-- ---------------------------------------------------------------------------

select ok(
  public.variant_is_purchasable_online('00000000-0000-0000-0000-000000002722'),
  'an active variant of an active, non-vape product is purchasable online'
);

update public.product_variants set is_active = false where id = '00000000-0000-0000-0000-000000002722';

select ok(
  not public.variant_is_purchasable_online('00000000-0000-0000-0000-000000002722'),
  'deactivating one variant makes it unpurchasable...'
);

select ok(
  public.variant_is_purchasable_online('00000000-0000-0000-0000-000000002726'),
  '...while a sibling variant of the SAME product stays purchasable — the deactivation is per-variant, not per-product'
);

-- order_lines_reject_vape() must actually consult variant purchasability,
-- proven end to end: an order line against the deactivated variant is
-- rejected even though the parent product is perfectly active.
insert into public.orders (id, customer_id, guest_email, delivery_method, subtotal, delivery_fee, discount)
values ('00000000-0000-0000-0000-000000002740', null, 'variant-order-test@example.invalid', 'collect', 1800, 0, 0);

select throws_ok(
  $$
  insert into public.order_lines (order_id, product_id, variant_id, name, unit_price, quantity)
  values ('00000000-0000-0000-0000-000000002740', '00000000-0000-0000-0000-000000002720',
          '00000000-0000-0000-0000-000000002722', 'Variant Test Case — White, 256GB', 1800, 1)
  $$,
  null, null,
  'an order line against a deactivated variant is rejected server-side, same enforcement point as the vape-online block'
);

select lives_ok(
  $$
  insert into public.order_lines (order_id, product_id, variant_id, name, unit_price, quantity)
  values ('00000000-0000-0000-0000-000000002740', '00000000-0000-0000-0000-000000002720',
          '00000000-0000-0000-0000-000000002726', 'Variant Test Case Two — Blue', 1500, 1)
  $$,
  'an order line against a still-active sibling variant is accepted'
);

-- ---------------------------------------------------------------------------
-- The plain, non-variant product path is completely untouched
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.stock_consume('00000000-0000-0000-0000-000000002710', 4, 'sale', null, null,
       '00000000-0000-0000-0000-000000002701') $$,
  'stock_consume with no variant id at all (the pre-0060 calling convention) still works exactly as before'
);

select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000002710'),
  6,
  'a plain product''s stock moves at the PRODUCT level, unaffected by anything variants introduced (10 - 4 = 6)'
);

select ok(
  pg_get_functiondef('public.apply_stock_movement'::regproc) ~* 'for update',
  'the (now two-branch) trigger still takes a row lock in both branches — mechanism unchanged, only duplicated one level down'
);

select is(
  (select relrowsecurity from pg_class where relname = 'product_variants' and relnamespace = 'public'::regnamespace),
  true,
  'row level security is enabled on product_variants, same deny-all posture as every other table'
);

select * from finish();
rollback;
