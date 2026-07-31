-- 013 — Money can only move in the right direction
-- Every pence-typed column in public, swept and classified. Two groups:
--
-- ALLOWS NEGATIVE (by design — money moving OUT, or a figure that's honestly
-- signed either way):
--   pence (the domain itself — no floor; comment on the domain says so)
--   trade_in_payouts.amount        (always negative — enforced the other
--                                    direction, see below: a POSITIVE payout
--                                    is what's refused)
--   day_close.variance             (generated; a short drawer is negative)
--   day_close.expected_amount      (0019 dropped its floor deliberately — a
--                                    day with big cash payouts and few cash
--                                    sales genuinely projects negative, and
--                                    the owner must still be able to close)
--
-- FORBIDS NEGATIVE (every other pence column — prices, totals, subtotals,
-- fees, costs, deposits, quotes, refund/payment amounts):
--   products.price, products.cost_price, promo_tiers.unit_price,
--   stock_movements.unit_cost, delivery_rates.price, orders.subtotal,
--   orders.delivery_fee, orders.discount, orders.total (generated, clamped),
--   order_lines.unit_price, order_lines.cost_price, order_lines.line_total
--     (generated, product of two non-negative factors),
--   repair_types.base_price_original/oem/copy, jobs.quoted_price,
--   jobs.deposit_amount, jobs.revised_quote, job_payments.amount,
--   sell_requests.quoted_amount, trade_in_payouts.resale_price,
--   sales.subtotal, sales.discount, sales.cost, sales.total (generated,
--     clamped), sale_lines.unit_price/list_price/cost_price/line_total,
--   sale_payments.amount, refunds.amount, refund_lines.unit_price,
--   cash_entries.amount, day_close.counted_amount,
--   shop_settings.float_target
--
-- Most of these already had a CHECK before this file existed — this proves
-- them, doesn't just assume them, and the ones 0013 actually added
-- (day_close's two amount columns, the base/quote/resale price columns that
-- had never been given a floor, and the two discount-vs-subtotal caps) are
-- exactly the gaps this file exists to close.

begin;
set local search_path to public, tap, extensions;
select plan(15);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001301', 'test-staff-013@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001301', 'test-staff-013@example.invalid', 'Test Sweeper', 'owner');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001310', 'money-direction-item', 'Money Direction Item', 'cases', 1000, 400, 100);

-- ---------------------------------------------------------------------------
-- A refund amount cannot be negative or zero
-- ---------------------------------------------------------------------------

create temporary table _t013_sale as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001310','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000))
  ) as id;

select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001301', p_amount => -100, p_refund_tender => 'cash',
    p_reason => 'a negative refund would be a hidden charge', p_sale_id => (select id from _t013_sale)
  )
  $$,
  null, null,
  'a negative refund amount is refused — refunds.amount check (amount > 0) already covers this'
);
select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001301', p_amount => 0, p_refund_tender => 'cash',
    p_reason => 'a zero refund is meaningless', p_sale_id => (select id from _t013_sale)
  )
  $$,
  null, null,
  'a zero refund amount is refused too, not just negative'
);
select lives_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001301', p_amount => 100, p_refund_tender => 'cash',
    p_reason => 'a genuine positive refund', p_sale_id => (select id from _t013_sale)
  )
  $$,
  'a genuine positive refund amount is accepted'
);

-- ---------------------------------------------------------------------------
-- A deposit cannot be negative
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000001320', 'walk_in', 'Deposit Sweep Customer', 'Test phone', 'Test fault', 5000);

select throws_ok(
  $$ update public.jobs set deposit_amount = -500 where id = '00000000-0000-0000-0000-000000001320' $$,
  null, null,
  'a negative deposit is refused'
);

-- ---------------------------------------------------------------------------
-- A discount cannot exceed the subtotal — sales and orders
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001310','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000)),
    1001
  )
  $$,
  null, null,
  'a sale discount of 1001p against a 1000p subtotal is refused — the discount cannot exceed the subtotal'
);
select lives_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001301'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001310','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',0)),
    1000
  )
  $$,
  'a sale discount exactly equal to the subtotal (100% off) is still accepted — the cap is "not over", not "under"'
);

select throws_ok(
  $$
  insert into public.orders (customer_id, guest_email, delivery_method, subtotal, delivery_fee, discount)
  values (null, 'discount-sweep@example.invalid', 'collect', 1000, 0, 1001)
  $$,
  null, null,
  'an order discount exceeding the subtotal is refused, same rule as sales'
);
select lives_ok(
  $$
  insert into public.orders (customer_id, guest_email, delivery_method, subtotal, delivery_fee, discount)
  values (null, 'discount-sweep-2@example.invalid', 'collect', 1000, 0, 1000)
  $$,
  'an order discount exactly equal to the subtotal is accepted'
);
select lives_ok(
  $$
  insert into public.orders (customer_id, guest_email, delivery_method, address_line1, city, postcode, subtotal, delivery_fee, discount)
  values (null, 'discount-sweep-3@example.invalid', 'standard', '1 Test Street', 'Testville', 'TE1 1ST', 1000, 395, 1000)
  $$,
  'an order discount equal to the subtotal but less than subtotal+delivery_fee is accepted — the cap is against the subtotal, not the delivery fee, so the parcel still costs something'
);

-- ---------------------------------------------------------------------------
-- A payout is always negative — prove a positive one is refused
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.trade_in_payouts (device_label, customer_name, amount, method, staff_id)
  values ('Positive Payout Test', 'Test Customer', 500, 'cash', '00000000-0000-0000-0000-000000001301')
  $$,
  null, null,
  'a positive trade-in payout is refused — payouts are money out and must be negative'
);
select lives_ok(
  $$
  insert into public.trade_in_payouts (device_label, customer_name, amount, method, staff_id)
  values ('Negative Payout Test', 'Test Customer', -500, 'cash', '00000000-0000-0000-0000-000000001301')
  $$,
  'a genuine negative trade-in payout is accepted'
);

-- ---------------------------------------------------------------------------
-- The columns this sweep found with no floor at all before 0013
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.repair_types (name, base_price_original, base_price_oem, base_price_copy) values ('Negative Price Repair', -100, 100, 100) $$,
  null, null,
  'a negative repair base price is refused'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000001330', 'walk_in', 'Negative Quote Customer', 'Test phone', 'Test fault');
select throws_ok(
  $$ update public.jobs set quoted_price = -1000 where id = '00000000-0000-0000-0000-000000001330' $$,
  null, null,
  'a negative job quote is refused'
);

-- This asserted the opposite until migration 0019, which dropped
-- `day_close_expected_amount_not_negative` on purpose. Expected cash is a
-- projection (float + petty in − petty out + cash sales − cash refunds − cash
-- trade-in payouts), and a real trading day CAN land negative — a large cash
-- payout for a trade-in with no offsetting cash sales yet. Blocking it stopped
-- the owner closing the till at all, which is worse than recording the
-- shortfall: variance is what makes it visible.
--
-- The test, not the schema, was wrong. Left as `throws_ok` it failed on every
-- run, and a suite with a known-red test teaches everyone to ignore red.
select lives_ok(
  $$ insert into public.day_close (trading_day, expected_amount, counted_amount, staff_id) values (public.shop_day(now()) + 1000, -100, 0, '00000000-0000-0000-0000-000000001301') $$,
  'a negative expected_amount on a day close is ACCEPTED — the drawer can genuinely be projected short (0019)'
);
select throws_ok(
  $$ insert into public.day_close (trading_day, expected_amount, counted_amount, staff_id) values (public.shop_day(now()) + 1001, 0, -100, '00000000-0000-0000-0000-000000001301') $$,
  null, null,
  'a negative counted_amount on a day close is refused — you cannot count negative cash in a drawer, only be short against what was expected (that''s variance, which is allowed to be negative)'
);

select * from finish();
rollback;
