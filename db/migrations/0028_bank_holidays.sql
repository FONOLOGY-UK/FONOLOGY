-- 0028 — bank holidays, so the delivery estimate stops being a working day optimistic.
--
-- 0026 shipped `is_working_day()` as "Monday to Friday" and said so in its own
-- comment. That is wrong roughly eight times a year, and it is wrong in the
-- direction that matters: the shop promises Tuesday, the courier doesn't collect
-- on the Monday, and the customer is told a date the shop was never going to
-- hit. A late parcel the customer was warned about is a delay; one they were
-- promised against is a broken promise.
--
-- The list lives in `shop_settings` with the cut-off time it works alongside,
-- because it is an operational fact about this shop's calendar and it has to be
-- changeable without a migration — England and Wales publish new dates every
-- year, and Scotland's differ. It is seeded with the England-and-Wales dates for
-- 2026 and 2027; the shop must extend it before 2028, and the estimate quietly
-- reverts to Mon–Fri for any year with no dates entered.
--
-- Additive: one column with a default, and three functions replaced in place.

alter table public.shop_settings
  add column if not exists bank_holidays date[] not null default '{}';

comment on column public.shop_settings.bank_holidays is
  'Non-working dates on top of weekends. Read by is_working_day(). Seeded with England & Wales 2026–2027; extend it yearly.';

-- England & Wales, 2026 and 2027. Substitute days included: 26 Dec 2026 falls on
-- a Saturday, so the holiday is Monday 28 Dec.
update public.shop_settings
   set bank_holidays = array[
     -- 2026
     '2026-01-01'::date, -- New Year's Day
     '2026-04-03'::date, -- Good Friday
     '2026-04-06'::date, -- Easter Monday
     '2026-05-04'::date, -- Early May
     '2026-05-25'::date, -- Spring
     '2026-08-31'::date, -- Summer
     '2026-12-25'::date, -- Christmas Day
     '2026-12-28'::date, -- Boxing Day (substitute)
     -- 2027
     '2027-01-01'::date,
     '2027-03-26'::date, -- Good Friday
     '2027-03-29'::date, -- Easter Monday
     '2027-05-03'::date,
     '2027-05-31'::date,
     '2027-08-30'::date,
     '2027-12-27'::date, -- Christmas Day (substitute; 25th is a Saturday)
     '2027-12-28'::date  -- Boxing Day (substitute; 26th is a Sunday)
   ]
 where bank_holidays = '{}';

-- STABLE, not IMMUTABLE: it now reads a table. Leaving it marked immutable
-- would let the planner fold a call to a constant and cache an answer from
-- before the holiday list changed. next_working_day() and delivery_estimate()
-- follow for the same reason — an immutable function calling a stable one is a
-- lie the planner is entitled to act on.
create or replace function public.is_working_day(p_day date)
returns boolean
language sql
stable
as $$
  select extract(isodow from p_day) < 6
     and not exists (
       select 1
         from public.shop_settings s
        where p_day = any(s.bank_holidays)
     );
$$;

comment on function public.is_working_day(date) is
  'Mon–Fri, excluding shop_settings.bank_holidays.';

create or replace function public.next_working_day(p_day date, p_skip integer default 0)
returns date
language plpgsql
stable
as $$
declare
  v_day date := p_day;
  v_left integer := p_skip;
  v_guard integer := 0;
begin
  -- Walk forward to a working day first, then consume p_skip working days.
  -- The guard exists because the loop now depends on editable data: a settings
  -- row listing every date in a year would otherwise spin forever inside a
  -- customer's checkout request.
  while not public.is_working_day(v_day) loop
    v_day := v_day + 1;
    v_guard := v_guard + 1;
    if v_guard > 366 then
      raise exception 'No working day found within a year of %  — check shop_settings.bank_holidays.', p_day;
    end if;
  end loop;

  while v_left > 0 loop
    v_day := v_day + 1;
    while not public.is_working_day(v_day) loop
      v_day := v_day + 1;
      v_guard := v_guard + 1;
      if v_guard > 366 then
        raise exception 'No working day found within a year of % — check shop_settings.bank_holidays.', p_day;
      end if;
    end loop;
    v_left := v_left - 1;
  end loop;

  return v_day;
end;
$$;

comment on function public.next_working_day(date, integer) is
  'First working day on or after p_day, then p_skip further working days on. Skips weekends and bank holidays.';

-- delivery_estimate() itself is unchanged: it was already STABLE and already
-- routed every date decision through these two functions, so it picks up bank
-- holidays without a line of new logic. Only its comment was lying.
comment on function public.delivery_estimate(delivery_method, timestamptz) is
  'Dispatch and arrival dates for a delivery method, honouring shop_settings.next_day_cutoff_time and skipping weekends and shop_settings.bank_holidays. Null dates for collect.';
