-- 010 — Security
-- Everything here is proved by querying the catalog and the privilege
-- system directly — not by reading 0011 — so a table added later without
-- its own RLS/grants is caught automatically, the same principle as 001.
--
-- The roles that matter since the move off Supabase (0093, migrate.ts):
--   fonology_owner  owns every object; migrations run as it
--   fonology_api    the only thing that logs in: BYPASSRLS, member of
--                   service_role for 0011's grants, no DDL
-- anon / authenticated / service_role still exist (db/bootstrap compat
-- layer), so they are still checked: a grant to them would be a grant to
-- anyone who ever gets a role in this cluster.

begin;
set local search_path to public, tap, extensions;
select plan(17);

-- ---------------------------------------------------------------------------
-- RLS is enabled (and forced) on every table, and nothing has a policy
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
select is_empty(
  $$ select tablename || ': ' || policyname from pg_policies where schemaname = 'public' $$,
  'no table in public has any RLS policy — deny-all is the design, access is only through a BYPASSRLS role'
);

-- ---------------------------------------------------------------------------
-- Who owns what
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select c.relname || ' (' || pg_get_userbyid(c.relowner) || ')' from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'S')
    and pg_get_userbyid(c.relowner) <> 'fonology_owner'
  $$,
  'every table, view and sequence in public is owned by fonology_owner — so a migration run any other way shows up here'
);

-- ---------------------------------------------------------------------------
-- The API's login role: can read and write data, cannot change the schema
-- ---------------------------------------------------------------------------

select ok(
  (select rolbypassrls and rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb
   from pg_roles where rolname = 'fonology_api'),
  'fonology_api can log in and has BYPASSRLS, and is not a superuser and cannot create roles or databases'
);
select ok(
  pg_has_role('fonology_api', 'service_role', 'USAGE'),
  'fonology_api inherits service_role — that is where every table grant from 0011 lives'
);
select ok(
  not has_schema_privilege('fonology_api', 'public', 'CREATE'),
  'fonology_api has no CREATE on schema public'
);

set role fonology_api;
select lives_ok(
  $$ select 1 from public.products limit 1 $$,
  'actually connecting as fonology_api and reading products succeeds'
);
select lives_ok(
  $$ select 1 from public.user_accounts limit 1 $$,
  'fonology_api can read user_accounts (0093) — the API does sign-in itself now'
);
select throws_ok(
  $$ create table public.fonology_api_should_not_create_this (x int) $$,
  '42501', null,
  'fonology_api cannot create a table in public (42501)'
);
select throws_ok(
  $$ drop table public.products $$,
  '42501', null,
  'fonology_api cannot drop a table either — it does not own anything'
);
reset role;

select ok(
  (select rolbypassrls and not rolcanlogin from pg_roles where rolname = 'fonology_owner'),
  'fonology_owner cannot log in (migrations reach it by SET ROLE from a superuser) and has BYPASSRLS, like the Supabase postgres role the migrations were written for'
);

-- ---------------------------------------------------------------------------
-- Everyone else gets nothing
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select t.table_name || '.' || priv || ' (' || r.rolname || ')' as offender
  from information_schema.tables t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as priv
  cross join (values ('anon'), ('authenticated')) as r (rolname)
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
    and has_table_privilege(r.rolname, 'public.' || quote_ident(t.table_name), priv)
  $$,
  'anon and authenticated have no SELECT/INSERT/UPDATE/DELETE on any table in public, checked generically so a future table is covered automatically'
);
select is_empty(
  $$
  select table_name || '.' || privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'PUBLIC'
  $$,
  'no grant to the PUBLIC pseudo-role exists on any table in public'
);

set role anon;
select throws_ok(
  $$ select 1 from public.user_accounts limit 1 $$,
  '42501', null,
  'actually connecting as anon and querying user_accounts fails with permission denied (42501), not an empty result'
);
reset role;

select ok(
  (select rolbypassrls from pg_roles where rolname = 'service_role'),
  'service_role has BYPASSRLS set'
);
select ok(
  has_table_privilege('service_role', 'public.auth_sessions', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role has real grants on a table created after 0011 (auth_sessions, 0093) — the default privileges carried over'
);

select * from finish();
rollback;
