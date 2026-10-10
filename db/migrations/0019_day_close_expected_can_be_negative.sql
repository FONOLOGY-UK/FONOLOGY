-- 0019 — expected cash on a day-close can legitimately be negative
-- Found during the connect-and-test end-to-end pass: `expected_amount` is a
-- projection (float + petty in − petty out + cash sales − cash refunds −
-- cash trade-in payouts), and a real trading day CAN land negative — a large
-- cash payout for a trade-in with no offsetting cash sales yet is a genuine,
-- if concerning, business state. The owner still needs to be able to close
-- the till and see that shortfall recorded (variance makes it visible), not
-- be blocked from ever closing the day at all.
--
-- `counted_amount >= 0` is untouched and still correct — you cannot
-- physically count negative cash in a drawer.
--
-- Applied to the DEV project only, per the standing hard rule.

alter table public.day_close
  drop constraint day_close_expected_amount_not_negative;
