-- 0029 — extend bank_holidays through 2030
--
-- 0028 seeded England & Wales bank holidays for 2026-2027 only, with its own
-- comment warning "the shop must extend it before 2028." This is that
-- extension, three years ahead of the same deadline recurring.
--
-- England & Wales dates, including substitute days where the holiday falls
-- on a weekend (New Year's Day, Christmas Day, Boxing Day only — the other
-- five are always weekday-anchored by definition: first/last Monday of a
-- month, or Good Friday/Easter Monday, which are never a Saturday/Sunday).
--
-- Appended, not replaced: existing 2026/2027 dates are preserved. No UI
-- exists yet to edit this list (see settings-view.tsx) — extending it again
-- for 2031+ still needs a migration like this one until that's built.

update public.shop_settings
   set bank_holidays = bank_holidays || array[
     -- 2028 (leap year)
     '2028-01-03'::date, -- New Year's Day (substitute; 1 Jan is a Saturday)
     '2028-04-14'::date, -- Good Friday
     '2028-04-17'::date, -- Easter Monday
     '2028-05-01'::date, -- Early May
     '2028-05-29'::date, -- Spring
     '2028-08-28'::date, -- Summer
     '2028-12-25'::date, -- Christmas Day
     '2028-12-26'::date, -- Boxing Day
     -- 2029
     '2029-01-01'::date, -- New Year's Day
     '2029-03-30'::date, -- Good Friday
     '2029-04-02'::date, -- Easter Monday
     '2029-05-07'::date, -- Early May
     '2029-05-28'::date, -- Spring
     '2029-08-27'::date, -- Summer
     '2029-12-25'::date, -- Christmas Day
     '2029-12-26'::date, -- Boxing Day
     -- 2030
     '2030-01-01'::date, -- New Year's Day
     '2030-04-19'::date, -- Good Friday
     '2030-04-22'::date, -- Easter Monday
     '2030-05-06'::date, -- Early May
     '2030-05-27'::date, -- Spring
     '2030-08-26'::date, -- Summer
     '2030-12-25'::date, -- Christmas Day
     '2030-12-26'::date  -- Boxing Day
   ]
 where not (bank_holidays @> array['2028-01-03'::date]);

comment on column public.shop_settings.bank_holidays is
  'Non-working dates on top of weekends. Read by is_working_day(). Seeded with England & Wales 2026-2030; extend it yearly (no settings-screen UI yet — see 0026/0028/0029).';
