-- 040 — a repair request's status follows its job (migration 0101)

begin;
set local search_path to public, tap, extensions;
select plan(5);

insert into public.devices (id, name, brand, price_multiplier)
values ('00000000-0000-0000-0000-000000004010', 'Follow Test Device', 'apple', 1);
insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy)
values ('00000000-0000-0000-0000-000000004011', 'Follow Test Screen', 7000, 5000, 3000);

insert into public.bookings (id, device_id, repair_type_id, tier, customer_name, phone, email, address_line1, postcode, preferred_contact)
values
  ('00000000-0000-0000-0000-000000004021', '00000000-0000-0000-0000-000000004010', '00000000-0000-0000-0000-000000004011', 'oem', 'Follow A', '07700900000', 'follow-a@example.invalid', '1 Test Street', 'G46 7RX', 'email'),
  ('00000000-0000-0000-0000-000000004022', '00000000-0000-0000-0000-000000004010', '00000000-0000-0000-0000-000000004011', 'oem', 'Follow B', '07700900000', 'follow-b@example.invalid', '1 Test Street', 'G46 7RX', 'email'),
  ('00000000-0000-0000-0000-000000004023', '00000000-0000-0000-0000-000000004010', '00000000-0000-0000-0000-000000004011', 'oem', 'Follow C', '07700900000', 'follow-c@example.invalid', '1 Test Street', 'G46 7RX', 'email');

insert into public.jobs (id, source, booking_id, customer_name, device_description, problem_description)
values
  ('00000000-0000-0000-0000-000000004031', 'mail_in', '00000000-0000-0000-0000-000000004021', 'Follow A', 'Follow Test Device', 'Screen'),
  ('00000000-0000-0000-0000-000000004032', 'mail_in', '00000000-0000-0000-0000-000000004022', 'Follow B', 'Follow Test Device', 'Screen'),
  ('00000000-0000-0000-0000-000000004033', 'mail_in', '00000000-0000-0000-0000-000000004023', 'Follow C', 'Follow Test Device', 'Screen');

update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000004031';
select is((select status from public.bookings where id = '00000000-0000-0000-0000-000000004021'),
          'in_progress'::booking_status, 'a job on the bench shows its request as in progress');

update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-000000004031';
select is((select status from public.bookings where id = '00000000-0000-0000-0000-000000004021'),
          'ready'::booking_status, 'a finished job shows its request as ready');

update public.jobs set status = 'cancelled', cancellation_reason = 'customer declined', device_returned = false
 where id = '00000000-0000-0000-0000-000000004032';
select is((select status from public.bookings where id = '00000000-0000-0000-0000-000000004022'),
          'cancelled'::booking_status, 'a cancelled job cancels its request — it used to stay "in progress"');

-- A request already cancelled is never moved again by its job.
update public.bookings set status = 'cancelled' where id = '00000000-0000-0000-0000-000000004023';
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000004033';
select is((select status from public.bookings where id = '00000000-0000-0000-0000-000000004023'),
          'cancelled'::booking_status, 'a cancelled request is not brought back to life');

-- A job with no request (a walk-in) is unaffected and does not error.
insert into public.jobs (id, source, customer_name, device_description, problem_description)
values ('00000000-0000-0000-0000-000000004034', 'walk_in', 'Walk In', 'Follow Test Device', 'Screen');
select lives_ok(
  $$ update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-000000004034' $$,
  'a walk-in job (no booking) moves as before');

select * from finish();
rollback;
