-- 0026 — Dispatch and arrival dates, honouring the next-day cut-off
--
-- `shop_settings.next_day_cutoff_time` has existed since 0009 (default 14:00)
-- but nothing ever read it. The checkout said "Order before 2pm" as static
-- copy and then implied nothing about when the parcel would actually turn up.
--
-- The rule the client confirmed: an order placed BEFORE the cut-off is
-- dispatched the same working day; at or after it, the next working day.
-- "Working day" excludes Saturday and Sunday, so a Friday 3pm order dispatches
-- Monday, not Saturday.
--
-- Arrival is dispatch plus the method's transit, also counted in working days:
--   next-day  → 1 working day  (that is what "next day" means)
--   standard  → 3 working days (the honest end of the "2–3 working days" the
--                storefront already advertises)
--   collect   → neither; there is no dispatch and no arrival for a collection
--
-- Deliberately in the database rather than the browser: it depends on the
-- shop's Europe/London clock and on a settings value the server owns, and the
-- customer is being given a date the shop will be held to. A client-side
-- version would drift with the visitor's own timezone.
--
-- Bank holidays are NOT handled — there is no holiday calendar in this schema,
-- and inventing one would be worse than being explicit about the gap. A bank
-- holiday will make these dates one working day optimistic.
--
-- Additive: new function only, nothing existing altered.

/** Is this date a working day? Saturday/Sunday only — no holiday calendar. */
create or replace function public.is_working_day(p_day date)
returns boolean
language sql
immutable
as $$
  select extract(isodow from p_day) < 6;
$$;

comment on function public.is_working_day(date) is
  'Mon–Fri. Bank holidays are not modelled — see 0026.';

/** The first working day on or after p_day. */
create or replace function public.next_working_day(p_day date, p_skip integer default 0)
returns date
language plpgsql
immutable
as $$
declare
  v_day date := p_day;
  v_left integer := p_skip;
begin
  -- Walk forward to a working day first, then consume p_skip working days.
  while not public.is_working_day(v_day) loop
    v_day := v_day + 1;
  end loop;

  while v_left > 0 loop
    v_day := v_day + 1;
    while not public.is_working_day(v_day) loop
      v_day := v_day + 1;
    end loop;
    v_left := v_left - 1;
  end loop;

  return v_day;
end;
$$;

comment on function public.next_working_day(date, integer) is
  'First working day on or after p_day, then p_skip further working days on. next_working_day(friday, 1) = monday.';

/**
 * When a basket ordered at p_at would be dispatched, and when it should arrive.
 *
 * Both null for 'collect' — a collection has no dispatch. `cutoff_time` and
 * `after_cutoff` come back so the checkout can explain the date rather than
 * just assert it.
 */
create or replace function public.delivery_estimate(
  p_delivery_method delivery_method,
  p_at              timestamptz default now()
)
returns table (
  dispatch_date date,
  arrival_date  date,
  cutoff_time   time,
  after_cutoff  boolean
)
language plpgsql
stable
as $$
declare
  v_cutoff       time;
  v_local        timestamp;
  v_today        date;
  v_after        boolean;
  v_dispatch     date;
  v_transit_days integer;
begin
  select next_day_cutoff_time into v_cutoff from public.shop_settings limit 1;
  v_cutoff := coalesce(v_cutoff, time '14:00');

  -- The shop's own clock, not the caller's.
  v_local := p_at at time zone 'Europe/London';
  v_today := v_local::date;
  v_after := v_local::time >= v_cutoff;

  if p_delivery_method = 'collect' then
    return query select null::date, null::date, v_cutoff, v_after;
    return;
  end if;

  -- Before the cut-off: today, if today is a working day. At or after it (or on
  -- a weekend): the next working day.
  if v_after or not public.is_working_day(v_today) then
    v_dispatch := public.next_working_day(v_today + 1);
  else
    v_dispatch := v_today;
  end if;

  -- The enum label is `next_day` (underscore). Written as 'next-day' this
  -- silently fell through to the 3-day branch and quoted next-day orders as
  -- standard — caught by testing the function, not by reading it.
  v_transit_days := case p_delivery_method
    when 'next_day' then 1
    else 3
  end;

  return query
    select v_dispatch,
           public.next_working_day(v_dispatch, v_transit_days),
           v_cutoff,
           v_after;
end;
$$;

comment on function public.delivery_estimate(delivery_method, timestamptz) is
  'Dispatch and arrival dates for a delivery method, honouring shop_settings.next_day_cutoff_time and skipping weekends. Null dates for collect. Bank holidays not modelled — see 0026.';
