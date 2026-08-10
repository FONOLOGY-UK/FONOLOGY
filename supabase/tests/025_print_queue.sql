-- 025 — Print queue (migration 0033)
--
-- This file exists to protect ONE asymmetry, because it is the whole safety
-- argument of the print agent and it is invisible from reading the calling
-- code:
--
--   an expired RECEIPT lease becomes `unconfirmed` and is never requeued
--   an expired LABEL   lease goes back to `queued` while attempts remain
--
-- If someone "simplifies" expire_print_leases() into one statement later, the
-- till starts silently reprinting receipts nobody asked for, and the first
-- anyone hears of it is a customer holding two receipts for one sale. Tests 4
-- and 5 below are the ones that must never be deleted.
--
-- Also covers the lease being genuinely atomic and single-owner, since a
-- second agent taking the same job is the other way this double-prints.

begin;
set local search_path to public, tap, extensions;
select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000251', 'test-staff-025@example.invalid');

insert into public.staff (id, email, name, role)
values (
  '00000000-0000-0000-0000-000000000251',
  'test-staff-025@example.invalid',
  'Test Cashier 025',
  'employee'
);

insert into public.print_agents (id, name, token_hash, is_primary)
values (
  '00000000-0000-0000-0000-0000000002a1',
  'Test agent 025',
  'test-025-hash',
  true
);

insert into public.print_jobs (id, kind, target, payload, dedupe_key, requested_by)
values
  ('00000000-0000-0000-0000-0000000002b1', 'sale_receipt', 'receipt',
   '{"total": 2400}'::jsonb, 'test-025:receipt',
   '00000000-0000-0000-0000-000000000251'),
  ('00000000-0000-0000-0000-0000000002b2', 'job_label', 'label',
   '{"reference": "FNL-TEST"}'::jsonb, 'test-025:label',
   '00000000-0000-0000-0000-000000000251');

-- ---------------------------------------------------------------------------
-- 1–2. Structure
-- ---------------------------------------------------------------------------

select is(
  (select status::text from public.print_jobs
    where id = '00000000-0000-0000-0000-0000000002b1'),
  'queued',
  'A new job starts queued'
);

select is(
  (select attempts from public.print_jobs
    where id = '00000000-0000-0000-0000-0000000002b1'),
  0,
  'A new job starts with zero attempts'
);

-- ---------------------------------------------------------------------------
-- 3. Targeted claim — the agent runs one loop per printer so a slow label
--    never leaves a customer waiting on a receipt.
-- ---------------------------------------------------------------------------

select is(
  (select id from public.claim_print_job(
     '00000000-0000-0000-0000-0000000002a1', 60, 'receipt')),
  '00000000-0000-0000-0000-0000000002b1'::uuid,
  'Claiming target=receipt returns the receipt job, never the label'
);

select is(
  (select status::text from public.print_jobs
    where id = '00000000-0000-0000-0000-0000000002b1'),
  'leased',
  'A claimed job is leased'
);

-- An empty queue must return NO rows. A function returning a bare composite
-- would hand back a row of NULLs here, which reads as a job with a null id.
select is_empty(
  $$ select * from public.claim_print_job(
       '00000000-0000-0000-0000-0000000002a1', 60, 'receipt') $$,
  'An empty queue returns zero rows, not a row of nulls'
);

-- ---------------------------------------------------------------------------
-- 4. THE RECEIPT RULE — expired lease becomes unconfirmed, never requeued
-- ---------------------------------------------------------------------------

update public.print_jobs
   set lease_expires_at = now() - interval '1 minute'
 where id = '00000000-0000-0000-0000-0000000002b1';

select lives_ok(
  $$ select public.expire_print_leases() $$,
  'expire_print_leases() runs (the label branch needs an explicit enum cast)'
);

select is(
  (select status::text from public.print_jobs
    where id = '00000000-0000-0000-0000-0000000002b1'),
  'unconfirmed',
  'An expired RECEIPT lease becomes unconfirmed — a human must confirm the paper came out'
);

select isnt(
  (select status::text from public.print_jobs
    where id = '00000000-0000-0000-0000-0000000002b1'),
  'queued',
  'An expired RECEIPT is NEVER put back on the queue — that is how you hand a customer two receipts'
);

-- ---------------------------------------------------------------------------
-- 5. THE LABEL RULE — requeue while attempts remain, then give up
-- ---------------------------------------------------------------------------

update public.print_jobs
   set status = 'leased',
       lease_owner = '00000000-0000-0000-0000-0000000002a1',
       lease_expires_at = now() - interval '1 minute'
 where id = '00000000-0000-0000-0000-0000000002b2';

select public.expire_print_leases();

select is(
  (select status::text from public.print_jobs
    where id = '00000000-0000-0000-0000-0000000002b2'),
  'queued',
  'An expired LABEL lease is requeued while attempts remain — a duplicate label is only waste'
);

update public.print_jobs
   set status = 'leased',
       lease_owner = '00000000-0000-0000-0000-0000000002a1',
       lease_expires_at = now() - interval '1 minute',
       attempts = max_attempts
 where id = '00000000-0000-0000-0000-0000000002b2';

select public.expire_print_leases();

select is(
  (select status::text from public.print_jobs
    where id = '00000000-0000-0000-0000-0000000002b2'),
  'failed',
  'A LABEL that has used every attempt lands in the terminal failed state'
);

-- ---------------------------------------------------------------------------
-- 6. Single owner — the other route to a double print
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.print_agents (name, token_hash, is_primary)
     values ('Second primary', 'test-025-hash-2', true) $$,
  '23505',
  null,
  'A second primary agent is impossible — two agents cannot split the queue'
);

update public.print_agents
   set is_primary = false
 where id = '00000000-0000-0000-0000-0000000002a1';

select throws_ok(
  $$ select * from public.claim_print_job(
       '00000000-0000-0000-0000-0000000002a1', 60, null) $$,
  'P0001',
  null,
  'A non-primary agent is refused a lease outright'
);

-- ---------------------------------------------------------------------------
-- 7. Idempotency and retention
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.print_jobs (kind, target, payload, dedupe_key)
     values ('sale_receipt', 'receipt', '{}'::jsonb, 'test-025:receipt') $$,
  '23505',
  null,
  'The same dedupe_key cannot be enqueued twice — a double tap on Print is a no-op'
);

-- Retention must never reclaim a job that is still waiting on a person. An
-- unconfirmed job is an unanswered question; deleting it loses the question.
update public.print_jobs
   set created_at = now() - interval '400 days'
 where id in (
   '00000000-0000-0000-0000-0000000002b1',   -- unconfirmed
   '00000000-0000-0000-0000-0000000002b2'    -- failed (terminal)
 );

select is(
  (select count(*)::int from public.print_jobs_due_for_deletion()
    where id = '00000000-0000-0000-0000-0000000002b1'),
  0,
  'A 400-day-old UNCONFIRMED job is never due for deletion — it is a question waiting on a human'
);

rollback;
