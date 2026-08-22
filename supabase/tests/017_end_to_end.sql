-- 017 — One real fixture through the whole thing
-- Everything else in this suite proves one rule at a time with the smallest
-- fixture that can prove it. This file is the opposite: one realistic day,
-- built entirely through the real functions (never a hand-inserted sale or
-- order row), covering every kind of money movement the schema has — and
-- then the ledger, today's takings, tender breakdown and analytics are all
-- checked against figures worked out by hand, not against whatever the
-- functions happen to return. This is the closest thing here to what the
-- API will actually do in a day of real trading.

begin;
set local search_path to public, tap, extensions;
select plan(14);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001701', 'test-staff-017@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001701', 'test-staff-017@example.invalid', 'Test Fixture', 'owner');

-- ---------------------------------------------------------------------------
-- A handful of real products, with stock received at real costs
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001710', 'e2e-case', 'E2E Case', 'cases', 1500, 0, 0),
  ('00000000-0000-0000-0000-000000001711', 'e2e-charger', 'E2E Charger', 'power', 2000, 0, 0),
  ('00000000-0000-0000-0000-000000001712', 'e2e-repair-part', 'E2E Repair Part', 'cases', 0, 0, 0);

do $$ begin
  perform public.stock_receive('00000000-0000-0000-0000-000000001710', 50, 600, 'receipt', null, null, '00000000-0000-0000-0000-000000001701', null);
  perform public.stock_receive('00000000-0000-0000-0000-000000001711', 30, 800, 'receipt', null, null, '00000000-0000-0000-0000-000000001701', null);
  perform public.stock_receive('00000000-0000-0000-0000-000000001712', 20, 500, 'receipt', null, null, '00000000-0000-0000-0000-000000001701', null);
end $$;

-- ---------------------------------------------------------------------------
-- A guest online order, paid, stock consumed
-- ---------------------------------------------------------------------------
-- 2x E2E Case @ 1500 = 3000 subtotal, collect (no delivery fee), no discount.
-- amount = 3000, cost = 2 x 600 = 1200.

create temporary table _t017_order as
  select public.create_order(
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001710','quantity',2)),
    'collect'::delivery_method, p_guest_email => 'e2e-guest@example.invalid'
  ) as id;
update public.orders set status = 'paid' where id = (select id from _t017_order);

-- ---------------------------------------------------------------------------
-- A walk-in till sale, three-way split payment
-- ---------------------------------------------------------------------------
-- 1x E2E Charger @ 2000 + 1x E2E Case @ 1500 = 3500 subtotal, no discount.
-- amount = 3500, cost = 800 + 600 = 1400. Split cash 1200 + pos1 1200 + pos2 1100.

create temporary table _t017_sale as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001701'::uuid,
    jsonb_build_array(
      jsonb_build_object('product_id','00000000-0000-0000-0000-000000001711','quantity',1,'unit_price',2000,'list_price',2000),
      jsonb_build_object('product_id','00000000-0000-0000-0000-000000001710','quantity',1,'unit_price',1500,'list_price',1500)
    ),
    jsonb_build_array(
      jsonb_build_object('tender','cash','amount',1200),
      jsonb_build_object('tender','pos1','amount',1200),
      jsonb_build_object('tender','pos2','amount',1100)
    )
  ) as id;

-- ---------------------------------------------------------------------------
-- A mail-in repair: booked, parts consumed, revised quote approved, sent back
-- ---------------------------------------------------------------------------
-- Quoted at 5000, revised to 7000 once opened up, paid in full on completion.
-- One part fitted, unit_cost 500 at fitting time — that 500 is the job's
-- entire cost, attached once, to the payment that completes it (0010/0013).

insert into public.devices (id, name, brand, price_multiplier) values
  ('00000000-0000-0000-0000-000000001720', 'E2E Test Device', 'TestBrand', 1.00);
insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy) values
  ('00000000-0000-0000-0000-000000001721', 'E2E Test Repair', 5000, 5000, 5000);
insert into public.bookings (id, reference, device_id, repair_type_id, tier, quoted_price, customer_name, phone, email, address_line1, city, postcode, preferred_contact)
values ('00000000-0000-0000-0000-000000001722', 'FNL-E2E-BOOKING', '00000000-0000-0000-0000-000000001720', '00000000-0000-0000-0000-000000001721', 'original', 5000, 'E2E Mail-in Customer', '07000000001', 'e2e-mailin@example.invalid', '1 E2E Street', 'E2E Town', 'E1 1ST', 'email');

insert into public.jobs (id, source, booking_id, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000001723', 'mail_in', '00000000-0000-0000-0000-000000001722', 'E2E Mail-in Customer', 'E2E phone', 'Screen and battery', 5000);

do $$ begin perform public.add_job_part('00000000-0000-0000-0000-000000001723', '00000000-0000-0000-0000-000000001712', 1, '00000000-0000-0000-0000-000000001701'); end $$;

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000001723';
update public.jobs set status = 'waiting_approval', revised_quote = 7000 where id = '00000000-0000-0000-0000-000000001723';
update public.jobs set status = 'in_progress', revised_quote_approved_by = '00000000-0000-0000-0000-000000001701', revised_quote_approved_at = now() where id = '00000000-0000-0000-0000-000000001723';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000001723';

do $$ begin perform public.record_job_payment('00000000-0000-0000-0000-000000001723', 'balance', 7000, 'pos1', '00000000-0000-0000-0000-000000001701'); end $$;

update public.jobs set status = 'sent_back', return_tracking_number = 'E2E-TRACK-001' where id = '00000000-0000-0000-0000-000000001723';

select is(
  (select payment_status from public.jobs where id = '00000000-0000-0000-0000-000000001723')::text,
  'paid',
  'the mail-in repair job reached paid after the single 7000p payment against its 7000p revised quote'
);

-- ---------------------------------------------------------------------------
-- A trade-in: quoted, accepted, paid out, restocked
-- ---------------------------------------------------------------------------
-- Quoted and paid 3000p cash, restocked as a new product.

insert into public.sell_requests (id, name, phone, email, preferred_contact, device_other, condition)
values ('00000000-0000-0000-0000-000000001730', 'E2E Trade-in Customer', '07000000002', 'e2e-tradein@example.invalid', 'email', 'Unlisted phone', '{"storage":"64GB","screen":"good","body":"good","powers_on":true,"network":"unlocked","accessories":[]}'::jsonb);
update public.sell_requests set status = 'quoted', quoted_amount = 3000, quoted_by = '00000000-0000-0000-0000-000000001701', quoted_at = now() where id = '00000000-0000-0000-0000-000000001730';
update public.sell_requests set status = 'accepted' where id = '00000000-0000-0000-0000-000000001730';

insert into public.trade_in_payouts (id, sell_request_id, device_label, customer_name, amount, method, staff_id)
values ('00000000-0000-0000-0000-000000001731', '00000000-0000-0000-0000-000000001730', 'E2E Unlisted Phone', 'E2E Trade-in Customer', -3000, 'cash', '00000000-0000-0000-0000-000000001701');

select is(
  (select status from public.sell_requests where id = '00000000-0000-0000-0000-000000001730')::text,
  'paid',
  'the trade-in request auto-advanced to paid the moment its payout was recorded'
);

-- p_category_id is a real categories.id now (0045, FEATURE-05).
do $$ begin
  perform public.restock_trade_in('00000000-0000-0000-0000-000000001731', 'E2E Restocked Phone',
    (select id from public.categories where slug = 'cases'), 2500, 'accessory', '00000000-0000-0000-0000-000000001701');
end $$;

select ok(
  (select restocked from public.trade_in_payouts where id = '00000000-0000-0000-0000-000000001731'),
  'the trade-in was restocked as real, sellable stock'
);

-- ---------------------------------------------------------------------------
-- A partial refund against the till sale
-- ---------------------------------------------------------------------------

do $$ begin
  perform public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001701', p_amount => 500, p_refund_tender => 'cash',
    p_reason => 'e2e partial refund', p_sale_id => (select id from _t017_sale)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Hand-calculated reconciliation
-- ---------------------------------------------------------------------------
-- Five ledger rows today:
--   order:   amount  3000  cost 1200
--   sale:    amount  3500  cost 1400
--   repair:  amount  7000  cost  500
--   payout:  amount -3000  cost    0
--   refund:  amount  -500  cost    0
-- Ledger total (everything):        3000+3500+7000-3000-500 = 10000
-- today_takings (amount > 0 only):  3000+3500+7000          = 13500
-- cost on the positive rows only:   1200+1400+500            = 3100
-- profit on today_takings' revenue: 13500 - 3100             = 10400

select is(
  (select coalesce(sum(amount),0)::integer from public.transactions where public.shop_day(at) = public.shop_day(now())),
  10000,
  'the whole day''s ledger (every stream, positive and negative) sums to exactly 10000p'
);
select is(
  (select total from public.today_takings)::integer,
  13500,
  'today_takings.total is the gross positive-only figure, 13500p — refunds and the payout are tracked separately, not netted in here'
);
select is(
  (select revenue from public.analytics_totals(public.shop_day(now()), public.shop_day(now())))::integer,
  13500,
  'analytics_totals.revenue for today agrees with today_takings.total exactly'
);
select is(
  (select cost from public.analytics_totals(public.shop_day(now()), public.shop_day(now())))::integer,
  3100,
  'analytics_totals.cost for today is exactly 1200 (order) + 1400 (sale) + 500 (repair part) = 3100p'
);
select is(
  (select profit from public.analytics_totals(public.shop_day(now()), public.shop_day(now())))::integer,
  10400,
  'analytics_totals.profit is exactly revenue minus cost, 13500 - 3100 = 10400p'
);

-- Tender breakdown: only sale_payments and job_payments carry a real tender
-- (the order was paid online, not through a till tender; the payout and
-- refund are their own money-out figures, not takings by tender).
--   cash: 1200 (sale)                                = 1200
--   pos1: 1200 (sale) + 7000 (repair)                 = 8200
--   pos2: 1100 (sale)                                 = 1100
select is(
  (select total from public.today_takings_by_tender where tender = 'cash')::integer,
  1200,
  'cash tender total for today is exactly the sale''s cash portion, 1200p'
);
select is(
  (select total from public.today_takings_by_tender where tender = 'pos1')::integer,
  8200,
  'pos1 tender total combines the sale''s 1200p portion and the repair''s full 7000p payment, 8200p'
);
-- Unlike 009_reporting.sql's version of this check, this fixture has an
-- online order in it — money that came in with no till tender at all
-- (stripe/clearpay, not cash/pos1/pos2). The by-tender breakdown correctly
-- excludes it (0010's own comment: "online order payments ... correctly
-- don't appear"), so the two figures are NOT expected to match here; the
-- gap between them should be exactly that order's 3000p.
select is(
  (
    (select total from public.today_takings)::integer
    - (select coalesce(sum(total),0)::integer from public.today_takings_by_tender)
  ),
  3000,
  'today_takings.total exceeds the sum of today_takings_by_tender by exactly 3000p — the online order''s revenue, which has no till tender to appear under'
);

-- revenue_by_category only ever covers till and online product lines — the
-- repair (7000p) and the trade-in payout (-3000p) are neither a product nor
-- a category, and must not appear in it at all.
select is(
  (select coalesce(sum(revenue),0)::integer from public.revenue_by_category(public.shop_day(now()), public.shop_day(now()))),
  6500,
  'revenue_by_category sums to exactly the order + sale product revenue (3000 + 3500 = 6500p), correctly excluding the repair and the trade-in'
);

-- ---------------------------------------------------------------------------
-- A day close covering all of it
-- ---------------------------------------------------------------------------
-- expected = float_open + cash sale_payments + cash refunds/payouts (from
-- the ledger, tender = 'cash'): 15000 + 1200 + (-500 refund) + (-3000 payout)
--                              = 15000 + 1200 - 3500 = 12700

insert into public.cash_entries (trading_day, kind, amount, note, staff_id)
values (public.shop_day(now()), 'float_open', 15000, 'e2e opening float', '00000000-0000-0000-0000-000000001701');

-- The ledger's shop-sale rows carry tender = null (0010/0013 — cost and
-- tender aren't split across a sale's payments there), so "tender = 'cash'"
-- against public.transactions only ever matches the refund and the payout
-- here; the sale's own cash portion has to come from sale_payments directly,
-- same pattern as 008_day_close.sql.
select is(
  (
    (select amount from public.cash_entries where trading_day = public.shop_day(now()) and kind = 'float_open')
    + (select coalesce(sum(amount),0) from public.sale_payments where tender = 'cash' and public.shop_day(created_at) = public.shop_day(now()))
    + (select coalesce(sum(amount),0) from public.transactions where tender = 'cash' and public.shop_day(at) = public.shop_day(now()))
  )::integer,
  12700,
  'the full day''s hand-calculated expected cash figure is exactly 12700p — float plus the sale''s cash portion, minus the cash refund and the cash trade-in payout'
);

insert into public.day_close (trading_day, expected_amount, counted_amount, staff_id, note)
values (public.shop_day(now()), 12700, 12700, '00000000-0000-0000-0000-000000001701', 'e2e fixture — till matched exactly');

select is(
  (select variance from public.day_close where trading_day = public.shop_day(now()))::integer,
  0,
  'the day close for this fixture shows zero variance — the till matched what the ledger says it should'
);

select * from finish();
rollback;
