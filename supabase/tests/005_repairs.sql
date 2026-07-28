-- 005 — Repairs
-- Catalogue pricing, the "my model isn't listed" enquiry path, and the job
-- status machine including the cost-overrun (waiting_approval) branch.

begin;
set local search_path to public, tap, extensions;
select plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000501', 'test-staff-005@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000000501', 'test-staff-005@example.invalid', 'Test Approver', 'owner');

insert into public.devices (id, name, brand, price_multiplier)
values ('00000000-0000-0000-0000-000000000510', 'Repair Test Device', 'apple', 1.15);

insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy)
values ('00000000-0000-0000-0000-000000000511', 'Repair Test Screen', 7200, 5600, 4200);

insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy)
values ('00000000-0000-0000-0000-000000000512', 'Repair Test Diagnosis Only', null, null, null);

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000000513', 'repair-test-part', 'Repair Test Part', 'cases', 3000, 1000, 20);

-- ---------------------------------------------------------------------------
-- Pricing: base x multiplier, rounded to whole pounds
-- ---------------------------------------------------------------------------
-- 72.00 x 1.15 = 82.80 -> rounds to 83.00 -> 8300p. Deliberately not a clean
-- multiple, so the rounding step is actually exercised, not sidestepped.

select is(
  public.repair_quote_price('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000510', 'original')::integer,
  8300,
  '72.00 base x 1.15 multiplier rounds to 83.00 (8300p), not left as a fraction of a penny or truncated to 82.00'
);

-- ---------------------------------------------------------------------------
-- Diagnosis-only repair types never produce a quote
-- ---------------------------------------------------------------------------

select ok(
  public.repair_quote_price('00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-000000000510', 'original') is null,
  'a diagnosis-only repair type (no base price at any tier) returns null, not 0 and not an error'
);

-- ---------------------------------------------------------------------------
-- "My model isn't listed" — an enquiry, not a fake device row
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
  insert into public.repair_enquiries (customer_name, device_description, fault_description)
  values ('Enquiry Test Customer', 'Nokia 3310, cracked case', 'Screen is fine, case is falling apart')
  $$,
  'an enquiry for an unlisted model is valid with no device reference at all'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'repair_enquiries' and column_name = 'device_id'
  ),
  'repair_enquiries genuinely has no device_id column to leave null — there is no fake device row to point at'
);

-- ---------------------------------------------------------------------------
-- Job status machine
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000000520', 'walk_in', 'Walk-in Test Customer', 'Test Phone', 'Test fault');

select throws_ok(
  $$ update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000520' $$,
  null, null, 'new -> done directly (skipping in_progress) is not a legal transition'
);
select throws_ok(
  $$ update public.jobs set status = 'waiting_approval', revised_quote = 5000 where id = '00000000-0000-0000-0000-000000000520' $$,
  null, null, 'new -> waiting_approval directly is not a legal transition either'
);

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000520';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000520';
select throws_ok(
  $$ update public.jobs set status = 'new' where id = '00000000-0000-0000-0000-000000000520' $$,
  null, null, 'done -> new is not a legal transition (no going backward past in_progress)'
);

-- A walk-in job cannot be sent back — only collected.
select throws_ok(
  $$ update public.jobs set status = 'sent_back', return_tracking_number = 'TRK123' where id = '00000000-0000-0000-0000-000000000520' $$,
  null, null, 'a walk-in job cannot end at sent_back'
);
select lives_ok(
  $$ update public.jobs set status = 'collected' where id = '00000000-0000-0000-0000-000000000520' $$,
  'a walk-in job can end at collected'
);

-- A mail-in job cannot be collected — only sent back, and needs a tracking number.
insert into public.bookings (id, device_id, repair_type_id, tier, customer_name, phone, email, address_line1, postcode, preferred_contact)
values ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000510', '00000000-0000-0000-0000-000000000511', 'original', 'Mail-in Test Customer', '07700900000', 'mailin-test@example.invalid', '1 Test Street', 'SW1A 1AA', 'email');

insert into public.jobs (id, source, booking_id, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000000522', 'mail_in', '00000000-0000-0000-0000-000000000521', 'Mail-in Test Customer', 'Test Phone', 'Test fault');

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000522';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000522';

select throws_ok(
  $$ update public.jobs set status = 'collected' where id = '00000000-0000-0000-0000-000000000522' $$,
  null, null, 'a mail-in job cannot end at collected'
);
select throws_ok(
  $$ update public.jobs set status = 'sent_back' where id = '00000000-0000-0000-0000-000000000522' $$,
  null, null, 'a mail-in job cannot reach sent_back with no return tracking number'
);
select lives_ok(
  $$ update public.jobs set status = 'sent_back', return_tracking_number = 'TRK456' where id = '00000000-0000-0000-0000-000000000522' $$,
  'a mail-in job reaches sent_back once it has a tracking number'
);

-- ---------------------------------------------------------------------------
-- waiting_approval: revised quote, approver and time
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000523', 'walk_in', 'Overrun Test Customer', 'Test Phone', 'Test fault', 5000);
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000523';

select throws_ok(
  $$ update public.jobs set status = 'waiting_approval' where id = '00000000-0000-0000-0000-000000000523' $$,
  null, null, 'entering waiting_approval with no revised quote is refused'
);
select lives_ok(
  $$ update public.jobs set status = 'waiting_approval', revised_quote = 7500 where id = '00000000-0000-0000-0000-000000000523' $$,
  'entering waiting_approval with a revised quote succeeds'
);
select throws_ok(
  $$ update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000523' $$,
  null, null, 'leaving waiting_approval with no record of who approved it (or when) is refused'
);
select lives_ok(
  $$
  update public.jobs
     set status = 'in_progress',
         revised_quote_approved_by = '00000000-0000-0000-0000-000000000501',
         revised_quote_approved_at = now()
   where id = '00000000-0000-0000-0000-000000000523'
  $$,
  'leaving waiting_approval succeeds once who-approved-it and when are both recorded'
);

-- ---------------------------------------------------------------------------
-- Deposits cannot exceed the job's price
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000524', 'walk_in', 'Deposit Test Customer', 'Test Phone', 'Test fault', 5000);

select throws_ok(
  $$ update public.jobs set deposit_amount = 6000 where id = '00000000-0000-0000-0000-000000000524' $$,
  null, null, 'a deposit greater than the quoted price is refused'
);
select lives_ok(
  $$ update public.jobs set deposit_amount = 2000, payment_status = 'deposit_paid' where id = '00000000-0000-0000-0000-000000000524' $$,
  'a deposit within the quoted price succeeds'
);

select throws_ok(
  $$ update public.jobs set payment_status = 'deposit_paid', deposit_amount = 0 where id = '00000000-0000-0000-0000-000000000524' $$,
  null, null, 'payment_status = deposit_paid with a zero deposit is a contradiction and is refused'
);

-- record_job_payment(), the realistic path, respects the same cap.
insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000525', 'walk_in', 'Overpay Test Customer', 'Test Phone', 'Test fault', 3000);
select throws_ok(
  $$ select public.record_job_payment('00000000-0000-0000-0000-000000000525', 'deposit', 4000, 'cash') $$,
  null, null, 'record_job_payment() refuses a deposit larger than the job price too, not just a raw UPDATE'
);

-- record_job_payment() actually succeeding at all was never previously
-- proven — the only existing test of it (above) expected an exception, so a
-- real bug (payment_status = CASE ... 'paid'/'deposit_paid'/'unpaid' ... END
-- with no branch cast to job_payment_status, which Postgres resolves to
-- text and then can't assign to an enum column) still showed a passing
-- throws_ok, for entirely the wrong reason: the function had never once
-- actually completed successfully, for any input. Fixed in 0006; this is
-- the success path that fix makes possible for the first time.
insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000527', 'walk_in', 'Real Payment Customer', 'Test Phone', 'Test fault', 5000);
select lives_ok(
  $$ select public.record_job_payment('00000000-0000-0000-0000-000000000527', 'deposit', 2000, 'cash') $$,
  'record_job_payment() for a deposit within the job price actually succeeds'
);
select is(
  (select payment_status from public.jobs where id = '00000000-0000-0000-0000-000000000527')::text,
  'deposit_paid',
  'a 2000p deposit against a 5000p job moves payment_status to deposit_paid'
);
select is(
  (select deposit_amount from public.jobs where id = '00000000-0000-0000-0000-000000000527')::integer,
  2000,
  'deposit_amount tracks the 2000p actually paid so far'
);

-- The second bug in the same statement: every SET expression in one UPDATE
-- reads the OLD row, so "set deposit_amount = case when payment_status <>
-- 'paid' then ... end" was reading payment_status as it was BEFORE this
-- call, not the value the sibling SET clause just computed — meaning the
-- payment that actually completes a job overwrote deposit_amount to the
-- FULL price paid, not the deposit portion. Proven by finishing the job
-- above with a second payment and checking deposit_amount stayed at 2000,
-- not jumping to 5000.
select lives_ok(
  $$ select public.record_job_payment('00000000-0000-0000-0000-000000000527', 'balance', 3000, 'pos1') $$,
  'a second payment that brings the job to its full price succeeds'
);
select is(
  (select payment_status from public.jobs where id = '00000000-0000-0000-0000-000000000527')::text,
  'paid',
  'the job reaches paid once the cumulative total (2000 + 3000) meets the quoted price'
);
select is(
  (select deposit_amount from public.jobs where id = '00000000-0000-0000-0000-000000000527')::integer,
  2000,
  'deposit_amount stays at the 2000p deposit actually taken, not overwritten to the full 5000p once the job is paid'
);

-- ---------------------------------------------------------------------------
-- A job part's cost is a snapshot, not a live join
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000000526', 'walk_in', 'Snapshot Test Customer', 'Test Phone', 'Test fault');

do $$ begin perform public.add_job_part('00000000-0000-0000-0000-000000000526', '00000000-0000-0000-0000-000000000513', 1, null); end $$;

update public.products set cost_price = 9999 where id = '00000000-0000-0000-0000-000000000513';

select is(
  (select unit_cost from public.job_parts where job_id = '00000000-0000-0000-0000-000000000526')::integer,
  1000,
  'the job part kept the cost as it was when fitted (1000p), unaffected by the product''s cost_price changing afterward'
);

select * from finish();
rollback;
