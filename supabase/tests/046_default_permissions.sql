-- 046 — the starting permission templates (default_permissions(), migration 0111)
--
-- 0072 once rewrote default_permissions() from an old copy and silently dropped reviews.manage from
-- the owner; nothing noticed for months because existing owners kept it. The owner's template must
-- hold EVERY permission (the owner runs the shop, and a new permission added without them is the
-- bug), and a new owner must actually receive it.

begin;
set local search_path to public, tap, extensions;
select plan(5);

select is(
  (select array_agg(e order by e)
     from unnest(enum_range(null::permission)) e
    where e <> all(public.default_permissions('owner'))),
  null,
  'the owner''s starting template holds every permission there is');

select ok('reviews.manage' = any(public.default_permissions('owner')),
          'reviews.manage is an owner permission (lost in 0072, restored in 0111)');
select ok(not ('reviews.manage' = any(public.default_permissions('manager'))),
          'reviews stay owner-tier: a manager does not start with it');
select ok(not ('reviews.manage' = any(public.default_permissions('employee'))),
          'nor does an employee');

-- A brand-new owner gets the whole template — the fresh-production case.
insert into public.user_accounts (id, email, password_hash)
values ('00000000-0000-0000-0000-000000004601', 'new-owner-046@example.invalid', 'x');
insert into public.staff (id, email, name, role)
values ('00000000-0000-0000-0000-000000004601', 'new-owner-046@example.invalid', 'New Owner', 'owner');

select is(
  (select count(*)::int from public.staff_permissions
    where staff_id = '00000000-0000-0000-0000-000000004601'),
  (select count(*)::int from unnest(enum_range(null::permission))),
  'a new owner starts with every permission, reviews.manage included');

select * from finish();
rollback;
