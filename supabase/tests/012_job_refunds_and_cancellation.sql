-- 012 — Job refunds and job cancellation
-- Two gaps from the last review, closed together because the second feeds
-- the first: a cancelled job's deposit becomes real money that needs a real
-- way back out, and that way is create_refund(p_job_id => ...).

begin;
set local search_path to public, tap, extensions;
select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001201', 'test-staff-012@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001201', 'test-staff-012@example.invalid', 'Test Bencher', 'owner');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001210', 'job-refund-test-item', 'Job Refund Test Item', 'cases', 1000, 400, 100);

insert into public.devices (id, name, brand, price_multiplier) values
  ('00000000-0000-0000-0000-000000001220', 'Job Cancel Test Device', 'TestBrand', 1.00);
insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy) values
  ('00000000-0000-0000-0000-000000001221', 'Job Cancel Test Repair', 5000, 5000, 5000);

insert into public.bookings (id, reference, device_id, repair_type_id, tier, quoted_price, customer_name, phone, email, address_line1, city, postcode, preferred_contact)
values ('00000000-0000-0000-0000-000000001230', 'FNL-TEST-BOOKING-012', '00000000-0000-0000-0000-000000001220', '00000000-0000-0000-0000-000000001221', 'original', 5000, 'Mail-in Customer', '07000000000', 'mailin012@example.invalid', '1 Test Street', 'Testville', 'TE1 1ST', 'email');

-- ---------------------------------------------------------------------------
-- Job refunds: exactly one link, capped at what was actually paid
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000001240', 'walk_in', 'Refund Test Customer', 'Test phone', 'Cracked screen', 5000);

do $$ begin
  perform public.record_job_payment('00000000-0000-0000-0000-000000001240', 'deposit', 2000, 'cash', '00000000-0000-0000-0000-000000001201');
end $$;

select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001201', p_amount => 2500, p_refund_tender => 'cash',
    p_reason => 'refunding more than the deposit taken', p_job_id => '00000000-0000-0000-0000-000000001240'
  )
  $$,
  null, null,
  'a job refund exceeding what was actually paid on the job (2500p against a 2000p deposit) is refused'
);

select lives_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001201', p_amount => 2000, p_refund_tender => 'cash',
    p_reason => 'customer abandoned the repair, returning the deposit', p_job_id => '00000000-0000-0000-0000-000000001240'
  )
  $$,
  'a job refund for exactly what was paid (2000p deposit) succeeds'
);

select ok(
  exists (select 1 from public.refunds where job_id = '00000000-0000-0000-0000-000000001240' and amount = 2000),
  'the job refund is on record, linked to the job'
);

select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001201', p_amount => 1, p_refund_tender => 'cash',
    p_reason => 'the deposit was already fully refunded above', p_job_id => '00000000-0000-0000-0000-000000001240'
  )
  $$,
  null, null,
  'a second refund against the same job, even for 1p, is refused once the full 2000p already paid has been refunded'
);

select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001201', p_amount => 500, p_refund_tender => 'cash',
    p_reason => 'a job that does not exist', p_job_id => gen_random_uuid()
  )
  $$,
  null, null,
  'a refund naming a job id that does not exist is refused'
);

-- A real sale, so the "two links at once" case below is actually testing
-- two links — this file creates no sale anywhere else, so without one
-- p_sale_id would resolve to null and this would silently degrade into the
-- ordinary, already-covered "job only" case instead.
create temporary table _t012_two_links_sale as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001201'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001210','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000))
  ) as id;

select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001201', p_amount => 500, p_refund_tender => 'cash',
    p_reason => 'naming a sale and a job at once', p_sale_id => (select id from _t012_two_links_sale),
    p_job_id => '00000000-0000-0000-0000-000000001240'
  )
  $$,
  null, null,
  'a refund naming both a sale and a job at once is refused — refunds_exactly_one_link means exactly one, not up to one'
);

-- ---------------------------------------------------------------------------
-- Jobs can be abandoned: cancellation reachable from new/in_progress/waiting_approval
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000001250', 'walk_in', 'Cancel From New', 'Test phone', 'Battery issue');
select lives_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = 'customer changed their mind' where id = '00000000-0000-0000-0000-000000001250' $$,
  'a job cancelled directly from new, with a reason, succeeds'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description, status)
values ('00000000-0000-0000-0000-000000001251', 'walk_in', 'Cancel From In Progress', 'Test phone', 'Screen issue', 'in_progress');
select lives_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = 'part unavailable, customer declined to wait' where id = '00000000-0000-0000-0000-000000001251' $$,
  'a job cancelled from in_progress, with a reason, succeeds'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description, status, revised_quote)
values ('00000000-0000-0000-0000-000000001252', 'walk_in', 'Cancel From Waiting Approval', 'Test phone', 'Water damage', 'waiting_approval', 8000);
select lives_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = 'customer never approved the revised quote' where id = '00000000-0000-0000-0000-000000001252' $$,
  'a job cancelled from waiting_approval — the exact stuck-forever case the gap named — succeeds with a reason'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description, status)
values ('00000000-0000-0000-0000-000000001253', 'walk_in', 'Cancel From Done', 'Test phone', 'Charging port', 'done');
select throws_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = 'too late, already finished' where id = '00000000-0000-0000-0000-000000001253' $$,
  null, null,
  'a job cannot be cancelled once done — done -> cancelled is not a reachable transition'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000001254', 'walk_in', 'No Reason Given', 'Test phone', 'Speaker issue');
select throws_ok(
  $$ update public.jobs set status = 'cancelled' where id = '00000000-0000-0000-0000-000000001254' $$,
  null, null,
  'cancelling a job without a reason is refused'
);
select throws_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = '   ' where id = '00000000-0000-0000-0000-000000001254' $$,
  null, null,
  'cancelling a job with a whitespace-only reason is refused, same as no reason at all'
);

-- ---------------------------------------------------------------------------
-- Mail-in cancellation forces device-held resolution; walk-in doesn't
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, booking_id, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000001260', 'mail_in', '00000000-0000-0000-0000-000000001230', 'Mail-in Cancel Customer', 'Mail-in phone', 'Cracked back');
select throws_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = 'customer went silent' where id = '00000000-0000-0000-0000-000000001260' $$,
  null, null,
  'cancelling a mail-in job without recording whether the device is still held is refused — the phone cannot just evaporate'
);
select lives_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = 'customer went silent', device_returned = false where id = '00000000-0000-0000-0000-000000001260' $$,
  'cancelling a mail-in job WITH device_returned recorded (false — shop still holds it) succeeds'
);

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000001261', 'walk_in', 'Walk-in Cancel Customer', 'Walk-in phone', 'Home button');
select lives_ok(
  $$ update public.jobs set status = 'cancelled', cancellation_reason = 'customer decided to buy new' where id = '00000000-0000-0000-0000-000000001261' $$,
  'cancelling a walk-in job without recording device_returned still succeeds — the force-resolution rule is mail-in only, the customer has their own device in hand'
);

-- ---------------------------------------------------------------------------
-- End to end: a deposit on a now-cancelled job is genuinely refundable
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000001270', 'walk_in', 'Full Cycle Customer', 'Test phone', 'Full cycle test', 4000);
do $$ begin
  perform public.record_job_payment('00000000-0000-0000-0000-000000001270', 'deposit', 1500, 'cash', '00000000-0000-0000-0000-000000001201');
end $$;
update public.jobs set status = 'cancelled', cancellation_reason = 'abandoned after deposit' where id = '00000000-0000-0000-0000-000000001270';

select lives_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000001201', p_amount => 1500, p_refund_tender => 'cash',
    p_reason => 'returning the deposit on an abandoned job', p_job_id => '00000000-0000-0000-0000-000000001270'
  )
  $$,
  'a deposit already taken on a job that is now cancelled is returned in full through the job refund path'
);

select * from finish();
rollback;
