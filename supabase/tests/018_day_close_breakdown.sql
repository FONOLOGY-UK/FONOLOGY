-- 018 — Day-close breakdown (migration 0024)
--
-- The day-close screen shows the operator a reconciliation after they have
-- counted blind: opening float, petty in, petty out, cash sales, cash refunds,
-- cash payouts — and the expected figure those six produce. Migration 0024
-- stores the six alongside the snapshot rather than reconstructing them later,
-- because a reconstruction run months afterwards could disagree with the
-- expected_amount sitting next to it.
--
-- Three constraints make that disagreement impossible. This file is their
-- coverage:
--
--   day_close_breakdown_all_or_none      num_nonnulls(...) in (0, 6)
--   day_close_breakdown_not_negative     every term >= 0
--   day_close_breakdown_sums_to_expected float + in - out + sales
--                                          - refunds - payouts = expected
--
-- The third is the one that matters: it is what guarantees the screen can
-- never display a reconciliation that doesn't reconcile.

begin;
set local search_path to public, tap, extensions;
select plan(15);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000181', 'test-staff-018@example.invalid');

insert into public.staff (id, email, name, role)
values (
  '00000000-0000-0000-0000-000000000181',
  'test-staff-018@example.invalid',
  'Test Closer 018',
  'owner'
);

-- Each case below uses its own trading day: day_close.trading_day is unique,
-- which is what enforces one close per day. `variance` is never inserted —
-- it is a generated column.

-- ---------------------------------------------------------------------------
-- The three constraints exist at all
-- ---------------------------------------------------------------------------

select has_check(
  'public', 'day_close',
  'day_close has check constraints on the breakdown'
);

select col_is_null('public', 'day_close', 'float_open', 'float_open is nullable (rows predating 0024 have no breakdown)');
select col_is_null('public', 'day_close', 'cash_payouts', 'cash_payouts is nullable for the same reason');

-- ---------------------------------------------------------------------------
-- all-or-none
-- ---------------------------------------------------------------------------

-- No breakdown at all is allowed: that is what a pre-0024 row looks like, and
-- the API returns null rather than inventing one.
select lives_ok(
  $$
  insert into public.day_close (trading_day, expected_amount, counted_amount, staff_id)
  values (date '2020-01-02', 15000, 15000, '00000000-0000-0000-0000-000000000181')
  $$,
  'all six null is accepted — a close with no stored breakdown'
);

-- All six present, summing correctly, is the normal case.
-- 15000 + 500 - 200 + 4000 - 300 - 1000 = 18000
select lives_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2020-01-03', 18000, 18000, '00000000-0000-0000-0000-000000000181',
          15000, 500, 200, 4000, 300, 1000)
  $$,
  'all six present and summing to expected is accepted'
);

-- Anything in between is refused. A partial breakdown is the dangerous case:
-- it looks like a reconciliation but cannot be one.
select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out
  )
  values (date '2020-01-04', 15300, 15300, '00000000-0000-0000-0000-000000000181',
          15000, 500, 200)
  $$,
  '23514',
  null,
  'three of six is refused — a partial breakdown cannot reconcile'
);

select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds
  )
  values (date '2020-01-05', 19000, 19000, '00000000-0000-0000-0000-000000000181',
          15000, 500, 200, 4000, 300)
  $$,
  '23514',
  null,
  'five of six is refused too — one missing term is still a partial breakdown'
);

-- ---------------------------------------------------------------------------
-- non-negative
-- ---------------------------------------------------------------------------
--
-- The `pence` domain itself allows negatives (expected cash legitimately can
-- be negative — more paid out than taken). These six components cannot be:
-- you cannot take out negative petty cash. Direction is carried by the
-- formula's signs, not by the values.

select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  -- expected_amount is the figure these six DO produce (15000+500+200+4000
  -- -300-1000), so the sum constraint is satisfied and only the non-negative
  -- one can be what refuses this. A test that trips two constraints at once
  -- proves neither.
  values (date '2020-01-06', 18400, 18400, '00000000-0000-0000-0000-000000000181',
          15000, 500, -200, 4000, 300, 1000)
  $$,
  '23514',
  null,
  'a negative petty_out is refused'
);

select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2020-01-07', 18600, 18600, '00000000-0000-0000-0000-000000000181',
          15000, 500, 200, 4000, -300, 1000)
  $$,
  '23514',
  null,
  'a negative cash_refunds is refused — refunds are subtracted, not signed'
);

select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2020-01-08', -12000, 0, '00000000-0000-0000-0000-000000000181',
          -15000, 500, 200, 4000, 300, 1000)
  $$,
  '23514',
  null,
  'a negative float_open is refused'
);

-- Zero everywhere is a real day (a shop that opened with no float and sold
-- nothing), so it must be allowed.
select lives_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2020-01-09', 0, 0, '00000000-0000-0000-0000-000000000181',
          0, 0, 0, 0, 0, 0)
  $$,
  'all six at zero is accepted — a day with no cash movement at all'
);

-- ---------------------------------------------------------------------------
-- sums to expected  —  the guarantee the screen depends on
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2020-01-10', 99999, 99999, '00000000-0000-0000-0000-000000000181',
          15000, 500, 200, 4000, 300, 1000)
  $$,
  '23514',
  null,
  'six components that do not add up to expected_amount are refused'
);

-- Off by a single penny is still refused: this is exact arithmetic on integer
-- pence, not a tolerance.
select throws_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2020-01-11', 18001, 18001, '00000000-0000-0000-0000-000000000181',
          15000, 500, 200, 4000, 300, 1000)
  $$,
  '23514',
  null,
  'one penny out is refused — the sum is exact, not approximate'
);

-- Expected cash can legitimately be NEGATIVE (a day where refunds and trade-in
-- payouts exceeded the float and takings). The sum must still hold exactly.
-- 0 + 0 - 0 + 1000 - 3000 - 500 = -2500
select lives_ok(
  $$
  insert into public.day_close (
    trading_day, expected_amount, counted_amount, staff_id,
    float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts
  )
  values (date '2020-01-12', -2500, 0, '00000000-0000-0000-0000-000000000181',
          0, 0, 0, 1000, 3000, 500)
  $$,
  'a negative expected_amount is accepted when the six components produce it'
);

-- An UPDATE that breaks the sum must be refused too — the constraint is not
-- only an insert-time check. This is the realistic corruption path: a later
-- correction to one component that silently stops matching expected_amount.
select throws_ok(
  $$
  update public.day_close
     set cash_sales = 9999
   where trading_day = date '2020-01-03'
  $$,
  '23514',
  null,
  'editing one component so the sum no longer matches is refused'
);

select * from finish();
rollback;
