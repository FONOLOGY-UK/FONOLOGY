-- 033 — Jobs have their own number sequence (JOB-), independent of FNL-
-- Change request item 2 / migration 0091.
--
-- The bug: every reference shared one sequence, so a job's number depended on
-- how many sales, orders and requests landed in between (found on staging:
-- sale FNL-10689, job FNL-10690, request FNL-10691, job FNL-10692). The
-- middle case below is exactly that interleaving.

begin;
set local search_path to public, tap, extensions;
select plan(7);

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000003301', 'walk_in', 'Job Number One', 'Test Phone', 'Screen');

select matches(
  (select reference from public.jobs where id = '00000000-0000-0000-0000-000000003301'),
  '^JOB-[0-9]+$',
  'a new job gets a JOB- number'
);

-- Something else takes an ordinary reference in between — a sale, an order,
-- a repair request would all do this.
select matches(
  public.issue_reference('test_other', '00000000-0000-0000-0000-000000003399'),
  '^FNL-[0-9]+$',
  'everything else still gets FNL- from the shared sequence'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000003302', 'walk_in', 'Job Number Two', 'Test Phone', 'Battery');

select is(
  (select split_part(reference, '-', 2)::int from public.jobs where id = '00000000-0000-0000-0000-000000003302'),
  (select split_part(reference, '-', 2)::int + 1 from public.jobs where id = '00000000-0000-0000-0000-000000003301'),
  'the next job is the next job number, whatever was issued in between'
);

select is(
  (select entity_type from public.reference_registry
    where reference = (select reference from public.jobs where id = '00000000-0000-0000-0000-000000003302')),
  'job',
  'a JOB- number is still recorded in the one reference registry'
);

select is(
  (select entity_id from public.reference_registry
    where reference = (select reference from public.jobs where id = '00000000-0000-0000-0000-000000003302')),
  '00000000-0000-0000-0000-000000003302'::uuid,
  'and the registry points at the right job'
);

select ok(
  (select last_value >= 1001 from public.job_reference_seq),
  'job numbers start at 1001'
);

-- A job's reference is minted by the trigger, never taken from the insert.
insert into public.jobs (id, source, customer_name, device_description, problem_description, reference)
values ('00000000-0000-0000-0000-000000003303', 'walk_in', 'Job Number Three', 'Test Phone', 'Port', 'FNL-99999');

select matches(
  (select reference from public.jobs where id = '00000000-0000-0000-0000-000000003303'),
  '^JOB-[0-9]+$',
  'a reference supplied on insert is ignored — the job still gets its JOB- number'
);

select * from finish();
rollback;
