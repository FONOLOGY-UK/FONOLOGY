-- 002 — Time
-- The shop is UK, the server is UTC. Every case here is a real calendar
-- moment where naive UTC-day grouping gives the wrong answer.
--
-- The "known Monday" test doesn't trust memory — it asks Postgres to confirm
-- isodow=1 for the date in the same breath as asserting shop_weekday()=0 for
-- it, so the test can't be wrong about which day of the week it picked.

begin;
set local search_path to public, tap, extensions;
select plan(14);

-- ---------------------------------------------------------------------------
-- July (BST, UK = UTC+1)
-- ---------------------------------------------------------------------------

-- 23:30 UK on 15 July = 22:30 UTC on 15 July. Same UK day.
select is(
  public.shop_day('2024-07-15 22:30:00+00'::timestamptz),
  '2024-07-15'::date,
  '23:30 UK time in July (22:30 UTC) belongs to that UK day'
);

-- 00:30 UK on 16 July = 23:30 UTC on 15 July. New UK day, even though the
-- UTC calendar date is still the 15th.
select is(
  public.shop_day('2024-07-15 23:30:00+00'::timestamptz),
  '2024-07-16'::date,
  '00:30 UK time in July belongs to the new UK day, not the UTC day'
);

-- ---------------------------------------------------------------------------
-- January (GMT, UK = UTC)
-- ---------------------------------------------------------------------------

select is(
  public.shop_day('2024-01-15 23:30:00+00'::timestamptz),
  '2024-01-15'::date,
  '23:30 UK time in January (= UTC) belongs to that day'
);

select is(
  public.shop_day('2024-01-16 00:30:00+00'::timestamptz),
  '2024-01-16'::date,
  '00:30 UK time in January (= UTC) belongs to the new day'
);

-- ---------------------------------------------------------------------------
-- Clocks forward: 31 March 2024, 01:00 GMT becomes 02:00 BST.
-- Local clock time 01:00–01:59 does not exist that day.
-- ---------------------------------------------------------------------------

-- 00:30 UK, before the jump, still GMT: 00:30 UTC.
select is(
  public.shop_day('2024-03-31 00:30:00+00'::timestamptz),
  '2024-03-31'::date,
  'clocks-forward night: 00:30 UK (before the jump) lands on 31 March'
);

-- 02:30 UK, after the jump, now BST: 01:30 UTC.
select is(
  public.shop_day('2024-03-31 01:30:00+00'::timestamptz),
  '2024-03-31'::date,
  'clocks-forward night: 02:30 UK (after the jump) also lands on 31 March'
);

select is(
  public.shop_hour('2024-03-31 01:30:00+00'::timestamptz),
  2,
  'clocks-forward night: 02:30 UK reads as hour 2, not hour 1 (which never happened) or hour 23'
);

-- ---------------------------------------------------------------------------
-- Clocks back: 27 October 2024, 02:00 BST becomes 01:00 GMT.
-- Local clock time 01:00–01:59 happens twice.
-- ---------------------------------------------------------------------------

-- First 01:30 (still BST): 00:30 UTC.
select is(
  public.shop_day('2024-10-27 00:30:00+00'::timestamptz),
  '2024-10-27'::date,
  'clocks-back night: the first 01:30 UK lands on 27 October'
);

-- Second 01:30 (now GMT): 01:30 UTC.
select is(
  public.shop_day('2024-10-27 01:30:00+00'::timestamptz),
  '2024-10-27'::date,
  'clocks-back night: the second 01:30 UK (the repeated hour) also lands on 27 October'
);

select is(
  public.shop_hour('2024-10-27 00:30:00+00'::timestamptz),
  1,
  'clocks-back night: both occurrences of 01:30 UK read as hour 1'
);
select is(
  public.shop_hour('2024-10-27 01:30:00+00'::timestamptz),
  1,
  'clocks-back night: both occurrences of 01:30 UK read as hour 1 (second occurrence)'
);

-- ---------------------------------------------------------------------------
-- shop_weekday(): Monday = 0
-- ---------------------------------------------------------------------------

select ok(
  extract(isodow from '2024-01-01'::date) = 1,
  'sanity check on the test itself: 2024-01-01 really is a Monday (isodow = 1)'
);
select is(
  public.shop_weekday('2024-01-01 12:00:00+00'::timestamptz),
  0,
  'shop_weekday() returns 0 for a Monday'
);

-- ---------------------------------------------------------------------------
-- Every day/month bucket goes through shop_day()/shop_hour()/shop_weekday()
-- ---------------------------------------------------------------------------
-- Extended beyond the letter of "grep pg_views" to also cover pg_proc,
-- because the actual bucketing logic in this schema mostly lives in
-- functions (analytics_series, busiest_times, revenue_by_category,
-- tender_totals) — only two views (today_takings, today_takings_by_tender)
-- do any day-grouping at all, so a views-only check would barely test
-- anything. Checked per-object (does date_trunc appear anywhere in an
-- object that never mentions shop_day/shop_hour/shop_weekday at all), not
-- per-occurrence — precise enough to catch a raw date_trunc(created_at)
-- slipping into a future migration without being so fragile it breaks on
-- reformatted SQL.

-- Extension-owned functions (pg_depend deptype = 'e') are excluded via a
-- MATERIALIZED CTE, computed once at the top. A plain WHERE-clause AND does
-- not reliably filter first here, because Postgres doesn't guarantee
-- left-to-right evaluation of AND conditions — pg_get_functiondef could
-- still be called on an excluded row before the exclusion check runs.
-- MATERIALIZED forces the eligible-function list to be fully computed
-- before pg_get_functiondef ever touches it.
--
-- The exclusion itself: citext is installed into public with no schema
-- given in 0001 (harmless on its own — it just means citext's own
-- min()/max() aggregate helpers land in public too), and
-- pg_get_functiondef cannot reconstruct those aggregate catalog entries at
-- all, which has nothing to do with anything this test is checking.
-- Excluding extension objects is the correct scope for "does OUR code
-- follow the rule", not a workaround for a real bug.
select is_empty(
  $$
  with eligible_functions as materialized (
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  )
  select 'view: ' || viewname as offender
  from pg_views
  where schemaname = 'public'
    and definition ~* 'date_trunc'
    and definition !~* 'shop_day|shop_hour|shop_weekday'

  union all

  select 'function: ' || ef.proname as offender
  from eligible_functions ef
  where pg_get_functiondef(ef.oid) ~* 'date_trunc'
    and pg_get_functiondef(ef.oid) !~* 'shop_day|shop_hour|shop_weekday'
  $$,
  'every view or function using date_trunc also uses a shop_day/shop_hour/shop_weekday helper'
);

select * from finish();
rollback;
