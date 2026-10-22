-- 0118 — No Manager role (client changes, October 2026, #3).
--
-- The client wants exactly two roles: Admin (the `owner` value) and Staff (the `employee` value).
-- Postgres cannot drop a value from an enum, so `manager` (0095) stays in staff_role but no row
-- may hold it: anyone still a manager becomes an employee, keeping the permissions they were
-- granted (permissions are per person and are not re-derived from the role), and the check below
-- refuses the value from now on. The API no longer accepts it either.

update public.staff set role = 'employee' where role = 'manager';

alter table public.staff
  add constraint staff_role_admin_or_staff check (role in ('owner', 'employee'));
