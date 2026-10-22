-- 0121 — Petty cash becomes its own pot, apart from the till drawer (client changes, October 2026, #7).
--
-- Until now Petty Cash In / Out (cash_entries, 0008) were part of the drawer: they moved the expected
-- drawer figure at day close. From the cut-over day on they don't. Each shop's petty cash is a pot of
-- its own:
--
--   * its balance carries from one day to the next: a day opens with what the last day close of the
--     week counted in the tin (or, with no close, what the entries add up to);
--   * it starts again at £0 every Monday (the shop's trading week, Europe/London). What happens to
--     money left over on a Sunday night is for the client to decide later (a "returned to the owner"
--     count); for now the week simply restarts;
--   * the day close counts it separately from the drawer: opening, in, out, expected, counted and the
--     difference are stored below, as snapshots, like the drawer's own figures (0024).
--
-- The rule lives in the API (lib/pettyCash.ts); this file holds the data.
--
-- THE CUT-OVER. Days before petty_cash_separate_from keep the old rule, so a day already traded, or
-- closed, never changes. On a database that already has cash entries it is the NEXT trading day, so
-- a deploy in the middle of a trading day does not split that day's petty slips across two rules. On
-- an empty database (a fresh install) there is nothing to protect and the new rule applies at once.

alter table public.shop_settings
  add column petty_cash_separate_from date;

update public.shop_settings
   set petty_cash_separate_from =
         case when exists (select 1 from public.cash_entries) then public.shop_day(now()) + 1
              else date '2000-01-01' end;

alter table public.shop_settings
  alter column petty_cash_separate_from set not null,
  alter column petty_cash_separate_from set default date '2000-01-01';

comment on column public.shop_settings.petty_cash_separate_from is
  'First trading day on which petty cash is its own pot, apart from the drawer (0121). Earlier days keep petty cash inside the drawer figure.';

-- The day close's petty cash count. All six are set together on a close from the cut-over on, and
-- none on an older close. The drawer breakdown's petty_in / petty_out stay 0 on those closes: petty
-- cash no longer goes through the drawer.
alter table public.day_close
  add column petty_cash_opening  pence,
  add column petty_cash_in       pence,
  add column petty_cash_out      pence,
  add column petty_cash_expected pence,
  add column petty_cash_counted  pence,
  add column petty_cash_variance pence generated always as (petty_cash_counted - petty_cash_expected) stored;

alter table public.day_close
  add constraint day_close_petty_cash_all_or_none check (
    num_nonnulls(
      petty_cash_opening, petty_cash_in, petty_cash_out, petty_cash_expected, petty_cash_counted
    ) in (0, 5)
  ),
  add constraint day_close_petty_cash_sums check (
    petty_cash_opening is null
    or petty_cash_opening + petty_cash_in - petty_cash_out = petty_cash_expected
  ),
  add constraint day_close_petty_cash_not_negative check (
    petty_cash_opening is null or (
      petty_cash_opening >= 0 and petty_cash_in >= 0 and petty_cash_out >= 0
      and petty_cash_counted >= 0
    )
  );

comment on column public.day_close.petty_cash_counted is
  'Petty cash counted in the tin at day close (0121). It is what the next day of the same week opens with.';
