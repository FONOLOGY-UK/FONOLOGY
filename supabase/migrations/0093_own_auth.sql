-- 0093 - Our own accounts, sessions and one-time tokens (off Supabase Auth)
-- ---------------------------------------------------------------------------
-- Until now sign-in lived in Supabase Auth: `auth.users` held the login, and
-- `staff.id` / `customers.id` were foreign keys onto it (0002). The shop is
-- leaving Supabase, so apps/api takes sign-in over, and these three tables
-- are what it needs. Nothing here is read by any SQL function — they are the
-- API's to use, behind the same deny-all RLS as every other table.
--
-- user_accounts   one row per login. The profile rows (staff, customers)
--                 keep their own id = the account's id, exactly as they did
--                 with auth.users, so no other table changes. One account
--                 can be both staff and a customer, as before.
-- auth_sessions   a signed-in browser. The cookie holds a random token; only
--                 its SHA-256 is stored, so a leaked table is not a set of
--                 live sessions. Looked up in one indexed query per request.
-- auth_tokens     single-use links: confirm an email, reset a password. Same
--                 hash-only rule; `used_at` makes a second click a no-op.
--
-- Passwords: argon2id for anything set from now on. Accounts imported from
-- Supabase arrive with their bcrypt hash and are re-hashed to argon2id on the
-- first successful sign-in — that is why password_hash has no format check.
-- A Google-only account has no password_hash at all.
--
-- staff_sessions (0002, 0089) is untouched: it is the till's lock / pos_only
-- state for a signed-in staff member, not the sign-in itself.

create table public.user_accounts (
  id                 uuid primary key default gen_random_uuid(),
  email              citext not null unique,
  password_hash      text,
  email_verified_at  timestamptz,
  google_sub         text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger user_accounts_updated_at
  before update on public.user_accounts
  for each row execute function public.set_updated_at();

comment on table public.user_accounts is
  'One row per login (0093, replacing Supabase auth.users). staff.id and customers.id are this id. password_hash is argon2id, or a bcrypt hash imported from Supabase that is re-hashed on first sign-in; null for a Google-only account.';
comment on column public.user_accounts.google_sub is
  'The stable Google account id (the OIDC `sub` claim) — never the email, which a Google user can change.';

create table public.auth_sessions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.user_accounts (id) on delete cascade,
  token_hash    bytea not null unique check (length(token_hash) = 32),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  user_agent    text,
  constraint auth_sessions_expires_after_created check (expires_at > created_at)
);

create index auth_sessions_account_idx
  on public.auth_sessions (account_id);

comment on table public.auth_sessions is
  'A signed-in browser (0093). The cookie carries a random token; token_hash is its SHA-256, so this table alone cannot be replayed. Live = revoked_at is null and expires_at is in the future. Signing out, a password reset and a PIN switch revoke rows; they are never reused.';

create table public.auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.user_accounts (id) on delete cascade,
  purpose     text not null check (purpose in ('email_confirm', 'password_reset')),
  token_hash  bytea not null unique check (length(token_hash) = 32),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  constraint auth_tokens_expires_after_created check (expires_at > created_at)
);

create index auth_tokens_account_idx
  on public.auth_tokens (account_id);

comment on table public.auth_tokens is
  'Single-use emailed links (0093): confirm an email address, reset a password. Only the SHA-256 of the token is stored; used_at is stamped on first use and a used or expired token is refused.';

-- Same posture as every other table (0011): RLS on and forced, no policies.
-- The API's role bypasses it; nothing else gets a row.
alter table public.user_accounts enable row level security;
alter table public.user_accounts force row level security;
alter table public.auth_sessions enable row level security;
alter table public.auth_sessions force row level security;
alter table public.auth_tokens enable row level security;
alter table public.auth_tokens force row level security;

-- ---------------------------------------------------------------------------
-- Move staff and customers off auth.users
-- ---------------------------------------------------------------------------
-- Every existing profile gets its account first, same id and email, so the
-- new constraints validate. The delete rules are carried over unchanged:
-- removing an account removes a customer profile (their orders survive as
-- guest orders — see 0002/tests 014) but is refused for staff, who are
-- deactivated, never deleted.

insert into public.user_accounts (id, email)
select id, email from public.staff
on conflict (id) do nothing;

insert into public.user_accounts (id, email)
select id, email from public.customers
on conflict (id) do nothing;

alter table public.staff drop constraint staff_id_fkey;
alter table public.staff
  add constraint staff_id_fkey
  foreign key (id) references public.user_accounts (id) on delete restrict;

alter table public.customers drop constraint customers_id_fkey;
alter table public.customers
  add constraint customers_id_fkey
  foreign key (id) references public.user_accounts (id) on delete cascade;
