-- 0057 — Per-staff auto-lock override (Round 5 Phase 2 #4)
--
-- `shop_settings.idle_lock_minutes` (0009_settings.sql) is the shop-wide
-- default, set by whoever holds settings.manage. This adds a per-staff
-- override that a staff member can set for THEMSELVES, from a route that
-- doesn't need settings.manage at all — the same reasoning `staff.pin_hash`
-- already established: some things are personal to an account, not a shop
-- dial an owner turns for everyone. Null (the default) means "use the shop
-- default", not "never lock" — there is no way to disable auto-lock
-- entirely from this column, on purpose.
alter table public.staff
  add column idle_lock_minutes integer
    check (idle_lock_minutes is null or idle_lock_minutes > 0);

comment on column public.staff.idle_lock_minutes is
  'Per-staff auto-lock override, in minutes. Null = use shop_settings.idle_lock_minutes. Only ever set by the staff member themselves — see POST /staff/me/idle-lock.';
