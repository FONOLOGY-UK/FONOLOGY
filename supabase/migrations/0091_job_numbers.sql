-- 0091 — Jobs get their own number sequence: JOB-1001, JOB-1002, ...
--
-- Change request item 2: "Requests and Jobs must maintain separate,
-- independent numbering sequences. When a request is moved to Jobs, it must
-- be assigned the next standard Job Number, keeping that sequence intact."
--
-- They didn't. 0001 gave EVERY reference one shared sequence (reference_seq),
-- and 0088 said numbering "needs no work" on the belief that bookings and jobs
-- already had independent sequences. They never did: found in live QA on
-- staging, 26 Sept — sale FNL-10689, job FNL-10690, repair request FNL-10691,
-- job FNL-10692. A job's number depended on how many sales, orders and
-- requests happened to land in between.
--
-- Now jobs draw from job_reference_seq with the JOB- prefix, and everything
-- else is untouched (FNL- orders, requests, sell requests, sales; BUY- payouts;
-- REF- refunds all still come from reference_seq). Client decision, 26 Sept:
-- "JOB-" numbers.
--
-- Still one registry. The number is minted here, but the row still lands in
-- reference_registry, so a JOB- reference is as unique, as trackable and as
-- self-describing as any other — the reason 0001 centralised references in
-- the first place still holds. Only the counter is separate.
--
-- Existing jobs keep their FNL- numbers. They are printed on labels already on
-- the shelf and quoted to customers; renumbering them would break both.

create sequence public.job_reference_seq start with 1001 increment by 1;

comment on sequence public.job_reference_seq is
  'Job numbers only (JOB-nnnn), independent of reference_seq — change request item 2, 0091.';

create or replace function public.issue_job_reference(p_job_id uuid)
returns text
language plpgsql
as $$
declare
  v_reference text;
begin
  v_reference := 'JOB-' || nextval('public.job_reference_seq')::text;

  insert into public.reference_registry (reference, entity_type, entity_id)
  values (v_reference, 'job', p_job_id);

  return v_reference;
end;
$$;

comment on function public.issue_job_reference is
  'Issues the next JOB- number from job_reference_seq and records it in reference_registry. The only way a job reference is created (0091).';

create or replace function public.jobs_set_reference()
returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_job_reference(new.id);
  return new;
end;
$$;

-- 0088's comment claimed the sequences were already independent; correct it
-- where people will read it.
comment on function public.convert_booking_to_job is
  'Change request item 2. Creates a job from a repair request, carrying every field the customer already gave across, and moves the request to in_progress — in one transaction, so a job can never exist against a request still showing as unclaimed. Refuses a second conversion of the same request (one booking, one job) and refuses to run until every field named in that repair type''s conversion_required_fields has actually been answered. The job gets the next JOB- number from its own sequence (0091); the request keeps its FNL- reference.';
