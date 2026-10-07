-- 044 — Repair-stage SMS (migration 0105)
-- A default text for every stage, one per shop at most per stage, the per-job
-- opt-out, and the send log.

begin;
set local search_path to public, tap, extensions;
select plan(9);

select is(
  (select count(*)::integer from public.job_sms_templates where shop_id is null),
  (select count(*)::integer from unnest(enum_range(null::job_status))),
  'every job stage has a default text');
select is(
  (select count(*)::integer from public.job_sms_templates where shop_id is null and enabled),
  (select count(*)::integer from unnest(enum_range(null::job_status))),
  'and every default is switched on');

select throws_ok(
  $$ insert into public.job_sms_templates (shop_id, status, body) values (null, 'new', 'second default') $$,
  '23505', null, 'there is only one default per stage');

insert into public.job_sms_templates (shop_id, status, body)
values (public.default_shop_id(), 'new', 'Shop wording');
select throws_ok(
  $$ insert into public.job_sms_templates (shop_id, status, body)
     values (public.default_shop_id(), 'new', 'another') $$,
  '23505', null, 'and one per shop per stage');

select throws_ok(
  $$ insert into public.job_sms_templates (shop_id, status, body) values (public.default_shop_id(), 'done', '   ') $$,
  '23514', null, 'a blank text is refused');

insert into public.jobs (id, customer_name, phone, device_description, problem_description, source)
values ('00000000-0000-0000-0000-000000004401', 'Sam Test', '07700 900123', 'iPhone 13', 'Cracked screen', 'walk_in');
select is((select sms_updates from public.jobs where id = '00000000-0000-0000-0000-000000004401'), true,
  'a new job texts the customer unless told not to');

insert into public.job_sms_log (job_id, shop_id, status, to_phone, body, state, reason)
values ('00000000-0000-0000-0000-000000004401', public.default_shop_id(), 'new', '447700900123', 'hello', 'skipped', 'log mode');
select is((select count(*)::integer from public.job_sms_log where job_id = '00000000-0000-0000-0000-000000004401'), 1,
  'a send is logged against the job');

delete from public.jobs where id = '00000000-0000-0000-0000-000000004401';
select is((select count(*)::integer from public.job_sms_log where job_id = '00000000-0000-0000-0000-000000004401'), 0,
  'deleting a job takes its log with it');

select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.job_sms_log'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.job_sms_templates'::regclass),
  'row level security is forced on both tables');

select * from finish();
rollback;
