-- 0018 — Staff need a contact phone number
-- Found building B6: apps/web's Staff schema requires `phone` (a real,
-- validated UK phone number, not optional), but there was no column for it
-- on `staff` at all. Same class of gap as 0015's orders.phone — genuinely
-- useful data (how do you ring a colleague who's not answering the shop
-- line?) that simply never got modeled, not a mock-only artifact. Nullable:
-- existing staff rows have none, and nothing downstream requires it to
-- place a call to add_job_part or similar.
--
-- Applied to the DEV project only, per the standing hard rule.

alter table public.staff add column phone text;
