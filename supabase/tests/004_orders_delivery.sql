-- 004 — Orders and delivery
-- Postcode zoning first (the part most likely to be quietly wrong), then the
-- order status machine, delivery pricing, and the online-only rules.
--
-- Every order created here gets its own distinct guest_email, and every
-- later reference to "that order" looks it up by that email rather than
-- capturing an id into a variable — \gset and :'var' are psql-only client
-- meta-commands, not real SQL, so they don't survive being sent through
-- anything other than the actual psql binary. Keying off a unique fixture
-- field works everywhere.

begin;
set local search_path to public, tap, extensions;
select plan(51);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000401', 'test-staff-004@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000000401', 'test-staff-004@example.invalid', 'Test Reviewer', 'owner');

insert into public.products (id, slug, name, category, kind, price, cost_price, stock_qty, free_delivery) values
  ('00000000-0000-0000-0000-000000000410', 'ord-test-normal', 'Normal Item', 'cases', 'accessory', 1000, 500, 50, false),
  ('00000000-0000-0000-0000-000000000411', 'ord-test-free', 'Free Delivery Item', 'cases', 'accessory', 1000, 500, 50, true);

-- pgTAP finding, first real run of the suite: since 0064 (client decision
-- #14), kind is DERIVED from category_id by the products_derive_kind
-- trigger — it can no longer be set directly, and this row's old
-- `category = 'cases', kind = 'vape'` insert silently landed as an ordinary
-- accessory (category_id resolved from the legacy 'cases' category, which
-- isn't Vape or a subcategory of it — see fill_category_id_from_legacy_
-- category, 0046). The vape-rejection trigger itself was never broken;
-- this fixture just wasn't creating a real vape product any more once kind
-- stopped being a directly-settable column. category_id set explicitly
-- here, matching how "every real route" already does it per 0046's own
-- comment on that compatibility trigger.
insert into public.products (id, slug, name, category_id, price, cost_price, stock_qty, free_delivery) values
  ('00000000-0000-0000-0000-000000000412', 'ord-test-vape', 'Vape Test Item',
   (select id from public.categories where slug = 'vape'), 1000, 500, 50, false);

-- ---------------------------------------------------------------------------
-- Postcode zoning — longest-match, case/space insensitive, safe fallback
-- ---------------------------------------------------------------------------

select is((select code from public.delivery_zones where id = public.delivery_zone_for('TR21 0AA')), 'remote',   'TR21 0AA is remote (Isles of Scilly)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('TR1 1AA')),  'standard', 'TR1 1AA is standard (mainland Cornwall, TR is never seeded bare)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('TR2 7AA')),  'standard', 'TR2 7AA is standard');

select is((select code from public.delivery_zones where id = public.delivery_zone_for('PA20 9AA')), 'remote',   'PA20 9AA is remote');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('PA1 1AA')),   'standard', 'PA1 1AA is standard (Paisley, below the seeded PA20-78 range)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('PA79 1AA')),  'standard', 'PA79 1AA is standard (just outside the seeded PA20-78 range)');

select is((select code from public.delivery_zones where id = public.delivery_zone_for('PH17 2AA')), 'remote',   'PH17 2AA is remote');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('PH1 1AA')),  'standard', 'PH1 1AA is standard (Perth, below the seeded PH17-50 range)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('PH51 1AA')), 'standard', 'PH51 1AA is standard (just outside the seeded PH17-50 range)');

select is((select code from public.delivery_zones where id = public.delivery_zone_for('KA27 8AA')), 'remote',   'KA27 8AA is remote (Isle of Arran)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('KA1 1AA')),  'standard', 'KA1 1AA is standard');

select is((select code from public.delivery_zones where id = public.delivery_zone_for('BT1 1AA')), 'remote', 'BT1 1AA is remote (Northern Ireland)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('IM1 1AA')), 'remote', 'IM1 1AA is remote (Isle of Man)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('GY1 1AA')), 'remote', 'GY1 1AA is remote (Guernsey)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('JE1 1AA')), 'remote', 'JE1 1AA is remote (Jersey)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('IV1 1AA')), 'remote', 'IV1 1AA is remote (Inverness)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('HS1 2AA')), 'remote', 'HS1 2AA is remote (Outer Hebrides)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('KW1 4AA')), 'remote', 'KW1 4AA is remote (Caithness/Orkney)');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('ZE1 0AA')), 'remote', 'ZE1 0AA is remote (Shetland)');

select is((select code from public.delivery_zones where id = public.delivery_zone_for('tr21 0aa')),   'remote', 'lowercase resolves the same as uppercase');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('TR210AA')),    'remote', 'no space resolves the same');
select is((select code from public.delivery_zones where id = public.delivery_zone_for('TR21   0AA')), 'remote', 'extra internal spaces resolve the same');

select is((select code from public.delivery_zones where id = public.delivery_zone_for('ZZ99 9ZZ')), 'standard', 'a postcode matching no prefix falls back to standard, not an error or null');
select isnt(public.delivery_zone_for('ZZ99 9ZZ'), null, 'the fallback is a real zone id, not null');

-- ---------------------------------------------------------------------------
-- Order status machine
-- ---------------------------------------------------------------------------

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'standard'::delivery_method,
  null, 'status-test@example.invalid'::citext,
  'Status Test', '1 Test Street', null, 'Testville', null, 'SW1A 1AA'
);

select throws_ok(
  $$ update public.orders set status = 'shipped' where guest_email = 'status-test@example.invalid' $$,
  null, null, 'pending -> shipped is not a legal transition'
);

update public.orders set status = 'paid' where guest_email = 'status-test@example.invalid';

select throws_ok(
  $$ update public.orders set status = 'pending' where guest_email = 'status-test@example.invalid' $$,
  null, null, 'paid -> pending is not a legal transition (no going back to unpaid)'
);

update public.orders set status = 'shipped' where guest_email = 'status-test@example.invalid';

select throws_ok(
  $$ update public.orders set status = 'paid' where guest_email = 'status-test@example.invalid' $$,
  null, null, 'shipped -> paid is not a legal transition'
);

-- A real cancelled -> anything attempt, from an order genuinely in cancelled.
select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'collect'::delivery_method,
  null, 'cancel-test@example.invalid'::citext
);
update public.orders set status = 'cancelled' where guest_email = 'cancel-test@example.invalid';
select throws_ok(
  $$ update public.orders set status = 'paid' where guest_email = 'cancel-test@example.invalid' $$,
  null, null, 'cancelled -> paid is refused (cancelled is terminal, nothing leaves it)'
);
select throws_ok(
  $$ update public.orders set status = 'ready' where guest_email = 'cancel-test@example.invalid' $$,
  null, null, 'cancelled -> ready is refused too — nothing at all leaves cancelled'
);

-- Valid transitions, and the collect/delivery exclusivity.
select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'collect'::delivery_method,
  null, 'collect-test@example.invalid'::citext
);

select lives_ok(
  $$ update public.orders set status = 'paid' where guest_email = 'collect-test@example.invalid' $$,
  'pending -> paid succeeds on a collect order'
);
select throws_ok(
  $$ update public.orders set status = 'shipped' where guest_email = 'collect-test@example.invalid' $$,
  null, null, 'a collect order can never reach shipped'
);
select lives_ok(
  $$ update public.orders set status = 'collected' where guest_email = 'collect-test@example.invalid' $$,
  'a collect order can reach collected'
);

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'standard'::delivery_method,
  null, 'ship-test@example.invalid'::citext,
  'Ship Test', '1 Test Street', null, 'Testville', null, 'SW1A 1AA'
);
update public.orders set status = 'paid' where guest_email = 'ship-test@example.invalid';
select throws_ok(
  $$ update public.orders set status = 'collected' where guest_email = 'ship-test@example.invalid' $$,
  null, null, 'a delivery order can never reach collected'
);
select lives_ok(
  $$ update public.orders set status = 'shipped' where guest_email = 'ship-test@example.invalid' $$,
  'a delivery order can reach shipped'
);

-- ---------------------------------------------------------------------------
-- Documents gate ready/shipped
-- ---------------------------------------------------------------------------

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'standard'::delivery_method,
  null, 'plate-test@example.invalid'::citext,
  'Plate Test', '1 Test Street', null, 'Testville', null, 'SW1A 1AA'
);
update public.orders set status = 'paid' where guest_email = 'plate-test@example.invalid';

insert into public.order_documents (order_id, kind, storage_path)
select id, 'v5c', 'test/path/v5c.pdf' from public.orders where guest_email = 'plate-test@example.invalid';

select throws_ok(
  $$ update public.orders set status = 'ready' where guest_email = 'plate-test@example.invalid' $$,
  null, null, 'an order with a pending document cannot reach ready'
);

update public.order_documents
   set status = 'rejected', reviewed_by = '00000000-0000-0000-0000-000000000401', reviewed_at = now(), rejection_reason = 'blurry photo'
 where order_id = (select id from public.orders where guest_email = 'plate-test@example.invalid');
select throws_ok(
  $$ update public.orders set status = 'ready' where guest_email = 'plate-test@example.invalid' $$,
  null, null, 'an order with a rejected document cannot reach ready either'
);

update public.order_documents
   set status = 'approved', rejection_reason = null
 where order_id = (select id from public.orders where guest_email = 'plate-test@example.invalid');
select lives_ok(
  $$ update public.orders set status = 'ready' where guest_email = 'plate-test@example.invalid' $$,
  'approving the document allows the order to reach ready'
);

-- ---------------------------------------------------------------------------
-- Delivery charge
-- ---------------------------------------------------------------------------

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000411', 'quantity', 2)),
  'standard'::delivery_method, null, 'free-only@example.invalid'::citext,
  'Free', '1 Test Street', null, 'Testville', null, 'SW1A 1AA'
);
select is(
  (select delivery_fee from public.orders where guest_email = 'free-only@example.invalid')::integer,
  0,
  'a basket where every line is free_delivery has a delivery fee of zero'
);

select public.create_order(
  jsonb_build_array(
    jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000411', 'quantity', 1),
    jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)
  ),
  'standard'::delivery_method, null, 'mixed-basket@example.invalid'::citext,
  'Mixed', '1 Test Street', null, 'Testville', null, 'SW1A 1AA'
);
select ok(
  (select delivery_fee from public.orders where guest_email = 'mixed-basket@example.invalid')
  = (select price from public.delivery_rates dr join public.delivery_zones dz on dz.id = dr.zone_id where dz.code = 'standard' and dr.method = 'standard')::integer,
  'one normal item alongside a free-delivery item charges the FULL normal fee, not a discount or a pro-rated one'
);

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'standard'::delivery_method, null, 'normal-only@example.invalid'::citext,
  'Normal', '1 Test Street', null, 'Testville', null, 'SW1A 1AA'
);
select is(
  (select delivery_fee from public.orders where guest_email = 'normal-only@example.invalid')::integer,
  (select price from public.delivery_rates dr join public.delivery_zones dz on dz.id = dr.zone_id where dz.code = 'standard' and dr.method = 'standard')::integer,
  'a basket with no free-delivery items pays the normal rate'
);

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 5)),
  'collect'::delivery_method, null, 'collect-fee@example.invalid'::citext
);
select is(
  (select delivery_fee from public.orders where guest_email = 'collect-fee@example.invalid')::integer,
  0,
  'collect is always free, regardless of what is in the basket'
);

-- ---------------------------------------------------------------------------
-- Vapes: blocked online, sellable at the till
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  select public.create_order(
    jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000412', 'quantity', 1)),
    'collect'::delivery_method, null, 'vape-test@example.invalid'::citext
  )
  $$,
  null, null,
  'a vape in an online order is rejected at the database level'
);

-- The till has no such trigger on sale_lines — proved directly, without the
-- full complete_sale plumbing (staff/payments), since this is only proving
-- the ABSENCE of the online-only block, not till business rules (007 owns
-- those).
insert into public.sales (id, staff_id, subtotal, cost) values
  ('00000000-0000-0000-0000-000000000420', '00000000-0000-0000-0000-000000000401', 1000, 500);
select lives_ok(
  $$
  insert into public.sale_lines (sale_id, product_id, name, quantity, unit_price, list_price, cost_price)
  values ('00000000-0000-0000-0000-000000000420', '00000000-0000-0000-0000-000000000412', 'Vape Test Item', 1, 1000, 1000, 500)
  $$,
  'the same vape product sells fine at the till (no online-only block on sale_lines)'
);

-- ---------------------------------------------------------------------------
-- Guest orders
-- ---------------------------------------------------------------------------

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'collect'::delivery_method, null, 'guest@example.invalid'::citext
);
select ok(
  (select customer_id from public.orders where guest_email = 'guest@example.invalid') is null,
  'a guest order genuinely has no customer_id'
);
select isnt(
  (select reference from public.orders where guest_email = 'guest@example.invalid'),
  null,
  'a guest order still gets a reference'
);

-- ---------------------------------------------------------------------------
-- Stock: consumed once on paid, not twice on a retried webhook
-- ---------------------------------------------------------------------------

select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000410'),
  46,
  'sanity: stock_qty on the normal-item product is 50 minus everything already sold above (this run) before this scenario'
);

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 4)),
  'collect'::delivery_method, null, 'idempotency-test@example.invalid'::citext
);

update public.orders set status = 'paid' where guest_email = 'idempotency-test@example.invalid';
select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000410'),
  42,
  'reaching paid consumed the 4 units this order asked for'
);

-- Retried webhook: the same UPDATE, same target status, sent again.
update public.orders set status = 'paid' where guest_email = 'idempotency-test@example.invalid';
select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000410'),
  42,
  'setting paid a second time (a retried webhook) does not consume stock again'
);

-- ---------------------------------------------------------------------------
-- Cancelling a paid order returns the stock
-- ---------------------------------------------------------------------------

update public.orders set status = 'cancelled' where guest_email = 'idempotency-test@example.invalid';
select is(
  (select stock_qty from public.products where id = '00000000-0000-0000-0000-000000000410'),
  46,
  'cancelling a paid order returns the stock it consumed'
);

-- ---------------------------------------------------------------------------
-- Order lines keep their snapshot after the product changes
-- ---------------------------------------------------------------------------

select public.create_order(
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-000000000410', 'quantity', 1)),
  'collect'::delivery_method, null, 'snapshot-test@example.invalid'::citext
);

update public.products
   set name = 'Renamed After The Order', price = 999999
 where id = '00000000-0000-0000-0000-000000000410';

select is(
  (select ol.name from public.order_lines ol
   join public.orders o on o.id = ol.order_id
   where o.guest_email = 'snapshot-test@example.invalid'),
  'Normal Item',
  'the order line keeps the product name as it was at order time, not the renamed one'
);
select is(
  (select ol.unit_price from public.order_lines ol
   join public.orders o on o.id = ol.order_id
   where o.guest_email = 'snapshot-test@example.invalid')::integer,
  1000,
  'the order line keeps the price as it was at order time, not the later one'
);

select * from finish();
rollback;
