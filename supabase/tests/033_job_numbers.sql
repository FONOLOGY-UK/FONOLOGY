-- 033 — Jobs have their own number series, independent of every other kind of record
-- Change request item 2 / migration 0091; since 0106 the per-shop daily JOB series.
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
  '^F01-JOB-[0-9]{9}$',
  'a new job at the hub gets an F01-JOB- number'
);

-- Something else takes a reference in between — a sale, an order, a repair
-- request would all do this.
select matches(
  public.issue_shop_reference('SAL', public.default_shop_id(), 'test_other', '00000000-0000-0000-0000-000000003399'),
  '^F01-SAL-[0-9]{9}$',
  'a sale gets a number from its own series'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000003302', 'walk_in', 'Job Number Two', 'Test Phone', 'Battery');

select is(
  (select substr(split_part(reference, '-', 3), 7)::int from public.jobs where id = '00000000-0000-0000-0000-000000003302'),
  (select substr(split_part(reference, '-', 3), 7)::int + 1 from public.jobs where id = '00000000-0000-0000-0000-000000003301'),
  'the next job is the next job number, whatever was issued in between'
);

select is(
  (select entity_type from public.reference_registry
    where reference = (select reference from public.jobs where id = '00000000-0000-0000-0000-000000003302')),
  'job',
  'a job number is still recorded in the one reference registry'
);

select is(
  (select entity_id from public.reference_registry
    where reference = (select reference from public.jobs where id = '00000000-0000-0000-0000-000000003302')),
  '00000000-0000-0000-0000-000000003302'::uuid,
  'and the registry points at the right job'
);

select is(
  (select substr(split_part(reference, '-', 3), 1, 6) from public.jobs where id = '00000000-0000-0000-0000-000000003302'),
  to_char(public.shop_day(now()), 'DDMMYY'),
  'the date in a job number is today''s shop day'
);

-- A job's reference is minted by the trigger, never taken from the insert.
insert into public.jobs (id, source, customer_name, device_description, problem_description, reference)
values ('00000000-0000-0000-0000-000000003303', 'walk_in', 'Job Number Three', 'Test Phone', 'Port', 'FNL-99999');

select matches(
  (select reference from public.jobs where id = '00000000-0000-0000-0000-000000003303'),
  '^F01-JOB-[0-9]{9}$',
  'a reference supplied on insert is ignored — the job still gets its own number'
);

select * from finish();
rollback;
