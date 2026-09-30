-- Supabase compatibility layer — runs FIRST, and only on plain Postgres.
--
-- supabase/migrations 0001–0092 are frozen (see supabase/migrations/README.md)
-- and were written for a Supabase database, which ships with a few things a
-- vanilla Postgres does not have. This file provides exactly those, and
-- nothing else, so every frozen migration applies unedited:
--
--   * roles anon / authenticated / service_role — 0011 revokes from the first
--     two and grants to the third. service_role gets BYPASSRLS, as on Supabase
--     (supabase/tests/010_security.sql checks it).
--   * auth.users — the FK target of staff.id and customers.id (0002). Only the
--     columns anything here uses. 0093 moves those FKs onto our own table.
--   * storage.buckets / storage.objects — 0011 registers buckets and puts one
--     read policy on objects. Files actually live in Garage; these rows are
--     inert.
--
-- Idempotent: the runner applies it on every run, as the superuser, after
-- creating the app roles (fonology_owner, fonology_api) itself.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

-- Owned by fonology_owner (the runner creates that role before this file), so
-- the migrations — which run as fonology_owner — can reference auth.users
-- and create the storage policy exactly as they would on Supabase.
create schema if not exists auth authorization fonology_owner;
create table if not exists auth.users (
  id    uuid primary key,
  email text
);
alter table auth.users owner to fonology_owner;

create schema if not exists storage authorization fonology_owner;
create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text
);
alter table storage.buckets owner to fonology_owner;
alter table storage.objects owner to fonology_owner;
alter table storage.objects enable row level security;
