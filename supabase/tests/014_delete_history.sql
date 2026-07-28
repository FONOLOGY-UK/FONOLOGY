-- 014 — Deleting things that have history
-- For each entity: either the delete is refused, or the history survives it
-- with its snapshot intact. Both are proven by actually deleting, not by
-- reading a foreign key definition and assuming.

begin;
set local search_path to public, tap, extensions;
select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001401', 'test-staff-014@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001401', 'test-staff-014@example.invalid', 'Test Historian', 'owner');

-- ---------------------------------------------------------------------------
-- A product with real history (a completed sale, a paid order) can't be
-- deleted — refused, not silently stripped of its history
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001410', 'delete-history-item', 'Delete History Item', 'cases', 1000, 400, 100);

create temporary table _t014_sale as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001401'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001410','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000))
  ) as id;

create temporary table _t014_order as
  select public.create_order(
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001410','quantity',1)),
    'collect'::delivery_method,
    p_guest_email => 'delete-history-order@example.invalid'
  ) as id;
update public.orders set status = 'paid' where id = (select id from _t014_order);

select throws_ok(
  $$ delete from public.products where id = '00000000-0000-0000-0000-000000001410' $$,
  null, null,
  'a product that has been sold and ordered cannot be deleted — stock_movements references it and is ON DELETE RESTRICT'
);
select is(
  (select name from public.sale_lines where sale_id = (select id from _t014_sale)),
  'Delete History Item',
  'the sale line still carries its own snapshot of the product name, untouched by the refused delete attempt'
);
select is(
  (select name from public.order_lines where order_id = (select id from _t014_order)),
  'Delete History Item',
  'the order line still carries its own snapshot too'
);

-- A product with genuinely no history — never sold, no movements at all —
-- can be deleted cleanly, and its purely-catalogue children (not history)
-- go with it.
insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001411', 'delete-clean-item', 'Delete Clean Item', 'cases', 1000, 400, 0);
insert into public.promotions (id, product_id, label) values
  ('00000000-0000-0000-0000-000000001412', '00000000-0000-0000-0000-000000001411', 'Test promo');
select lives_ok(
  $$ delete from public.products where id = '00000000-0000-0000-0000-000000001411' $$,
  'a product with no transaction history at all can be deleted cleanly'
);
select is(
  (select count(*)::integer from public.promotions where id = '00000000-0000-0000-0000-000000001412'),
  0,
  'its promotion — catalogue metadata, not transaction history — cascaded away with it'
);

-- ---------------------------------------------------------------------------
-- A supplier with stock and products: nulled, history intact
-- ---------------------------------------------------------------------------
-- Decision: products.supplier_id is ON DELETE SET NULL (already the schema's
-- existing behaviour, not new in 0013) — a supplier is catalogue metadata
-- about where stock comes from, not a transaction record anything else
-- snapshots, so there's no history to lose by nulling it. Proven here
-- directly rather than assumed from the FK definition.

insert into public.suppliers (id, name) values ('00000000-0000-0000-0000-000000001420', 'Delete Test Supplier');
insert into public.products (id, slug, name, category, price, cost_price, stock_qty, supplier_id) values
  ('00000000-0000-0000-0000-000000001421', 'supplier-delete-item', 'Supplier Delete Item', 'cases', 1000, 400, 50, '00000000-0000-0000-0000-000000001420');

select lives_ok(
  $$ delete from public.suppliers where id = '00000000-0000-0000-0000-000000001420' $$,
  'deleting a supplier that has products (with stock) succeeds — nulled, not refused'
);
select ok(
  (select supplier_id is null and stock_qty = 50 and name = 'Supplier Delete Item' from public.products where id = '00000000-0000-0000-0000-000000001421'),
  'the product survives with supplier_id nulled, its stock and identity completely untouched'
);

-- ---------------------------------------------------------------------------
-- Staff: deactivated, never deleted — history keeps their name
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001430', 'staff-history@example.invalid')
  on conflict do nothing;
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001430', 'staff-history@example.invalid', 'Staff With History', 'employee');

create temporary table _t014_staff_sale as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001430'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001410','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000))
  ) as id;

select lives_ok(
  $$ update public.staff set is_active = false where id = '00000000-0000-0000-0000-000000001430' $$,
  'deactivating a staff member who has a sale on record succeeds'
);
select is(
  (select staff_id from public.sales where id = (select id from _t014_staff_sale)),
  '00000000-0000-0000-0000-000000001430'::uuid,
  'the sale still points at the (now inactive) staff member — their name stays reachable through the FK, not erased'
);
select throws_ok(
  $$ delete from public.staff where id = '00000000-0000-0000-0000-000000001430' $$,
  null, null,
  'hard-deleting a staff member with a sale on record is refused — sales.staff_id has no ON DELETE clause, so it defaults to blocking'
);

-- ---------------------------------------------------------------------------
-- Customers: deleting one with orders leaves the orders intact, guest-shaped
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001440', 'customer-history@example.invalid')
  on conflict do nothing;
insert into public.customers (id, email, name) values ('00000000-0000-0000-0000-000000001440', 'customer-history@example.invalid', 'Customer With History');

create temporary table _t014_customer_order as
  select public.create_order(
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001410','quantity',1)),
    'collect'::delivery_method,
    p_customer_id => '00000000-0000-0000-0000-000000001440'
  ) as id;

select is(
  (select guest_email from public.orders where id = (select id from _t014_customer_order)),
  null,
  'sanity check: this order genuinely has no guest_email yet — it was placed by a registered customer, not a guest'
);

select lives_ok(
  $$ delete from public.customers where id = '00000000-0000-0000-0000-000000001440' $$,
  'deleting a customer who has an order on record succeeds — the order survives as guest-shaped, it does not block the delete'
);
select ok(
  (
    select customer_id is null and guest_email = 'customer-history@example.invalid'
    from public.orders where id = (select id from _t014_customer_order)
  ),
  'the order survives: customer_id is nulled by the delete, and guest_email was backfilled from the customer''s own email before the row went — orders_guest_or_customer still holds'
);

select * from finish();
rollback;
