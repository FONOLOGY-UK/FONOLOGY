-- 034 — Our own accounts, sessions and tokens (0093)
-- The API does sign-in itself now. These are the guarantees it leans on and
-- does not re-check in code: one account per email whatever the case, one per
-- Google id, a stored token that is really a SHA-256, and delete rules that
-- keep staff history while letting a customer go.

begin;
set local search_path to public, tap, extensions;
select plan(16);

insert into public.user_accounts (id, email, password_hash) values
  ('00000000-0000-0000-0000-000000003401', 'Owner-034@Example.invalid', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'),
  ('00000000-0000-0000-0000-000000003402', 'customer-034@example.invalid', null),
  ('00000000-0000-0000-0000-000000003403', 'google-034@example.invalid', null);
update public.user_accounts set google_sub = 'google-sub-034' where id = '00000000-0000-0000-0000-000000003403';

-- ---------------------------------------------------------------------------
-- Nothing points at Supabase's auth.users any more
-- ---------------------------------------------------------------------------

select is_empty(
  $$
  select conrelid::regclass::text || '.' || conname from pg_constraint
  where confrelid = 'auth.users'::regclass
  $$,
  'no foreign key anywhere references auth.users — staff and customers moved to user_accounts'
);

-- ---------------------------------------------------------------------------
-- Identity is unique
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.user_accounts (email) values ('owner-034@example.INVALID') $$,
  '23505', null,
  'a second account for the same email in different case is refused — email is citext'
);
select throws_ok(
  $$ insert into public.user_accounts (email, google_sub) values ('other-034@example.invalid', 'google-sub-034') $$,
  '23505', null,
  'a second account for the same Google id is refused'
);
select lives_ok(
  $$ insert into public.user_accounts (email) values ('no-credential-034@example.invalid') $$,
  'an account with neither a password nor a Google id can exist (it simply cannot sign in) — the API decides when one is created'
);

-- ---------------------------------------------------------------------------
-- Profiles hang off accounts, with the old delete rules
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.staff (id, email, name) values (gen_random_uuid(), 'orphan-034@example.invalid', 'Orphan') $$,
  '23503', null,
  'a staff row with no account behind it is refused'
);

insert into public.staff (id, email, name, role)
  values ('00000000-0000-0000-0000-000000003401', 'owner-034@example.invalid', 'Owner 034', 'owner');
insert into public.customers (id, email, name)
  values ('00000000-0000-0000-0000-000000003402', 'customer-034@example.invalid', 'Customer 034');

select throws_ok(
  $$ delete from public.user_accounts where id = '00000000-0000-0000-0000-000000003401' $$,
  '23503', null,
  'deleting the account of a staff member is refused — staff are deactivated, never deleted (their name is on sales)'
);

-- ---------------------------------------------------------------------------
-- Sessions and tokens
-- ---------------------------------------------------------------------------

insert into public.auth_sessions (account_id, token_hash, expires_at)
  values ('00000000-0000-0000-0000-000000003402', sha256('session-034-a'::bytea), now() + interval '30 days');
insert into public.auth_tokens (account_id, purpose, token_hash, expires_at)
  values ('00000000-0000-0000-0000-000000003402', 'email_confirm', sha256('token-034-a'::bytea), now() + interval '1 day');

select throws_ok(
  $$ insert into public.auth_sessions (account_id, token_hash, expires_at)
     values ('00000000-0000-0000-0000-000000003401', sha256('session-034-a'::bytea), now() + interval '1 day') $$,
  '23505', null,
  'two sessions can never share a token hash'
);
select throws_ok(
  $$ insert into public.auth_sessions (account_id, token_hash, expires_at)
     values ('00000000-0000-0000-0000-000000003401', 'not a hash'::bytea, now() + interval '1 day') $$,
  '23514', null,
  'a session token_hash that is not 32 bytes (a SHA-256) is refused — a raw token stored by mistake cannot slip in'
);
select throws_ok(
  $$ insert into public.auth_sessions (account_id, token_hash, expires_at)
     values ('00000000-0000-0000-0000-000000003401', sha256('session-034-b'::bytea), now() - interval '1 second') $$,
  '23514', null,
  'a session that expires before it was created is refused'
);
select throws_ok(
  $$ insert into public.auth_sessions (account_id, token_hash) values ('00000000-0000-0000-0000-000000003401', sha256('session-034-c'::bytea)) $$,
  '23502', null,
  'a session must have an expiry — there is no such thing as a session that never ends'
);
select throws_ok(
  $$ insert into public.auth_tokens (account_id, purpose, token_hash, expires_at)
     values ('00000000-0000-0000-0000-000000003401', 'magic_link', sha256('token-034-b'::bytea), now() + interval '1 hour') $$,
  '23514', null,
  'a token purpose other than email_confirm / password_reset is refused'
);
select throws_ok(
  $$ insert into public.auth_tokens (account_id, purpose, token_hash, expires_at)
     values ('00000000-0000-0000-0000-000000003401', 'password_reset', sha256('token-034-a'::bytea), now() + interval '1 hour') $$,
  '23505', null,
  'two tokens can never share a hash, whatever their purpose'
);

-- ---------------------------------------------------------------------------
-- Deleting a customer's account takes everything of theirs with it
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ delete from public.user_accounts where id = '00000000-0000-0000-0000-000000003402' $$,
  'deleting a customer''s account succeeds'
);
select is(
  (select count(*)::int from public.customers where id = '00000000-0000-0000-0000-000000003402'),
  0,
  'their customer profile went with it (cascade, as it did from auth.users)'
);
select is(
  (select count(*)::int from public.auth_sessions where account_id = '00000000-0000-0000-0000-000000003402'),
  0,
  'their sessions went with it — a deleted account cannot stay signed in'
);
select is(
  (select count(*)::int from public.auth_tokens where account_id = '00000000-0000-0000-0000-000000003402'),
  0,
  'their unused email tokens went with it'
);

select * from finish();
rollback;
