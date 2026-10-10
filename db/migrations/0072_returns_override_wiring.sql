-- 0072 — returns.override: default grant + backfill
-- ---------------------------------------------------------------------------
-- Second half of 0071 (own file for the same enum-in-same-transaction
-- reason 0012/0013 already documents). Everything here USES the
-- 'returns.override' value 0071 added; nothing here adds another one.
--
-- Owner keeps the run of the shop, so 'returns.override' joins every other
-- permission already in owner's default template (default_permissions()) —
-- this is not a new capability for an owner, since 0011's comment already
-- treats the owner role as fully trusted; it is the boundary being drawn
-- BELOW owner, for anyone else who has (or is later granted) plain
-- returns.manage without also being handed the override.
--
-- Backfilled onto every EXISTING active owner: default_permissions() is
-- read by a trigger that only fires on staff INSERT (0002), so updating the
-- function's own array does nothing for an owner account already sitting
-- in the table. `on conflict do nothing` makes this safe to re-run.
--
-- The actual enforcement point — POST /pos/refunds requiring this
-- permission specifically when `override: true` is set — is
-- apps/api/src/routes/pos.routes.ts, not the database; this migration only
-- makes the permission grantable and grants it to the role it already
-- belongs to by the same trust boundary the rest of 0002 draws.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only, per the standing
-- hard rule.

create or replace function public.default_permissions(p_role staff_role)
returns permission[]
language sql
immutable
as $$
  select case p_role
    when 'owner' then array[
      'pos.operate','jobs.manage','inventory.manage','promotions.manage',
      'cash.manage','tradein.manage','sales.today','costs.view','analytics.view',
      'payments.view','reports.view','returns.manage','returns.override','labels.manage',
      'staff.manage','settings.manage'
    ]::permission[]
    else array[
      'pos.operate','jobs.manage','inventory.manage','labels.manage',
      'cash.manage','tradein.manage','sales.today'
    ]::permission[]
  end;
$$;

insert into public.staff_permissions (staff_id, permission)
select s.id, 'returns.override'::permission
from public.staff s
where s.role = 'owner'
on conflict do nothing;

comment on function public.default_permissions is
  'Role-based starting template, applied once at staff insert (see apply_default_permissions trigger). staff_permissions is the real, per-person answer afterwards — an owner can add or remove individually. Since 0072: returns.override joins owner''s template alongside returns.manage — a member of staff who only has returns.manage can process an ordinary refund but not self-authorise an out-of-policy one via POST /pos/refunds'' override flag.';
