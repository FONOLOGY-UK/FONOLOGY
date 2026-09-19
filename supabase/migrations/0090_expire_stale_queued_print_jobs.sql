-- 0090 — A queued print job that nobody ever claimed does not wait forever
-- ---------------------------------------------------------------------------
-- Found on hosted dev: NINE jobs sitting `queued` since 22 August — four shelf
-- labels, three bench labels, two sale receipts — every one with attempts = 0,
-- so no agent had ever claimed them. Six weeks, and nothing in the system was
-- ever going to touch them.
--
-- TWO PROBLEMS, ONE CAUSE, AND THE SECOND IS THE SERIOUS ONE
--
-- 1. The backlog drains all at once. The agent long-polls and claims the
--    OLDEST queued job first (claim_print_job, 0033), with no age check. A
--    till PC that has been off for a week comes back and prints the lot —
--    including sale receipts for sales that happened days ago, handed to
--    whoever is standing at the counter now. A receipt is the one artefact
--    this whole design treats as dangerous to duplicate; printing a stale one
--    unprompted is the same failure by a different route.
--
-- 2. The PII never ages out. printRetention.ts is explicit that a queued job
--    label carries a customer's name and phone, and that the seven-day window
--    is "a retention obligation, not a disk-space chore". But
--    print_jobs_due_for_deletion() returns TERMINAL rows only, so a queued job
--    is never purged no matter how old. Those nine rows had held customer
--    names and phone numbers for six weeks against a seven-day policy. 0033's
--    own comment flags exactly this hazard for `unconfirmed` and reasons about
--    why it is acceptable there; `queued` was simply not considered.
--
-- WHY MARKING THEM TERMINAL IS THE WHOLE FIX
--
-- Retention ages from created_at, not from whenever a row became terminal
-- (print_jobs_due_for_deletion, 0033). So the moment a stale job is moved to
-- `failed`, the existing purge becomes responsible for it and deletes it on
-- the next pass — honouring print_job_retention_days with no second policy to
-- keep in step. Nothing new decides when PII dies; the existing answer simply
-- starts applying to rows it could never reach before.
--
-- That is also why the staleness windows below must stay SHORTER than
-- print_job_retention_days. If a label could sit queued for ten days under a
-- seven-day retention policy, this migration would have quietly doubled the
-- PII window while appearing to tidy up. A check constraint is not possible
-- across the two columns in any useful way, so the relationship is stated
-- here and the default (3 days vs 7) leaves real headroom.
--
-- THE RECEIPT / LABEL SPLIT, AGAIN
--
-- The same asymmetry expire_print_leases() is built on, for the same reason,
-- applied to a different question. There it was "might this have printed?";
-- here it is "is this still worth printing?".
--
--   RECEIPT → dead once the shop day turns over. It belongs to a customer who
--             was standing at the counter. Nobody wants yesterday's receipt,
--             and shop_day() is exactly the boundary the rest of the till
--             already reckons in — no knob, because there is no sensible
--             other answer.
--
--   LABEL   → still useful later. A bench ticket for a device still on the
--             bench, or a shelf label for stock still on the shelf, is worth
--             printing on Monday for a job queued on Friday. Hence hours, and
--             a default of 72 that survives a normal weekend closure.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not add an age check to claim_print_job(). Two places deciding what
-- is too old is how they drift; the sweep changes `status`, and the claim
-- query already refuses anything that is not `queued`. One rule, one place.

alter table public.shop_settings
  add column if not exists print_job_stale_label_hours integer not null default 72
    check (print_job_stale_label_hours >= 1);

comment on column public.shop_settings.print_job_stale_label_hours is
  'How long a LABEL print job may sit queued before it is given up on and marked failed (0090). Default 72h so a job queued on Friday still prints on Monday. Receipts are not covered by this and need no setting — they expire when the shop day turns over. Keep this comfortably below print_job_retention_days: a stale job only becomes purgeable once it is terminal, so a window longer than the retention period would extend how long customer names and phone numbers are held.';

create or replace function public.expire_stale_print_jobs()
returns integer
language plpgsql
as $$
declare
  v_hours    integer;
  v_receipts integer;
  v_labels   integer;
begin
  select print_job_stale_label_hours into v_hours from public.shop_settings limit 1;
  v_hours := coalesce(v_hours, 72);

  -- Receipts: gone once the shop day has turned over.
  with stale as (
    update public.print_jobs
       set status     = 'failed',
           last_error = coalesce(
             last_error,
             'Never collected by the print agent on the day it was rung up. A receipt is not printed late — reprint it from the sale if one is still wanted.'
           )
     where status = 'queued'
       and target = 'receipt'
       and public.shop_day(created_at) < public.shop_day(now())
    returning 1
  )
  select count(*) into v_receipts from stale;

  -- Labels: given up on after the configured window.
  with stale as (
    update public.print_jobs
       set status     = 'failed',
           last_error = coalesce(
             last_error,
             format('Sat in the queue for more than %s hours without any agent claiming it.', v_hours)
           )
     where status = 'queued'
       and target = 'label'
       and created_at < now() - make_interval(hours => v_hours)
    returning 1
  )
  select count(*) into v_labels from stale;

  return coalesce(v_receipts, 0) + coalesce(v_labels, 0);
end;
$$;

comment on function public.expire_stale_print_jobs is
  'Gives up on print jobs that sat queued with no agent to claim them, so the queue cannot hand a returning agent a backlog of stale work — and, because retention ages from created_at, so their customer PII becomes purgeable at all (0090). Receipts expire when the shop day turns over; labels after shop_settings.print_job_stale_label_hours. Marks them failed rather than deleting: the admin printing screen should show that something never printed, and purgeExpiredPrintJobs() owns the deletion exactly as it does for every other terminal job.';
