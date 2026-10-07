-- 043 — The change log (migration 0104, Log B)
-- Every change to a product lands in the log by trigger — fields, stock, retire —
-- with who did it when the API said so, and nothing in it can be changed.

begin;
set local search_path to public, tap, extensions;
select plan(16);

insert into public.user_accounts (id, email) values
  ('00000000-0000-0000-0000-000000004301', 'log-a@example.com');
insert into public.staff (id, email, name, role, shop_id) values
  ('00000000-0000-0000-0000-000000004301', 'log-a@example.com', 'Cashier A', 'employee', public.default_shop_id());

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000004311', 'log-item', 'Log Item', 'cases', 1000, 100, 5);

create function pg_temp.rows(p_change text, p_field text default null) returns integer
language sql as $$
  select count(*)::integer from public.inventory_change_log
   where product_id = '00000000-0000-0000-0000-000000004311'
     and change = p_change and (p_field is null or field = p_field);
$$;

select is(pg_temp.rows('created'), 1, 'creating a product writes a created row');

-- A delivery with a new cost, no actor set yet: the movement's staff is the actor.
select public.stock_receive('00000000-0000-0000-0000-000000004311', 1, 150, 'receipt', null, null,
  '00000000-0000-0000-0000-000000004301');
select is(
  (select array[old_value::text, new_value::text, actor_name] from public.inventory_change_log
    where product_id = '00000000-0000-0000-0000-000000004311' and change = 'stock'),
  array['5', '6', 'Cashier A'], 'a receipt writes a stock row, 5 → 6, by the person who booked it');
select is(
  (select array[old_value::text, new_value::text, actor_name] from public.inventory_change_log
    where product_id = '00000000-0000-0000-0000-000000004311' and field = 'cost_price'),
  array['100', '150', 'Cashier A'], 'the cost it changed is logged too, against the same person');

-- A plain edit, attributed through app.staff_id.
select set_config('app.staff_id', '00000000-0000-0000-0000-000000004301', true);
update public.products set price = 1200 where id = '00000000-0000-0000-0000-000000004311';
select is(
  (select array[old_value::text, new_value::text, actor_name] from public.inventory_change_log
    where product_id = '00000000-0000-0000-0000-000000004311' and field = 'price'),
  array['1000', '1200', 'Cashier A'], 'a price change is logged with old, new and who');

update public.products set price = 1200 where id = '00000000-0000-0000-0000-000000004311';
select is(pg_temp.rows('field', 'price'), 1, 'saving without changing anything writes nothing');

update public.products set name = 'Log Item Mk2', tag = 'New' where id = '00000000-0000-0000-0000-000000004311';
select is(pg_temp.rows('field'), 4, 'two columns changed, two more rows (cost, price, name, tag)');
select is(
  (select product_name from public.inventory_change_log
    where product_id = '00000000-0000-0000-0000-000000004311' and field = 'tag'),
  'Log Item Mk2', 'rows carry the product name as it was then');

select public.stock_consume('00000000-0000-0000-0000-000000004311', 2, 'correction', null, null,
  '00000000-0000-0000-0000-000000004301', 'shelf count');
select is(
  (select array[old_value::text, new_value::text, note] from public.inventory_change_log
    where product_id = '00000000-0000-0000-0000-000000004311' and stock_kind = 'correction'),
  array['6', '4', 'shelf count'], 'a correction is logged with its reason');

select public.complete_sale('00000000-0000-0000-0000-000000004301',
  '[{"product_id":"00000000-0000-0000-0000-000000004311","quantity":1,"unit_price":1200}]'::jsonb,
  '[{"tender":"cash","amount":1200}]'::jsonb);
select is(
  (select array[old_value::text, new_value::text, source_type] from public.inventory_change_log
    where product_id = '00000000-0000-0000-0000-000000004311' and stock_kind = 'sale'),
  array['4', '3', 'sale'], 'a till sale is logged as a stock change with its source');

update public.products set is_active = false where id = '00000000-0000-0000-0000-000000004311';
select is(pg_temp.rows('retired'), 1, 'retiring a product is logged');
update public.products set is_active = true where id = '00000000-0000-0000-0000-000000004311';
select is(pg_temp.rows('restored'), 1, 'restoring it is logged');

select is(
  (select shop_id from public.inventory_change_log
    where product_id = '00000000-0000-0000-0000-000000004311' limit 1),
  public.default_shop_id(), 'rows belong to the product''s shop');

select is(
  (select count(*)::integer from public.stock_intake_lines
    where product_id = '00000000-0000-0000-0000-000000004311'),
  0, 'none of it — not even a receipt made outside goods in — appears in Log A');

-- ---------------------------------------------------------------------------
-- Nothing in it can change, and it doesn't pin products
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.inventory_change_log set actor_name = 'someone else' $$,
  'P0001', 'The change log cannot be edited or deleted.', 'the log cannot be edited');
select throws_ok(
  $$ delete from public.inventory_change_log $$,
  'P0001', 'The change log cannot be edited or deleted.', 'the log cannot be deleted');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000004312', 'log-clean', 'Log Clean', 'cases', 1000, 100, 0);
select lives_ok(
  $$ delete from public.products where id = '00000000-0000-0000-0000-000000004312' $$,
  'a product with no sales can still be deleted — its created row doesn''t pin it');

select * from finish();
rollback;
