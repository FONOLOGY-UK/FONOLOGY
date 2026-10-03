-- 0098 — what a new manager starts with (stage 3, multi-shop).
--
-- A manager sees every shop's figures but works in one. The starting template is an
-- employee's, plus the reading and money permissions: promotions, cost prices, analytics,
-- payments, reports and returns. staff.manage and settings.manage stay owner-granted.
-- Like every template this only applies at creation; permissions are per person.

create or replace function public.default_permissions(p_role staff_role)
returns permission[]
language sql immutable
as $$
  select case p_role
    when 'owner' then array[
      'pos.operate','jobs.manage','inventory.manage','promotions.manage',
      'cash.manage','tradein.manage','sales.today','costs.view','analytics.view',
      'payments.view','reports.view','returns.manage','returns.override','labels.manage',
      'staff.manage','settings.manage'
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
