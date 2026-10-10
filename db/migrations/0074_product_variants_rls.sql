-- 0074 — product_variants was missing RLS
-- ---------------------------------------------------------------------------
-- pgTAP finding (010_security.sql test 2, first real run of the suite).
-- Same shape as 0068's payment_provider_events gap: 0011_security.sql
-- enabled (and forced) RLS on every table that existed at the time, in one
-- pass. product_variants didn't exist yet — it was added later, by 0060 —
-- and 0060 never added its own RLS statements, so it has sat with RLS off
-- ever since.
--
-- Same posture as 0068: deny-all RLS is this schema's second line of
-- defense (apps/api's service-role key bypasses it entirely either way;
-- real authorization lives in apps/api + staff_can()), so this hasn't been
-- leaking anything through Supabase's own APIs — anon/authenticated hold no
-- table privileges at all (0011). It is a real gap against the schema-wide
-- invariant supabase/tests/010_security.sql asserts by querying the catalog
-- directly, not a fixed table list — exactly the case that test exists to
-- catch, and exactly how it was caught.
--
-- Same treatment as every table in 0011 and 0068: both ENABLE and FORCE, so
-- even a role that owns this table gets nothing without an explicit policy
-- (none exist, by design — see 0011's own comment).
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only, per the standing
-- hard rule.

alter table public.product_variants enable row level security;
alter table public.product_variants force row level security;
