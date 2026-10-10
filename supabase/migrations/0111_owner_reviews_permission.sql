-- 0111 — owners start with reviews.manage again.
--
-- 0053 added 'reviews.manage' to the owner's starting template. 0072 (returns.override) rewrote
-- default_permissions() from an older copy and dropped it, and 0098 (managers) carried that on.
-- Owners that already existed kept it (0053 backfilled them), so the dev database never showed
-- the gap — but every owner created since, including the first one on a fresh production
-- database, starts without it: Admin → Reviews renders empty and reviews can never be approved.
-- Found by the production rehearsal (scripts/rehearsal.mjs), where the owner is created new.
--
-- The template is the 0098 one with 'reviews.manage' back on the owner. Manager and employee are
-- unchanged (reviews stay owner-tier, per 0053). supabase/tests/046 now asserts the owner's
-- template holds every permission, so the next rewrite cannot drop one unnoticed.

create or replace function public.default_permissions(p_role staff_role)
returns permission[]
language sql immutable
as $$
  select case p_role
    when 'owner' then array[
      'pos.operate','jobs.manage','inventory.manage','promotions.manage',
      'cash.manage','tradein.manage','sales.today','costs.view','analytics.view',
      'payments.view','reports.view','returns.manage','returns.override','labels.manage',
      'staff.manage','settings.manage','reviews.manage'
    ]::permission[]
    when 'manager' then array[
      'pos.operate','jobs.manage','inventory.manage','labels.manage',
      'cash.manage','tradein.manage','sales.today',
      'promotions.manage','costs.view','analytics.view','payments.view','reports.view','returns.manage'
    ]::permission[]
    else array[
      'pos.operate','jobs.manage','inventory.manage','labels.manage',
      'cash.manage','tradein.manage','sales.today'
    ]::permission[]
  end;
$$;

-- Owners created between 0072 and now.
insert into public.staff_permissions (staff_id, permission)
select id, 'reviews.manage'::permission from public.staff where role = 'owner'
on conflict do nothing;
