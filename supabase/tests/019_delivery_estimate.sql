-- 019 — Delivery estimate (0026 + 0028)
--
-- This file exists because of a bug that reading the code did not catch. 0026
-- wrote `case p_delivery_method when 'next-day' then 1 else 3 end`, but the
-- enum label is `next_day` with an underscore. The hyphenated string never
-- matched anything, so every next-day order silently fell through to the
-- three-day branch and the checkout promised standard transit to customers who
-- had paid for next day. Nothing errored. It was only found by calling the
-- function and looking at the dates.
--
-- So the point of these tests is not that the logic is subtle — it is that the
-- output is a promise made to a customer, and the only way to know a promise is
-- kept is to check the date that actually comes back.
--
-- 0028 then added bank holidays, which is the same class of problem one step
-- out: a Mon-Fri calendar is right about 96% of the year and wrong on exactly
-- the days when the shop is busiest and a missed date hurts most.

begin;
set local search_path to public, tap, extensions;
select plan(14);

-- ---------------------------------------------------------------------------
-- The settings this depends on
-- ---------------------------------------------------------------------------

select is(
  (select next_day_cutoff_time from public.shop_settings),
  time '14:00',
  'sanity check: the cut-off really is 2pm, which is what every case below assumes'
);

select ok(
  (select cardinality(bank_holidays) > 0 from public.shop_settings),
  'the shop has a bank holiday list at all — an empty one silently degrades to Mon-Fri'
);

-- ---------------------------------------------------------------------------
-- is_working_day
-- ---------------------------------------------------------------------------

select ok(public.is_working_day(date '2026-07-30'), 'an ordinary Thursday is a working day');
select ok(not public.is_working_day(date '2026-08-01'), 'Saturday is not');
select ok(not public.is_working_day(date '2026-08-02'), 'Sunday is not');
select ok(
  not public.is_working_day(date '2026-04-03'),
  'Good Friday is not a working day, even though it is a Friday'
);
select ok(
  not public.is_working_day(date '2026-12-28'),
  'the Boxing Day SUBSTITUTE is not a working day — 26 Dec 2026 is a Saturday, so the holiday moves'
);

-- ---------------------------------------------------------------------------
-- The cut-off
-- ---------------------------------------------------------------------------

select is(
  (select dispatch_date from public.delivery_estimate('next_day', timestamptz '2026-07-30 12:59:00+01')),
  date '2026-07-30',
  'ordered at 12:59 on a working day: dispatched the same day'
);

select is(
  (select dispatch_date from public.delivery_estimate('next_day', timestamptz '2026-07-30 14:00:00+01')),
  date '2026-07-31',
  'ordered at exactly 2pm: the cut-off has passed, so it goes tomorrow'
);

-- The case the client asked about by name.
select is(
  (select dispatch_date from public.delivery_estimate('next_day', timestamptz '2026-07-31 15:00:00+01')),
  date '2026-08-03',
  'Friday afternoon after the cut-off dispatches MONDAY — "next working day" from a Friday is never Saturday'
);

-- ---------------------------------------------------------------------------
-- Transit: the bug this file was written for
-- ---------------------------------------------------------------------------

select is(
  (select arrival_date from public.delivery_estimate('next_day', timestamptz '2026-07-30 09:00:00+01')),
  date '2026-07-31',
  'next_day is ONE working day in transit (this is the assertion that would have caught the next-day/next_day typo)'
);

select is(
  (select arrival_date from public.delivery_estimate('standard', timestamptz '2026-07-30 09:00:00+01')),
  date '2026-08-04',
  'standard is three working days, skipping the weekend'
);

-- ---------------------------------------------------------------------------
-- Bank holidays (0028)
-- ---------------------------------------------------------------------------

select is(
  (select dispatch_date from public.delivery_estimate('next_day', timestamptz '2026-04-02 15:00:00+01')),
  date '2026-04-07',
  'Thursday afternoon before Easter dispatches the Tuesday — Good Friday, the weekend and Easter Monday are all skipped'
);

select is(
  (select arrival_date from public.delivery_estimate('next_day', timestamptz '2026-12-24 09:00:00+00')),
  date '2026-12-29',
  'a Christmas Eve next-day order arrives on the 29th, not the 25th'
);

select * from finish();
rollback;
