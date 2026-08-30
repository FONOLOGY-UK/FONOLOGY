-- 0068 — payment_provider_events was missing RLS
--
-- 0011_security.sql enabled (and forced) row level security on every table
-- that existed at the time, in one pass. payment_provider_events didn't
-- exist yet — it was added later, by 0037 — and 0037 never added its own
-- RLS statements, so it has sat with RLS off ever since. Deny-all RLS is
-- this schema's second line of defense (apps/api's service-role key
-- bypasses it entirely either way; real authorization lives in apps/api +
-- staff_can()), so this table being uncovered doesn't currently leak
-- anything through Supabase's own APIs — anon/authenticated already hold
-- no table privileges at all (0011) — but it is a real gap against the
-- schema-wide invariant supabase/tests/010_security.sql asserts:
--
--   select is_empty($$ ... where not c.relrowsecurity $$, ...)
--   select is_empty($$ ... where not c.relforcerowsecurity $$, ...)
--
-- That test queries the catalog directly rather than a fixed table list,
-- specifically so a table added later without its own RLS/FORCE pair is
-- caught automatically — this is exactly the case it exists to catch.
--
-- Same treatment as every table in 0011: both ENABLE and FORCE, so even a
-- role that owns this table gets nothing without an explicit policy (none
-- exist, by design — see 0011's own comment).
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only, per the standing
-- hard rule.

alter table public.payment_provider_events enable row level security;
alter table public.payment_provider_events force row level security;
