-- 028 — Product reviews (0062), purchase verification
--
-- The one thing this file exists to prove: a customer cannot review a
-- product they haven't bought, and this is enforced by the DATABASE, not
-- trusted from the API — every insert attempt here goes straight at
-- product_reviews, bypassing any application code entirely.

begin;
set local search_path to public, tap, extensions;
select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002801', 'test-buyer-028@example.invalid'),
  ('00000000-0000-0000-0000-000000002802', 'test-nonbuyer-028@example.invalid');

insert into public.customers (id, email, name) values
  ('00000000-0000-0000-0000-000000002801', 'test-buyer-028@example.invalid', 'Test Buyer 028'),
  ('00000000-0000-0000-0000-000000002802', 'test-nonbuyer-028@example.invalid', 'Test Non-Buyer 028');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000002810', 'review-test-widget', 'Review Test Widget', 'cases', 1500, 0, 50);

-- A second product the buyer never ordered — proves purchase-checking is
-- per PRODUCT, not "has this customer ever ordered anything".
insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000002811', 'review-test-widget-2', 'Review Test Widget Two', 'cases', 1500, 0, 50);

-- Buyer's order: paid, contains product 002810.
insert into public.orders (id, customer_id, delivery_method, subtotal, delivery_fee, discount, status)
values ('00000000-0000-0000-0000-000000002820', '00000000-0000-0000-0000-000000002801', 'collect', 1500, 0, 0, 'paid');

insert into public.order_lines (order_id, product_id, name, unit_price, quantity)
values ('00000000-0000-0000-0000-000000002820', '00000000-0000-0000-0000-000000002810', 'Review Test Widget', 1500, 1);

-- Buyer's SECOND order: still pending (never paid) — must NOT count as a purchase.
insert into public.orders (id, customer_id, delivery_method, subtotal, delivery_fee, discount, status)
values ('00000000-0000-0000-0000-000000002821', '00000000-0000-0000-0000-000000002801', 'collect', 1500, 0, 0, 'pending');

insert into public.order_lines (order_id, product_id, name, unit_price, quantity)
values ('00000000-0000-0000-0000-000000002821', '00000000-0000-0000-0000-000000002811', 'Review Test Widget Two', 1500, 1);

-- Non-buyer's order: paid, but for a DIFFERENT product.
insert into public.orders (id, customer_id, delivery_method, subtotal, delivery_fee, discount, status)
values ('00000000-0000-0000-0000-000000002822', '00000000-0000-0000-0000-000000002802', 'collect', 1500, 0, 0, 'paid');

insert into public.order_lines (order_id, product_id, name, unit_price, quantity)
values ('00000000-0000-0000-0000-000000002822', '00000000-0000-0000-0000-000000002811', 'Review Test Widget Two', 1500, 1);

-- Cancelled order for the non-buyer, containing the review product — must
-- NOT count as a purchase either.
insert into public.orders (id, customer_id, delivery_method, subtotal, delivery_fee, discount, status)
values ('00000000-0000-0000-0000-000000002823', '00000000-0000-0000-0000-000000002802', 'collect', 1500, 0, 0, 'cancelled');

insert into public.order_lines (order_id, product_id, name, unit_price, quantity)
values ('00000000-0000-0000-0000-000000002823', '00000000-0000-0000-0000-000000002810', 'Review Test Widget', 1500, 1);

-- ---------------------------------------------------------------------------
-- customer_purchased_product() itself
-- ---------------------------------------------------------------------------

select ok(
  public.customer_purchased_product('00000000-0000-0000-0000-000000002801', '00000000-0000-0000-0000-000000002810'),
  'the buyer has a paid order containing the review product — counts as purchased'
);

select ok(
  not public.customer_purchased_product('00000000-0000-0000-0000-000000002801', '00000000-0000-0000-0000-000000002811'),
  'the buyer never ordered the SECOND product — not purchased, even though they bought something else'
);

select ok(
  not public.customer_purchased_product('00000000-0000-0000-0000-000000002802', '00000000-0000-0000-0000-000000002810'),
  'the non-buyer''s only order for this product is CANCELLED — not purchased'
);

select ok(
  public.customer_purchased_product('00000000-0000-0000-0000-000000002802', '00000000-0000-0000-0000-000000002811'),
  'sanity: the non-buyer DID pay for the OTHER product — proves the function checks the right product, not just "any purchase"'
);

-- ---------------------------------------------------------------------------
-- The real enforcement: inserting into product_reviews directly
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002830', '00000000-0000-0000-0000-000000002810',
          '00000000-0000-0000-0000-000000002801', 5, 'Great case, does the job.')
  $$,
  'a customer who genuinely bought the product can insert a review'
);

select throws_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002831', '00000000-0000-0000-0000-000000002811',
          '00000000-0000-0000-0000-000000002801', 5, 'Never bought this one')
  $$,
  null, null,
  'the SAME customer cannot review a product they never bought — the trigger fires per-product, not per-customer-ever-ordered'
);

select throws_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002832', '00000000-0000-0000-0000-000000002810',
          '00000000-0000-0000-0000-000000002802', 3, 'Only my order was cancelled')
  $$,
  null, null,
  'a cancelled order does not count as a purchase — review rejected'
);

select throws_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002833', '00000000-0000-0000-0000-000000002811',
          '00000000-0000-0000-0000-000000002801', 4, 'Still just pending, not paid')
  $$,
  null, null,
  'a pending (unpaid) order does not count as a purchase — review rejected'
);

-- ---------------------------------------------------------------------------
-- One review per product per customer
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002834', '00000000-0000-0000-0000-000000002810',
          '00000000-0000-0000-0000-000000002801', 1, 'Trying to review the same product twice')
  $$,
  null, null,
  'the same customer cannot review the same product a second time — unique(product_id, customer_id)'
);

-- ---------------------------------------------------------------------------
-- Length cap and rating bounds (basic anti-spam / validity)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002835', '00000000-0000-0000-0000-000000002811',
          '00000000-0000-0000-0000-000000002802', 5, '')
  $$,
  null, null,
  'an empty review body is rejected'
);

select throws_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002836', '00000000-0000-0000-0000-000000002811',
          '00000000-0000-0000-0000-000000002802', 5, repeat('x', 2001))
  $$,
  null, null,
  'a review over 2000 characters is rejected at the database, not just the API'
);

select throws_ok(
  $$
  insert into public.product_reviews (id, product_id, customer_id, rating, body)
  values ('00000000-0000-0000-0000-000000002837', '00000000-0000-0000-0000-000000002811',
          '00000000-0000-0000-0000-000000002802', 6, 'Six stars out of five')
  $$,
  null, null,
  'a rating outside 1-5 is rejected'
);

-- ---------------------------------------------------------------------------
-- Approval workflow
-- ---------------------------------------------------------------------------

select is(
  (select is_approved from public.product_reviews where id = '00000000-0000-0000-0000-000000002830'),
  false,
  'every review lands pending by default'
);

select throws_ok(
  $$
  update public.product_reviews set is_approved = true where id = '00000000-0000-0000-0000-000000002830'
  $$,
  null, null,
  'approving without setting approved_by/approved_at violates the consistency check'
);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000002803', 'test-owner-028@example.invalid');
insert into public.staff (id, email, name, role)
values ('00000000-0000-0000-0000-000000002803', 'test-owner-028@example.invalid', 'Test Owner 028', 'owner');

select lives_ok(
  $$
  update public.product_reviews
     set is_approved = true, approved_by = '00000000-0000-0000-0000-000000002803', approved_at = now()
   where id = '00000000-0000-0000-0000-000000002830'
  $$,
  'approving with both approved_by and approved_at set succeeds'
);

select ok(
  exists (
    select 1 from pg_class where relname = 'product_reviews' and relnamespace = 'public'::regnamespace
      and relrowsecurity and relforcerowsecurity
  ),
  'row level security is enabled AND forced on product_reviews'
);

select * from finish();
rollback;
