-- 0031 — Cash repair payments belong in expected cash
-- ---------------------------------------------------------------------------
-- THE BUG
--
-- computeExpectedCash (pos.routes.ts) reads cash_entries, sale_payments,
-- refunds and trade_in_payouts. It never reads job_payments. But
-- record_job_payment() writes ONLY to job_payments — it creates no sale and
-- no sale_payments row — and tender_method includes 'cash'. So every cash
-- deposit or balance taken on a repair is money physically in the drawer that
-- the expected figure does not know about.
--
-- The result is a phantom overage on every day a repair is paid in cash:
-- staff count more than the system expected and go looking for a mistake that
-- was never made. Confirmed against real dev data — 2026-07-30 has a £30 cash
-- repair deposit and a day_close whose stored breakdown balances perfectly
-- while excluding it.
--
-- today_takings_by_tender (0010) already unions job_payments, and its own
-- comment says counter repair payments "count for a cash reconciliation the
-- same way". The view and the day-close calculation contradicted each other.
-- The view was right: the money is in the drawer.
--
-- WHY THIS NEEDS A MIGRATION AND NOT JUST A ROUTE FIX
--
-- 0024 stores the breakdown behind each day's expected figure and constrains
-- SIX terms to sum to it exactly. Adding repair cash makes it SEVEN, so the
-- constraint has to be superseded and a column added. 0024 itself is left
-- untouched.
--
-- REFUNDS ARE ALREADY HANDLED — DO NOT ADD A TERM FOR THEM
--
-- refunds.job_id exists (0013) so a repair deposit can be handed back, and
-- computeExpectedCash's refunds query filters on refund_tender='cash' with NO
-- filter on sale_id/order_id/job_id. It therefore ALREADY subtracts cash
-- repair refunds. Today's behaviour is asymmetric rather than merely
-- incomplete: repair cash going out is counted, repair cash coming in is not.
-- Adding the incoming term alone makes it symmetric. Adding an outgoing term
-- as well would subtract those refunds twice.
--
-- NO DOUBLE-COUNTING ON THE WAY IN
--
-- Verified in both directions: record_job_payment inserts into job_payments
-- only, and the jobs routes never call complete_sale. A cash repair payment
-- can therefore never also appear as a sale_payments row, so cash_sales and
-- cash_repairs can never see the same money.

alter table public.day_close
  -- NULLABLE, and backfilled below only for rows that already carry a
  -- breakdown. It must NOT be `not null default 0`: rows closed before 0024
  -- have all six terms null, and defaulting this one to 0 would give them
  -- exactly one non-null term — breaking the all-or-none rule that currently
  -- lets them through as legacy rows.
  add column cash_repairs pence;

comment on column public.day_close.cash_repairs is
  'Cash taken for repair deposits/balances on this trading day (job_payments, tender=cash), stored positive and ADDED to expected. Money into the same drawer. Repair refunds are not a separate term — they are already inside cash_refunds, which is not filtered by what the refund is linked to.';

-- Rows that already have a six-term breakdown gain a seventh term of zero.
-- This deliberately does NOT restate history: those days' expected_amount
-- stays exactly as it was recorded, per 0024's rule that a stored snapshot
-- must never silently change. Days that really did include cash repair
-- payments keep their original (understated) figure and their original
-- variance — that is what the till was actually reconciled against on the
-- day, and rewriting it now would invent a reconciliation that never happened.
update public.day_close
   set cash_repairs = 0
 where float_open is not null;

-- Supersede 0024's three constraints. Dropping and re-adding here is how a
-- constraint is changed without editing an applied migration.
alter table public.day_close
  drop constraint day_close_breakdown_all_or_none;

alter table public.day_close
  add constraint day_close_breakdown_all_or_none check (
    num_nonnulls(
      float_open, petty_in, petty_out,
      cash_sales, cash_refunds, cash_payouts, cash_repairs
    ) in (0, 7)
  );

alter table public.day_close
  drop constraint day_close_breakdown_not_negative;

alter table public.day_close
  add constraint day_close_breakdown_not_negative check (
    float_open is null or (
      float_open   >= 0 and petty_in     >= 0 and petty_out    >= 0 and
      cash_sales   >= 0 and cash_refunds >= 0 and cash_payouts >= 0 and
      cash_repairs >= 0
    )
  );

alter table public.day_close
  drop constraint day_close_breakdown_sums_to_expected;

-- expected = float + pettyIn − pettyOut + cashSales + cashRepairs
--            − cashRefunds − cashPayouts
--
-- expected_amount itself stays deliberately unconstrained in sign: a day with
-- large trade-in payouts can legitimately close negative (0019), and that is
-- correct behaviour rather than an error state.
alter table public.day_close
  add constraint day_close_breakdown_sums_to_expected check (
    float_open is null
    or float_open + petty_in - petty_out
       + cash_sales + cash_repairs
       - cash_refunds - cash_payouts = expected_amount
  );
