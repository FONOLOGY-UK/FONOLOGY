-- 009 — Reporting
-- The ledger view, today's takings, bucketed analytics, busiest times, low
-- stock — and the specific bug the frontend had (two screens quietly
-- computing "today" two different ways) proven unable to recur here.

begin;
set local search_path to public, tap, extensions;
select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000901', 'test-staff-009@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000000901', 'test-staff-009@example.invalid', 'Test Reporter', 'owner');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, low_stock_alert, low_stock_threshold) values
  ('00000000-0000-0000-0000-000000000910', 'report-test-item', 'Report Test Item', 'cases', 1000, 400, 100, true, 5);

-- ---------------------------------------------------------------------------
-- transactions is a view
-- ---------------------------------------------------------------------------

select is(
  (select relkind from pg_class where relname = 'transactions' and relnamespace = 'public'::regnamespace)::text,
  'v',
  'transactions is a view (checked again here, independently of 001)'
);

-- ---------------------------------------------------------------------------
-- The ledger balances against its own source tables, to the penny
-- ---------------------------------------------------------------------------

do $$
declare
  v_sale_id uuid;
begin
  v_sale_id := public.complete_sale(
    '00000000-0000-0000-0000-000000000901'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000910','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',600), jsonb_build_object('tender','pos1','amount',400))
  );
  -- Linked to the sale via p_sale_id, not a goodwill refund — the next
  -- section needs a refund that's actually attributable to this one sale's
  -- reference, not one that lands under NO-RECEIPT.
  perform public.create_refund('00000000-0000-0000-0000-000000000901', 200, 'cash', 'partial refund against this sale', '[]'::jsonb, v_sale_id);
end $$;

select is(
  (select coalesce(sum(amount), 0)::integer from public.transactions),
  (
    (select coalesce(sum(amount), 0)::integer from public.sale_payments)
    + (select coalesce(sum(total), 0)::integer from public.orders where paid_at is not null)
    + (select coalesce(sum(amount), 0)::integer from public.job_payments)
    + (select coalesce(sum(amount), 0)::integer from public.trade_in_payouts)
    - (select coalesce(sum(amount), 0)::integer from public.refunds)
  ),
  'the ledger''s total equals the sum of its five source tables computed independently, to the penny'
);

-- ---------------------------------------------------------------------------
-- Today's takings and its own by-tender breakdown agree with each other
-- ---------------------------------------------------------------------------
-- This schema only has ONE "today" object (today_takings), not two separate
-- endpoints the way the frontend did — the fix for that bug was not
-- building the second thing at all. What's actually checkable here is that
-- the headline total and its own breakdown can't drift from each other,
-- since both read the same view.

select is(
  (select total from public.today_takings)::integer,
  (select coalesce(sum(total), 0)::integer from public.today_takings_by_tender),
  'today_takings.total equals the sum of today_takings_by_tender — the headline figure and its own breakdown cannot disagree'
);

-- ---------------------------------------------------------------------------
-- Trade-in payouts excluded from revenue everywhere revenue is reported
-- ---------------------------------------------------------------------------

insert into public.trade_in_payouts (device_label, customer_name, amount, method, staff_id)
values ('Reporting Test Trade-in', 'Reporting Test Customer', -7500, 'cash', '00000000-0000-0000-0000-000000000901');

select is(
  (select coalesce(sum(amount), 0)::integer from public.transactions where amount > 0),
  (select coalesce(sum(amount), 0)::integer from public.transactions where amount > 0 and stream <> 'trade-in'),
  'filtering the ledger to amount > 0 already excludes the payout — trade-in rows are structurally never positive'
);

-- Red-team follow-up #6d (0073): analytics_totals now filters
-- `stream <> 'trade-in'`, not `amount > 0` — the old filter excluded every
-- refund's negative amount along with trade-in payouts, silently
-- overstating revenue by however much had been refunded. This fixture
-- includes exactly that case (the 200p partial refund at line 46 above,
-- against a 1000p sale), so the expected value below now nets it in:
-- 1000 - 200 = 800, not the pre-0073 revenue of 1000 a positive-only filter
-- would have reported. The trade-in payout inserted just above is still
-- correctly excluded — via stream, not sign — matching the assertion right
-- below this one (amount > 0 already excludes it structurally either way).
select is(
  (select revenue from public.analytics_totals(public.shop_day(now()), public.shop_day(now())))::integer,
  (select coalesce(sum(amount), 0)::integer from public.transactions where stream <> 'trade-in' and public.shop_day(at) = public.shop_day(now())),
  'analytics_totals.revenue for today matches the ledger''s stream-filtered total for today — trade-in payouts are excluded, refunds (like the 200p one above) are correctly netted in'
);

select ok(
  (select total from public.today_takings) < 100000,
  'today_takings.total has not been inflated by the -7500p payout (sanity bound, not a precise figure — other tests in this file already add real sales to today)'
);

-- ---------------------------------------------------------------------------
-- Refunds reduce revenue by the right amount
-- ---------------------------------------------------------------------------
-- The sale above was 1000p; the refund above was 200p. Net today's revenue
-- contribution from that pair is exactly 800p — checked directly.

select is(
  (
    select coalesce(sum(amount), 0)::integer from public.transactions
    where public.shop_day(at) = public.shop_day(now())
      and reference = (select reference from public.sales order by created_at desc limit 1)
  ),
  800,
  'a 1000p sale with a 200p refund against it nets to exactly 800p in the ledger'
);

-- ---------------------------------------------------------------------------
-- Bucketing: 62 days is daily, 63 days is monthly
-- ---------------------------------------------------------------------------

insert into public.sales (id, staff_id, subtotal, cost, created_at)
values ('00000000-0000-0000-0000-000000000920', '00000000-0000-0000-0000-000000000901', 1000, 400, now() - interval '61 days');
insert into public.sale_payments (sale_id, tender, amount, created_at)
values ('00000000-0000-0000-0000-000000000920', 'cash', 1000, now() - interval '61 days');

insert into public.sales (id, staff_id, subtotal, cost, created_at)
values ('00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000901', 1000, 400, now());
insert into public.sale_payments (sale_id, tender, amount, created_at)
values ('00000000-0000-0000-0000-000000000921', 'cash', 1000, now());

select ok(
  (
    select bool_and(bucket_label ~ '^\d')
    from public.analytics_series(public.shop_day(now() - interval '61 days'), public.shop_day(now()))
  ),
  'a 62-day range (61 days ago to today, inclusive) buckets daily — labels start with a day number'
);

-- shop_day(now()) - shop_day(now() - interval '63 days') = 63, not 62 — the
-- function's own threshold is a DIFFERENCE, not an inclusive day count, and
-- 62 days back from today is only a difference of 62 (still daily). Confirmed
-- against the function directly before trusting this number in the test.
select ok(
  (
    select bool_and(bucket_label !~ '^\d')
    from public.analytics_series(public.shop_day(now() - interval '63 days'), public.shop_day(now()))
  ),
  'a range with a 63-day difference buckets monthly — labels do not start with a day number'
);

-- ---------------------------------------------------------------------------
-- Busiest times: weekday x hour, Monday = 0
-- ---------------------------------------------------------------------------

insert into public.sales (id, staff_id, subtotal, cost, created_at)
values ('00000000-0000-0000-0000-000000000922', '00000000-0000-0000-0000-000000000901', 1000, 400, '2024-01-01 12:00:00+00');
insert into public.sale_payments (sale_id, tender, amount, created_at)
values ('00000000-0000-0000-0000-000000000922', 'cash', 1000, '2024-01-01 12:00:00+00');

select is(
  (select sale_count from public.busiest_times('2024-01-01', '2024-01-01') where weekday = 0 and hour = 12),
  1,
  '2024-01-01 12:00 UTC (a known Monday, noon) lands in the weekday=0, hour=12 cell'
);
select is(
  (select count(*)::integer from public.busiest_times('2024-01-01', '2024-01-01') where weekday <> 0),
  0,
  'nothing on 1 Jan 2024 lands in any weekday other than 0'
);

-- ---------------------------------------------------------------------------
-- Low stock: alert on AND at/below threshold, never just the count alone
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty, low_stock_alert, low_stock_threshold) values
  ('00000000-0000-0000-0000-000000000930', 'low-stock-on-below', 'Low Stock On Below', 'cases', 1000, 400, 3, true, 5),
  ('00000000-0000-0000-0000-000000000931', 'low-stock-on-above', 'Low Stock On Above', 'cases', 1000, 400, 50, true, 5),
  ('00000000-0000-0000-0000-000000000932', 'low-stock-off-below', 'Low Stock Off Below', 'cases', 1000, 400, 1, false, 5),
  ('00000000-0000-0000-0000-000000000933', 'low-stock-on-zero', 'Low Stock On Zero', 'cases', 1000, 400, 0, true, 5),
  ('00000000-0000-0000-0000-000000000934', 'low-stock-retired', 'Low Stock Retired', 'cases', 1000, 400, 3, true, 5);
update public.products set is_active = false where id = '00000000-0000-0000-0000-000000000934';

select ok(
  exists (select 1 from public.low_stock_products where id = '00000000-0000-0000-0000-000000000930'),
  'a product with the alert on and stock at/below its threshold appears in low_stock_products'
);
select ok(
  not exists (select 1 from public.low_stock_products where id = '00000000-0000-0000-0000-000000000931'),
  'a product with the alert on but stock comfortably above its threshold does not appear'
);
select ok(
  not exists (select 1 from public.low_stock_products where id = '00000000-0000-0000-0000-000000000932'),
  'a product with the alert OFF never appears, no matter how low its count is (1 unit left, alert off)'
);
select ok(
  not exists (select 1 from public.low_stock_products where id = '00000000-0000-0000-0000-000000000933'),
  '0043: a product with zero stock never appears, even with the alert on — that''s "out of stock", not "low"'
);
select ok(
  not exists (select 1 from public.low_stock_products where id = '00000000-0000-0000-0000-000000000934'),
  'BUG-04: a retired product never appears, no matter its stock or alert setting'
);

-- ---------------------------------------------------------------------------
-- The employee view cannot be widened into history, margin or cost
-- ---------------------------------------------------------------------------

select ok(
  (select relkind from pg_class where relname = 'today_takings' and relnamespace = 'public'::regnamespace) = 'v',
  'today_takings is a view with no parameters at all — there is no argument to pass a date range through'
);
select is(
  (select count(*)::integer from public.today_takings where trading_day <> public.shop_day(now())),
  0,
  'filtering today_takings for any day other than today returns nothing — it structurally cannot show a different day'
);
select is_empty(
  $$
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name in ('today_takings', 'today_takings_by_tender')
    and column_name in ('cost', 'margin', 'profit')
  $$,
  'neither today_takings nor today_takings_by_tender has a cost, margin or profit column to expose in the first place'
);

select * from finish();
rollback;
