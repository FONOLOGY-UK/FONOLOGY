-- 029 — A job with money still owed cannot be handed back
-- Change request item 14 / migration 0078.
--
-- The bug this locks down was reproduced on dev as FNL-10602: quoted 12000p,
-- one 2000p deposit, moved done -> collected and accepted, with 10000p still
-- outstanding and nothing anywhere to say so.
--
-- The four cases below are the whole contract. Two of them are the exemptions,
-- and they matter as much as the refusals — a guard that also blocks handing
-- back a device the shop never charged for, or a device from a repair that was
-- called off, is a worse bug than the one it fixes.

begin;
set local search_path to public, tap, extensions;
select plan(8);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000901', 'test-staff-029@example.invalid');
insert into public.staff (id, email, name, role)
values ('00000000-0000-0000-0000-000000000901', 'test-staff-029@example.invalid', 'Test Handover', 'owner');

-- ---------------------------------------------------------------------------
-- 1. Quoted, part-paid walk-in: collected is refused, then allowed once clear
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000910', 'walk_in', 'Part Paid Customer', 'Test Phone', 'Cracked screen', 12000);

do $$ begin perform public.record_job_payment('00000000-0000-0000-0000-000000000910', 'deposit', 2000, 'cash', '00000000-0000-0000-0000-000000000901'); end $$;

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000910';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000910';

select throws_ok(
  $$ update public.jobs set status = 'collected' where id = '00000000-0000-0000-0000-000000000910' $$,
  null, null,
  'a job quoted 12000p with only 2000p taken cannot be marked collected'
);

select is(
  (select status::text from public.jobs where id = '00000000-0000-0000-0000-000000000910'),
  'done',
  'the refused move left the job where it was'
);

do $$ begin perform public.record_job_payment('00000000-0000-0000-0000-000000000910', 'balance', 10000, 'cash', '00000000-0000-0000-0000-000000000901'); end $$;

select lives_ok(
  $$ update public.jobs set status = 'collected' where id = '00000000-0000-0000-0000-000000000910' $$,
  'the same job can be collected once the balance is taken'
);

-- ---------------------------------------------------------------------------
-- 2. Never quoted ("blank = on diagnosis"): nothing to check, nothing refused
-- ---------------------------------------------------------------------------

insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000000911', 'walk_in', 'No Quote Customer', 'Test Phone', 'Would not charge');

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000911';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000911';

select lives_ok(
  $$ update public.jobs set status = 'collected' where id = '00000000-0000-0000-0000-000000000911' $$,
  'a job that was never quoted can be collected — there is no figure to owe'
);

-- ---------------------------------------------------------------------------
-- 3. Quoted, unpaid mail-in: sent_back is refused too, not only collected
-- ---------------------------------------------------------------------------

insert into public.bookings (id, device_id, repair_type_id, tier, customer_name, phone, email, address_line1, postcode, preferred_contact)
select '00000000-0000-0000-0000-000000000912', d.id, r.id, 'original', 'Unpaid Mail-in', '07700900000', 'unpaid-mailin-029@example.invalid', '1 Test Street', 'SW1A 1AA', 'email'
from (select id from public.devices limit 1) d, (select id from public.repair_types limit 1) r;

insert into public.jobs (id, source, booking_id, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000913', 'mail_in', '00000000-0000-0000-0000-000000000912', 'Unpaid Mail-in', 'Test Phone', 'Cracked screen', 12000);

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000913';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000913';

select throws_ok(
  $$ update public.jobs set status = 'sent_back', return_tracking_number = 'TRK029', courier = 'Royal Mail' where id = '00000000-0000-0000-0000-000000000913' $$,
  null, null,
  'an unpaid mail-in job cannot be posted back either'
);

-- ---------------------------------------------------------------------------
-- 4. Cancelled mail-in with an unpaid quote: posting it back is still allowed
-- ---------------------------------------------------------------------------
-- The repair never happened, so there is nothing to collect. Any deposit
-- already taken goes back through create_refund(p_job_id => ...), which this
-- guard deliberately does not touch (0051's own comment makes the same point).

insert into public.bookings (id, device_id, repair_type_id, tier, customer_name, phone, email, address_line1, postcode, preferred_contact)
select '00000000-0000-0000-0000-000000000914', d.id, r.id, 'original', 'Cancelled Mail-in', '07700900000', 'cancelled-mailin-029@example.invalid', '1 Test Street', 'SW1A 1AA', 'email'
from (select id from public.devices limit 1) d, (select id from public.repair_types limit 1) r;

insert into public.jobs (id, source, booking_id, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000915', 'mail_in', '00000000-0000-0000-0000-000000000914', 'Cancelled Mail-in', 'Test Phone', 'Cracked screen', 12000);

update public.jobs
set status = 'cancelled', cancellation_reason = 'Customer changed their mind', device_returned = false
where id = '00000000-0000-0000-0000-000000000915';

select lives_ok(
  $$ update public.jobs set status = 'sent_back', return_tracking_number = 'TRK029C', courier = 'Royal Mail' where id = '00000000-0000-0000-0000-000000000915' $$,
  'a CANCELLED mail-in with an unpaid quote can still be posted back — nothing is owed for a repair that did not happen'
);

-- ---------------------------------------------------------------------------
-- 5. A no-op update to an already-collected job must not start failing
-- ---------------------------------------------------------------------------
-- 000910 is collected and fully paid by now; re-writing the same status is the
-- shape CancelledStrip's "flip one column" updates use, and it must stay free.

select lives_ok(
  $$ update public.jobs set status = 'collected' where id = '00000000-0000-0000-0000-000000000910' $$,
  'rewriting the same status on a collected job is not treated as a fresh handover'
);

-- ---------------------------------------------------------------------------
-- 6. The guard agrees with getJobOutstanding()'s arithmetic, not deposit_amount
-- ---------------------------------------------------------------------------
-- revised_quote wins over quoted_price, exactly as lib/jobPayments.ts computes
-- it. A job revised UP after a deposit was taken owes the difference.

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000916', 'walk_in', 'Revised Up Customer', 'Test Phone', 'Cracked screen', 5000);

do $$ begin perform public.record_job_payment('00000000-0000-0000-0000-000000000916', 'deposit', 5000, 'cash', '00000000-0000-0000-0000-000000000901'); end $$;

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000000916';
update public.jobs set status = 'waiting_approval', revised_quote = 9000 where id = '00000000-0000-0000-0000-000000000916';
update public.jobs
set status = 'in_progress',
    revised_quote_approved_by = '00000000-0000-0000-0000-000000000901',
    revised_quote_approved_at = now()
where id = '00000000-0000-0000-0000-000000000916';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000000916';

select throws_ok(
  $$ update public.jobs set status = 'collected' where id = '00000000-0000-0000-0000-000000000916' $$,
  null, null,
  'the revised quote (9000p) is what is owed against, not the original 5000p that was fully paid'
);

select * from finish();
rollback;
