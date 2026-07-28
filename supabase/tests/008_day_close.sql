-- 008 — Day close
-- One scripted trading day with all six components the spec calls out,
-- then the expected-cash figure is hand-calculated and checked against what
-- the ledger actually says — not the other way around.
--
-- expected = opening float + petty in - petty out + net cash takings
-- where "net cash takings" is cash sales MINUS cash refunds MINUS cash
-- trade-in payouts — all three already live in the same transactions view,
-- refunds and payouts already negative, so summing amount where tender =
-- 'cash' naturally nets all three out correctly. The point of this file is
-- to prove that's actually true, not just assume it.

begin;
set local search_path to public, tap, extensions;
select plan(6);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000801', 'test-staff-008@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000000801', 'test-staff-008@example.invalid', 'Test Closer', 'owner');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000000810', 'day-close-test-item', 'Day Close Test Item', 'cases', 2000, 500, 100);

-- ---------------------------------------------------------------------------
-- The six events, all on one trading day
-- ---------------------------------------------------------------------------

-- 1. Opening float: £150.00
insert into public.cash_entries (trading_day, kind, amount, note, staff_id)
values (public.shop_day(now()), 'float_open', 15000, 'opening float', '00000000-0000-0000-0000-000000000801');

-- 2. A cash sale: £20.00
do $$ begin
  perform public.complete_sale(
    '00000000-0000-0000-0000-000000000801'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000810','quantity',1,'unit_price',2000,'list_price',2000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',2000))
  );
end $$;

-- 3. A card sale: £30.00 — must NOT move the expected-cash figure at all.
do $$ begin
  perform public.complete_sale(
    '00000000-0000-0000-0000-000000000801'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000810','quantity',1,'unit_price',3000,'list_price',3000)),
    jsonb_build_array(jsonb_build_object('tender','pos1','amount',3000))
  );
end $$;

-- 4. Petty cash in: £5.00
insert into public.cash_entries (trading_day, kind, amount, note, staff_id)
values (public.shop_day(now()), 'petty_in', 500, 'change float top-up', '00000000-0000-0000-0000-000000000801');

-- 5. Petty cash out: £3.00
insert into public.cash_entries (trading_day, kind, amount, note, staff_id)
values (public.shop_day(now()), 'petty_out', 300, 'milk and biscuits', '00000000-0000-0000-0000-000000000801');

-- 6. A cash refund: £8.00, against the cash sale above. Not a link-less
-- "goodwill, no receipt" refund — 0013 requires a refund to name exactly
-- one of a sale, an order or a job, so this now has to point at something.
do $$
declare
  v_cash_sale_id uuid;
begin
  select s.id into v_cash_sale_id
  from public.sales s
  join public.sale_payments sp on sp.sale_id = s.id
  where s.subtotal = 2000 and sp.tender = 'cash' and sp.amount = 2000;

  perform public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000000801', p_amount => 800, p_refund_tender => 'cash',
    p_reason => 'partial refund, cash back', p_sale_id => v_cash_sale_id
  );
end $$;

-- 7. A cash trade-in payout: £50.00 — money OUT of the same drawer.
insert into public.trade_in_payouts (id, device_label, customer_name, amount, method, staff_id)
values ('00000000-0000-0000-0000-000000000820', 'Day Close Test Trade-in', 'Trade-in Customer', -5000, 'cash', '00000000-0000-0000-0000-000000000801');

-- ---------------------------------------------------------------------------
-- The hand calculation
-- ---------------------------------------------------------------------------
-- float(15000) + petty_in(500) - petty_out(300) + cash_sale(2000)
--   - cash_refund(800) - cash_payout(5000) = 11400
--
-- Cash SALES come from sale_payments directly (the ledger's shop rows are
-- one per sale now, with no single tender — see 0010's own notes). Cash
-- refunds and the cash trade-in payout still have one real tender each and
-- read from the ledger as before.

select is(
  (
    (select coalesce(sum(amount), 0)::integer from public.sale_payments
      where tender = 'cash' and public.shop_day(created_at) = public.shop_day(now()))
    + (select coalesce(sum(amount), 0)::integer from public.transactions
        where tender = 'cash' and public.shop_day(at) = public.shop_day(now()))
  ),
  -3800,
  'net cash movement (cash sale minus cash refund minus cash payout) is exactly -3800p (2000 - 800 - 5000)'
);

select is(
  (
    (select amount from public.cash_entries where trading_day = public.shop_day(now()) and kind = 'float_open')
    + (select amount from public.cash_entries where trading_day = public.shop_day(now()) and kind = 'petty_in')
    - (select amount from public.cash_entries where trading_day = public.shop_day(now()) and kind = 'petty_out')
    + (select coalesce(sum(amount), 0) from public.sale_payments
        where tender = 'cash' and public.shop_day(created_at) = public.shop_day(now()))
    + (select coalesce(sum(amount), 0) from public.transactions
        where tender = 'cash' and public.shop_day(at) = public.shop_day(now()))
  )::integer,
  11400,
  'the full hand-calculated expected-cash figure is exactly 11400p (£114.00)'
);

-- The point made explicit: leaving the trade-in payout out of the sum is
-- exactly the bug the spec warns about, and it is off by exactly the
-- amount paid out — not some other number, exactly 5000.
select is(
  (
    (select amount from public.cash_entries where trading_day = public.shop_day(now()) and kind = 'float_open')
    + (select amount from public.cash_entries where trading_day = public.shop_day(now()) and kind = 'petty_in')
    - (select amount from public.cash_entries where trading_day = public.shop_day(now()) and kind = 'petty_out')
    + (select coalesce(sum(amount), 0) from public.sale_payments
        where tender = 'cash' and public.shop_day(created_at) = public.shop_day(now()))
    + (
        select coalesce(sum(amount), 0) from public.transactions
        where tender = 'cash' and public.shop_day(at) = public.shop_day(now()) and stream <> 'trade-in'
      )
  )::integer
  -
  11400,
  5000,
  'omitting the trade-in payout from the sum overstates expected cash by exactly what was paid out — the bug the spec calls out, reproduced and measured'
);

-- ---------------------------------------------------------------------------
-- Recording the close: variance is stored, not recomputed
-- ---------------------------------------------------------------------------

insert into public.day_close (trading_day, expected_amount, counted_amount, staff_id, note)
values (public.shop_day(now()), 11400, 11350, '00000000-0000-0000-0000-000000000801', 'till was £0.50 short');

select is(
  (select variance from public.day_close where trading_day = public.shop_day(now()))::integer,
  -50,
  'variance is counted (11350) minus expected (11400) = -50, a short drawer'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'day_close' and column_name = 'variance'
      and is_generated = 'NEVER'
  ),
  'variance is a generated column, not a plain value the caller has to compute and could get wrong'
);

select throws_ok(
  $$
  insert into public.day_close (trading_day, expected_amount, counted_amount, staff_id)
  values (public.shop_day(now()), 9999, 9999, '00000000-0000-0000-0000-000000000801')
  $$,
  null, null,
  'a second day_close for a trading day that already has one is refused (trading_day is unique)'
);

select * from finish();
rollback;
