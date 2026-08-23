-- BUG-15-followup #10: a mail-in job no longer has to link to a booking.
--
-- `jobs_mail_in_has_booking` (0006_repairs.sql) was correct for the one case
-- it was written for — a mail-in job created from a booking the customer
-- submitted through the website's /repair flow — but it made it impossible
-- to log a device that physically arrives by post with no prior booking at
-- all (dropped at a courier depot, sent on spec, a booking taken by phone).
-- `booking_id` stays nullable either way; this only removes the requirement
-- that a mail-in job's `booking_id` be filled in.
--
-- Frozen the moment this is pushed, per this file's own README — a mistake
-- found later is a new migration, not an edit to this one.

alter table public.jobs
  drop constraint jobs_mail_in_has_booking;
