-- 0024 — Store the breakdown behind each day's expected cash
-- ---------------------------------------------------------------------------
-- `expected_amount` records WHAT the till should have held; nothing recorded
-- HOW that figure was reached. The number was computed inside
-- POST /pos/day-close and returned once, to whoever happened to be closing
-- the till — after that it was gone. So "why are we £20 out?" had no answer
-- the next morning, and the owner had no way to see a pattern across weeks.
--
-- Stored, not reconstructed. Reconstructing it later would recompute from
-- today's ledger, and this table's own design note is explicit that these are
-- snapshots: "if a backdated correction later changes what expected would
-- compute to today, this row must not silently change with it." A
-- reconstructed breakdown could therefore sum to something other than the
-- `expected_amount` sitting beside it — a breakdown that contradicts the
-- total it is supposed to explain is worse than no breakdown at all. It is
-- also five extra queries per history row, on every load.
--
-- Nullable, because the rows already closed were closed before any of this
-- existed. They keep their expected/counted/variance and simply have no
-- breakdown to show; the screen says so rather than inventing one.
--
-- Sign convention matches what the API already returns and what the screen
-- shows: every column is a positive magnitude, and the formula does the
-- adding and subtracting. `cash_payouts` is "money handed over for customers'
-- old phones", stored positive and SUBTRACTED — that term is the one whose
-- absence makes every close look short by exactly the amount paid out.

alter table public.day_close
  add column float_open    pence,
  add column petty_in      pence,
  add column petty_out     pence,
  add column cash_sales    pence,
  add column cash_refunds  pence,
  add column cash_payouts  pence;

comment on column public.day_close.cash_payouts is
  'Cash paid out for trade-ins on this trading day, stored positive and subtracted from expected. Money out of the same drawer.';

-- All six or none: a partial breakdown can't be displayed or checked.
alter table public.day_close
  add constraint day_close_breakdown_all_or_none check (
    num_nonnulls(float_open, petty_in, petty_out, cash_sales, cash_refunds, cash_payouts) in (0, 6)
  );

-- Each term is a magnitude; the formula supplies the direction.
alter table public.day_close
  add constraint day_close_breakdown_not_negative check (
    float_open   is null or (
      float_open   >= 0 and petty_in     >= 0 and petty_out    >= 0 and
      cash_sales   >= 0 and cash_refunds >= 0 and cash_payouts >= 0
    )
  );

-- The breakdown must actually explain the total it sits next to. Without
-- this, a change to the formula in application code could store six numbers
-- that don't add up to `expected_amount`, and the screen would show a
-- reconciliation that doesn't reconcile.
alter table public.day_close
  add constraint day_close_breakdown_sums_to_expected check (
    float_open is null
    or float_open + petty_in - petty_out + cash_sales - cash_refunds - cash_payouts = expected_amount
  );
