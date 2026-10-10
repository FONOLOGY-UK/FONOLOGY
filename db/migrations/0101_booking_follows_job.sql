-- 0101 — a repair request's status follows its job
--
-- convert_booking_to_job() (0088, re-created shop-aware in 0097) moves a booking
-- from 'received' to 'in_progress' when it goes on the bench, and nothing ever
-- touched it again. So a request whose job was cancelled — deposit refunded,
-- device posted back — still read "In progress" on Repair Requests and in the
-- customer's own account, indefinitely.
--
-- Every job status move is a single UPDATE of jobs.status (jobs.routes.ts;
-- validate_job_status_transition is the guard), so one AFTER trigger keeps the
-- linked booking in step with all of them. Mapping onto booking_status:
--
--   new / in_progress / waiting_approval  -> in_progress   (on the bench)
--   done                                  -> ready         (fixed, not yet back)
--   sent_back / collected                 -> dispatched    (device returned)
--   cancelled                             -> cancelled
--
-- A cancelled booking stays cancelled: posting back the device of a called-off
-- repair (cancelled -> sent_back, which 0081 allows) is the device going home,
-- not the request coming back to life.

create or replace function public.jobs_sync_booking_status()
returns trigger
language plpgsql
as $$
declare
  v_target booking_status;
begin
  if new.booking_id is null or new.status is not distinct from old.status then
    return null;
  end if;

  v_target := case new.status
    when 'done'      then 'ready'::booking_status
    when 'sent_back' then 'dispatched'::booking_status
    when 'collected' then 'dispatched'::booking_status
    when 'cancelled' then 'cancelled'::booking_status
    else 'in_progress'::booking_status
  end;

  update public.bookings
     set status = v_target
   where id = new.booking_id
     and status <> v_target
     and status <> 'cancelled';

  return null;
end;
$$;

comment on function public.jobs_sync_booking_status is
  'AFTER UPDATE OF status ON jobs: carries a job''s status onto the booking it was converted from (0101). A cancelled booking is never moved again.';

create trigger jobs_sync_booking_status
  after update of status on public.jobs
  for each row execute function public.jobs_sync_booking_status();

-- Requests already left behind by jobs that moved on before this trigger existed.
update public.bookings b
   set status = case j.status
     when 'done'      then 'ready'::booking_status
     when 'sent_back' then 'dispatched'::booking_status
     when 'collected' then 'dispatched'::booking_status
     when 'cancelled' then 'cancelled'::booking_status
     else 'in_progress'::booking_status
   end
  from public.jobs j
 where j.booking_id = b.id
   and b.status <> 'cancelled'
   and b.status is distinct from case j.status
     when 'done'      then 'ready'::booking_status
     when 'sent_back' then 'dispatched'::booking_status
     when 'collected' then 'dispatched'::booking_status
     when 'cancelled' then 'cancelled'::booking_status
     else 'in_progress'::booking_status
   end;
