-- 023 — Cash repair payments in expected cash (migration 0031)
--
-- The bug 0031 fixes: computeExpectedCash never read job_payments, so every
-- cash repair deposit or balance was money in the drawer that the expected
-- figure did not know about — a phantom overage on every such day.
--
-- The DB's job here is narrower than the route's: it cannot compute expected
-- cash, but it CAN refuse to store a breakdown that doesn't explain the total
-- beside it. This file covers the superseded seven-term constraints, that
-- historical rows survived the change, and — the part that actually protects
-- the money — that a cash repair payment shifts the expected figure by
-- exactly its own amount while a card repair payment shifts it by nothing.

begin;
set local search_path to public, tap, extensions;
select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000231', 'test-staff-023@example.invalid');

insert into public.staff (id, email, name, role)
values (
  '00000000-0000-0000-0000-000000000231',
  'test-staff-023@example.invalid',
  'Test Closer 023',
  'owner'
);

-- ---------------------------------------------------------------------------
-- The column exists and stays nullable
-- ---------------------------------------------------------------------------

select has_column('public', 'day_close', 'cash_repairs', 'day_close.cash_repairs exists (0031)');

-- Nullable is load-bearing: rows closed before 0024 have NO breakdown at all,
-- and a NOT NULL DEFAULT 0 would have given them exactly one non-null term,
-- breaking all-or-none for every one of them.
select col_is_null(
  'public', 'day_close', 'cash_repairs',
  'cash_repairs is nullable — pre-0024 rows must keep an entirely empty breakdown'
);

-- ---------------------------------------------------------------------------
-- Historical shapes still valid
-- ---------------------------------------------------------------------------

-- A pre-0024 row: no breakdown whatsoever.
select lives_ok(
  $$
  insert into public.day_close (trading_day, expected_amount, counted_amount, staff_id)
  values (date '2021-02-01', 15000, 15000, '00000000-0000-0000-0000-000000000231')
  $$,
  'a close with no breakdown at all is still accepted after 0031'
);

-- A post-0031 row with all seven terms.
-- 15000 + 500 - 200 + 4000 + 2500 - 300 - 1000 = 20500
select lives_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts, cash_repairs
  )
  values (date '2021-02-02', 20500, 20500, '00000000-0000-0000-0000-000000000231',
          15000, 500, 200, 4000, 300, 1000, 2500)
  $$,
  'all seven terms, summing correctly, is accepted'
);

-- The backfilled shape: a day that genuinely had no cash repairs.
-- 15000 + 0 - 0 + 4000 + 0 - 0 - 0 = 19000
select lives_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts, cash_repairs
  )
  values (date '2021-02-03', 19000, 19000, '00000000-0000-0000-0000-000000000231',
          15000, 0, 0, 4000, 0, 0, 0)
  $$,
  'cash_repairs = 0 balances exactly as a six-term row used to — this is what the 0031 backfill produced'
);

-- ---------------------------------------------------------------------------
-- all-or-none is now SEVEN, not six
-- ---------------------------------------------------------------------------

-- The old six-term shape is no longer a complete breakdown. This is the
-- assertion that would have caught the migration silently leaving the
-- constraint at six.
select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2021-02-04', 18000, 18000, '00000000-0000-0000-0000-000000000231',
          15000, 500, 200, 4000, 300, 1000)
  $$,
  '23514',
  null,
  'the old six-term breakdown is refused — cash_repairs is not optional once a breakdown exists'
);

-- ---------------------------------------------------------------------------
-- The sum must still explain the total
-- ---------------------------------------------------------------------------

-- Repair cash present but NOT added into expected: exactly the bug 0031 fixes,
-- now impossible to store.
select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts, cash_repairs
  )
  values (date '2021-02-05', 18000, 18000, '00000000-0000-0000-0000-000000000231',
          15000, 500, 200, 4000, 300, 1000, 2500)
  $$,
  '23514',
  null,
  'a breakdown that ignores its own cash_repairs term is refused — the original bug, now unstorable'
);

-- Wrong direction: subtracting repair cash instead of adding it.
-- If the sign were flipped, 15000+500-200+4000-300-1000-2500 = 15500.
select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts, cash_repairs
  )
  values (date '2021-02-06', 15500, 15500, '00000000-0000-0000-0000-000000000231',
          15000, 500, 200, 4000, 300, 1000, 2500)
  $$,
  '23514',
  null,
  'repair cash SUBTRACTED is refused — it is money into the drawer, not out of it'
);

-- Negative is refused like every other term: direction comes from the formula.
select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts, cash_repairs
  )
  values (date '2021-02-07', 15500, 15500, '00000000-0000-0000-0000-000000000231',
          15000, 500, 200, 4000, 300, 1000, -2500)
  $$,
  '23514',
  null,
  'a negative cash_repairs term is refused'
);

-- Negative EXPECTED stays legitimate — a heavy trade-in payout day.
-- 0 + 0 - 0 + 0 + 1000 - 0 - 5000 = -4000
select lives_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts, cash_repairs
  )
  values (date '2021-02-08', -4000, 0, '00000000-0000-0000-0000-000000000231',
          0, 0, 0, 0, 0, 5000, 1000)
  $$,
  'expected cash can still be negative with the seventh term in play'
);

-- ---------------------------------------------------------------------------
-- The money itself: what a repair payment does to the day's cash
-- ---------------------------------------------------------------------------
--
-- These assert the LEDGER, which is what the route sums. A cash job payment
-- must land in the cash total; a card one must not.

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values (
  '00000000-0000-0000-0000-0000000002a1', 'walk_in',
  'Repair Cash Test', 'iPhone 12', 'Cracked screen', 12000
);

-- perform, not select: a bare select emits a result row that pg_prove counts
-- as TAP output and the plan then disagrees with reality.
do $$ begin
  perform public.record_job_payment(
    '00000000-0000-0000-0000-0000000002a1', 'deposit', 3000,
    'cash', '00000000-0000-0000-0000-000000000231'
  );
end $$;

select is(
  (select coalesce(sum(amount), 0)::integer
     from public.job_payments
    where job_id = '00000000-0000-0000-0000-0000000002a1' and tender = 'cash'),
  3000,
  'a cash repair deposit is recorded against the job as cash — the money the day-close term now picks up'
);

-- The same payment must NOT have produced a sale. If it ever did, the route
-- would count it twice: once via cash_sales, once via cash_repairs.
select is(
  (select count(*)::integer from public.sale_payments sp
     join public.sales s on s.id = sp.sale_id
    where s.staff_id = '00000000-0000-0000-0000-000000000231'),
  0,
  'a repair payment creates no sale_payments row — cash_sales and cash_repairs can never see the same money'
);

-- A card repair payment is real money, but not drawer money.
do $$ begin
  perform public.record_job_payment(
    '00000000-0000-0000-0000-0000000002a1', 'balance', 4000,
    'pos1', '00000000-0000-0000-0000-000000000231'
  );
end $$;

select is(
  (select coalesce(sum(amount), 0)::integer
     from public.job_payments
    where job_id = '00000000-0000-0000-0000-0000000002a1' and tender = 'cash'),
  3000,
  'a card repair payment leaves the cash figure untouched — it never reaches the drawer'
);

select * from finish();
rollback;
