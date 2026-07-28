-- 010 — Security
-- Everything here is proved by querying the catalog and the privilege
-- system directly — not by reading 0011 — so a table added later without
-- its own RLS/grants is caught automatically, the same principle as 001.

begin;
set local search_path to public, tap, extensions;
select plan(9);

-- ---------------------------------------------------------------------------
-- RLS is enabled (and forced) on every table
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  $$,
  'row level security is enabled on every table in public'
);
select is_empty(
  $$
  select relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity
  $$,
  'row level security is FORCED on every table too — even a role that owns these tables gets nothing without a policy'
);

-- ---------------------------------------------------------------------------
-- anon and authenticated have no privilege on any table, looped generically
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select t.table_name || '.' || priv as offender
  from information_schema.tables t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as priv
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    and has_table_privilege('anon', 'public.' || quote_ident(t.table_name), priv)
  $$,
  'the anon role has no SELECT/INSERT/UPDATE/DELETE grant on any table in public, checked generically so a future table is covered automatically'
);
select is_empty(
  $$
  select t.table_name || '.' || priv as offender
  from information_schema.tables t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as priv
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    and has_table_privilege('authenticated', 'public.' || quote_ident(t.table_name), priv)
  $$,
  'the authenticated role has no SELECT/INSERT/UPDATE/DELETE grant on any table in public either'
);

-- ---------------------------------------------------------------------------
-- No grant to PUBLIC (the pseudo-role, not the schema) exists anywhere
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select table_name || '.' || privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'PUBLIC'
  $$,
  'no grant to the PUBLIC pseudo-role exists on any table in public'
);

-- ---------------------------------------------------------------------------
-- An actual connection as anon gets nothing — not just "no grant on paper"
-- ---------------------------------------------------------------------------

set role anon;
select throws_ok(
  $$ select 1 from public.products limit 1 $$,
  '42501', null,
  'actually connecting as anon and querying products fails with permission denied (42501), not an empty result — it never gets far enough to ask RLS'
);
reset role;

-- ---------------------------------------------------------------------------
-- The service role can actually read
-- ---------------------------------------------------------------------------

select ok(
  (select rolbypassrls from pg_roles where rolname = 'service_role'),
  'service_role has BYPASSRLS set'
);
select ok(
  has_table_privilege('service_role', 'public.products', 'SELECT'),
  'service_role also has an actual SELECT grant — BYPASSRLS alone does not imply one, and without this the API could not read anything at all'
);

set role service_role;
select lives_ok(
  $$ select 1 from public.products limit 1 $$,
  'actually connecting as service_role and querying products succeeds'
);
reset role;

select * from finish();
rollback;
