-- 0002 — Identity
-- Customers, staff, and permissions.
--
-- Two things the frontend has no equivalent of:
--   1. There is no customer record at all today — just a login object with a
--      name and an email. The client confirmed customers can have accounts.
--   2. Permissions are role-based in the code (4 roles). The client asked for
--      two roles and permissions ticked per person. Roles become templates.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
-- A profile hanging off Supabase Auth. Sign-in itself (Google or password) is
-- handled by auth.users; this table holds the shop's own view of the person.
--
-- Guests deliberately have no row here. A guest order carries an email and a
-- reference and nothing else — see 0005.

create table public.customers (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        citext not null unique,
  name         text not null,
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

comment on table public.customers is
  'Registered customers only. Guests have no row — their orders carry an email directly.';

-- Saved delivery addresses. The frontend stores a single free-text address
-- line on the order itself. Kept as structured fields here because delivery is
-- priced by postcode area, and a free-text blob can''t be zoned reliably.
create table public.customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  label        text,
  line1        text not null,
  line2        text,
  city         text not null,
  county       text,
  postcode     text not null,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index customer_addresses_customer_idx
  on public.customer_addresses (customer_id);

-- Only one default address per customer.
create unique index customer_addresses_one_default_idx
  on public.customer_addresses (customer_id)
  where is_default;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
-- The client confirmed: every staff member gets their own login, and there is
-- no middle role. The frontend currently has four (owner, manager, technician,
-- counter) — owner and manager collapse to 'owner', technician and counter
-- collapse to 'employee'.

create type staff_role as enum ('owner', 'employee');

create table public.staff (
  id             uuid primary key references auth.users (id) on delete restrict,
  email          citext not null unique,
  name           text not null,
  role           staff_role not null default 'employee',
  pin_hash       text,                      -- 4-digit dashboard lock, hashed, never stored raw
  is_active      boolean not null default true,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger staff_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();

-- Staff are never deleted, only deactivated. Sales, refunds and cash entries
-- reference them, and that history has to stay readable.
comment on column public.staff.is_active is
  'Staff are deactivated, never deleted — their name is attached to historical records.';

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- The 15 permissions already in permissions.config.ts, kept as-is. What
-- changes is where they attach: to a person, not to a role.
--
-- The role only decides which boxes are ticked when the account is created.
-- After that the owner ticks and unticks freely, which is what he asked for —
-- he doesn't have to decide employee access up front, and he can change his
-- mind later without a developer.

create type permission as enum (
  -- till and shop floor
  'pos.operate',
  'jobs.manage',
  'inventory.manage',
  'promotions.manage',
  'cash.manage',
  'tradein.manage',
  'sales.today',
  -- back office
  'costs.view',
  'analytics.view',
  'payments.view',
  'reports.view',
  'returns.manage',
  'labels.manage',
  'staff.manage',
  'settings.manage'
);

create table public.staff_permissions (
  staff_id    uuid not null references public.staff (id) on delete cascade,
  permission  permission not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.staff (id),

  primary key (staff_id, permission)
);

create index staff_permissions_staff_idx on public.staff_permissions (staff_id);
create index staff_permissions_granted_by_idx on public.staff_permissions (granted_by);

comment on table public.staff_permissions is
  'Per-person permissions. Role is only a starting template — this table is the real answer.';

-- Default ticks for a new account.
-- Deliberately mean: giving more access is one click, and an employee having
-- seen the profit figures cannot be undone.
create or replace function public.default_permissions(p_role staff_role)
returns permission[]
language sql
immutable
as $$
  select case p_role
    when 'owner' then array[
      'pos.operate','jobs.manage','inventory.manage','promotions.manage',
      'cash.manage','tradein.manage','sales.today','costs.view','analytics.view',
      'payments.view','reports.view','returns.manage','labels.manage',
      'staff.manage','settings.manage'
    ]::permission[]
    else array[
      'pos.operate','jobs.manage','inventory.manage','labels.manage',
      'cash.manage','tradein.manage','sales.today'
    ]::permission[]
  end;
$$;

-- Apply the template on insert. The owner can change everything afterwards.
create or replace function public.apply_default_permissions()
returns trigger
language plpgsql
as $$
begin
  insert into public.staff_permissions (staff_id, permission)
  select new.id, unnest(public.default_permissions(new.role))
  on conflict do nothing;
  return new;
end;
$$;

create trigger staff_default_permissions
  after insert on public.staff
  for each row execute function public.apply_default_permissions();

-- The check used everywhere server-side. The frontend's own check is UX only.
create or replace function public.staff_can(p_staff_id uuid, p_permission permission)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.staff_permissions sp
    join public.staff s on s.id = sp.staff_id
    where sp.staff_id = p_staff_id
      and sp.permission = p_permission
      and s.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- Dashboard PIN lock
-- ---------------------------------------------------------------------------
-- The till locks itself after a few idle minutes and needs a 4-digit PIN to
-- come back. Tracked server-side so a locked session can''t be bypassed by
-- reloading the page.

create table public.staff_sessions (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.staff (id) on delete cascade,
  device_label  text,                       -- 'Counter PC', 'Back office'
  locked        boolean not null default false,
  last_active_at timestamptz not null default now(),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create index staff_sessions_staff_idx
  on public.staff_sessions (staff_id, started_at desc);

create index staff_sessions_open_idx
  on public.staff_sessions (staff_id)
  where ended_at is null;
