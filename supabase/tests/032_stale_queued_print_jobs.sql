-- 032 — A queued print job nobody ever claimed is given up on
-- Migration 0090.
--
-- Found on hosted dev as nine jobs queued since 22 August, attempts = 0, that
-- nothing in the system would ever have touched: the agent would have printed
-- the whole backlog on its next connection, and their customer PII was
-- unreachable by a retention purge that only looks at terminal rows.
--
-- The two exemptions below matter as much as the two rules. A receipt from
-- TODAY and a label inside its window are live work, and a sweep that eats
-- those is worse than the bug — it silently stops the shop printing.

begin;
set local search_path to public, tap, extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000c01', 'test-staff-032@example.invalid');
insert into public.staff (id, email, name, role)
values ('00000000-0000-0000-0000-000000000c01', 'test-staff-032@example.invalid', 'Test Printer', 'owner');

update public.shop_settings set print_job_stale_label_hours = 72;

-- A receipt from a PREVIOUS shop day, and one from today.
insert into public.print_jobs (id, kind, target, status, payload, dedupe_key, created_at)
values
  ('00000000-0000-0000-0000-00000000c010', 'sale_receipt', 'receipt', 'queued', '{}'::jsonb, 'stale-receipt-032',  now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000c011', 'sale_receipt', 'receipt', 'queued', '{}'::jsonb, 'fresh-receipt-032',  now());

-- A label well past the window, one comfortably inside it.
insert into public.print_jobs (id, kind, target, status, payload, dedupe_key, created_at)
values
  ('00000000-0000-0000-0000-00000000c012', 'job_label', 'label', 'queued', '{}'::jsonb, 'stale-label-032', now() - interval '96 hours'),
  ('00000000-0000-0000-0000-00000000c013', 'job_label', 'label', 'queued', '{}'::jsonb, 'fresh-label-032', now() - interval '24 hours'),
  -- The real dev case: queued for weeks, far past print_job_retention_days.
  ('00000000-0000-0000-0000-00000000c016', 'job_label', 'label', 'queued', '{}'::jsonb, 'ancient-label-032', now() - interval '40 days');

-- An old job in each NON-queued state. None of these is this sweep's business:
-- `unconfirmed` is a question waiting on a person (0033), and a printed job is
-- already terminal and owned by retention.
insert into public.print_jobs (id, kind, target, status, payload, dedupe_key, created_at)
values
  ('00000000-0000-0000-0000-00000000c014', 'sale_receipt', 'receipt', 'unconfirmed', '{}'::jsonb, 'old-unconfirmed-032', now() - interval '30 days');

-- printed_at is not optional here: print_jobs_printed_at_set refuses a
-- `printed` row without one, which is the right invariant and which the
-- first version of this fixture tripped over.
insert into public.print_jobs (id, kind, target, status, payload, dedupe_key, created_at, printed_at)
values
  ('00000000-0000-0000-0000-00000000c015', 'job_label', 'label', 'printed', '{}'::jsonb, 'old-printed-032', now() - interval '30 days', now() - interval '30 days');

-- ---------------------------------------------------------------------------
-- The sweep
-- ---------------------------------------------------------------------------

select is(
  (select public.expire_stale_print_jobs()),
  3,
  'exactly three are given up on — the old receipt and the two old labels, nothing else'
);

select is(
  (select status::text from public.print_jobs where id = '00000000-0000-0000-0000-00000000c010'),
  'failed',
  'a receipt queued on a previous shop day is failed — nobody wants yesterday''s receipt'
);

select is(
  (select status::text from public.print_jobs where id = '00000000-0000-0000-0000-00000000c011'),
  'queued',
  'a receipt rung up TODAY is left alone — it is live work, not a backlog'
);

select is(
  (select status::text from public.print_jobs where id = '00000000-0000-0000-0000-00000000c012'),
  'failed',
  'a label past print_job_stale_label_hours is failed'
);

select is(
  (select status::text from public.print_jobs where id = '00000000-0000-0000-0000-00000000c013'),
  'queued',
  'a label inside the window survives — Friday''s bench ticket still prints on Monday'
);

select is(
  (select status::text from public.print_jobs where id = '00000000-0000-0000-0000-00000000c014'),
  'unconfirmed',
  'a 30-day-old UNCONFIRMED receipt is untouched — that is a question for a person, not a stale queue entry'
);

select is(
  (select status::text from public.print_jobs where id = '00000000-0000-0000-0000-00000000c015'),
  'printed',
  'an old PRINTED job is untouched — retention already owns it'
);

select isnt(
  (select last_error from public.print_jobs where id = '00000000-0000-0000-0000-00000000c010'),
  null,
  'the failed receipt says why, so the printing screen can explain it'
);

-- ---------------------------------------------------------------------------
-- The point of the whole change: they become purgeable
-- ---------------------------------------------------------------------------
-- Retention ages from created_at and returns terminal rows only. Before 0090
-- a queued job could never appear here however old it got — which is how
-- customer names and phone numbers outlived a seven-day policy by six weeks
-- on dev.
--
-- Note what this does NOT claim. Becoming terminal does not mean "deleted
-- now"; it means retention can finally see the row. A label that goes stale
-- at 3 days under a 7-day policy still waits out the remaining 4 — correct,
-- and worth asserting so nobody later reads the fix as instant erasure. The
-- first version of this test asserted the opposite and failed, which is the
-- only reason the distinction is written down here.

select ok(
  (select count(*) from public.print_jobs_due_for_deletion()
    where id = '00000000-0000-0000-0000-00000000c016') = 1,
  'the 40-day-old label is now purgeable — the real dev case, unreachable while queued'
);

select ok(
  (select count(*) from public.print_jobs_due_for_deletion()
    where id = '00000000-0000-0000-0000-00000000c012') = 0,
  'the 4-day-old label is failed but NOT yet purgeable — retention still owns the timing'
);

-- ---------------------------------------------------------------------------
-- Idempotent
-- ---------------------------------------------------------------------------
-- The cron runs this every two minutes. A second pass must find nothing left
-- to do rather than re-touching rows it already handled.

select is(
  (select public.expire_stale_print_jobs()),
  0,
  'running it again changes nothing — it is a sweep, not a counter'
);

select * from finish();
rollback;
