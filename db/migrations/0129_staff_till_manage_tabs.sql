-- 0129 — All staff get the till's Promotions, Missing costs and Returns tabs.
--
-- The client wants every member of staff to use these three till modules (client changes v2,
-- section 7 put them on the till). Each tab needs its own permission, and the Staff template did
-- not include them, so they showed for the owner and for nobody else. This adds them to the
-- template and gives them to everyone who is already Staff.
--
-- What this hands over, on purpose: costs.view shows cost prices and margins to staff wherever the
-- screens show them, and returns.manage lets them refund. returns.override stays with the owner:
-- staff cannot approve their own out-of-policy refund.

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
      'cash.manage','tradein.manage','sales.today',
      'promotions.manage','costs.view','returns.manage'
    ]::permission[]
  end;
$$;

insert into public.staff_permissions (staff_id, permission)
select s.id, p.permission
from public.staff s
cross join (values
  ('promotions.manage'::permission),
  ('costs.view'::permission),
  ('returns.manage'::permission)
) as p (permission)
where s.role = 'employee'
on conflict do nothing;
