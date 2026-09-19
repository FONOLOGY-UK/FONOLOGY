-- 0079 - Staff cannot quote below the admin-defined price for a repair
-- ---------------------------------------------------------------------------
-- Change request item 6.
--
-- The admin half already existed and was complete: `repair_types` carries
-- three base prices (one per part tier), `devices` carries a multiplier, and
-- repair_quote_price() combines them. /admin/repair-pricing is full CRUD over
-- it. The gap was entirely on the staff side — "Quote (£, blank = on
-- diagnosis)" on the Add Job screen was a free-text number with no connection
-- to any of it. Nothing looked up the shop's own price and nothing stopped a
-- £110 screen going out at £40.
--
-- WHY THREE COLUMNS AND NOT ONE
--
-- The obvious shortcut is to have the client send the floor it saw. That is
-- the one thing this codebase's standing rules forbid outright: the server
-- computes every money figure, and a floor supplied by the caller is a floor
-- the caller can lower. So the job records WHICH repair was picked — type,
-- device, tier — and the server recomputes the floor from the same
-- repair_quote_price() the admin screen prices with. There is no number in
-- the request body for anyone to tamper with.
--
-- The three columns pay for themselves twice over besides: "how many iPhone 11
-- screens did we do last month" has never been answerable, because a job's
-- repair has only ever existed as free text in `problem_description`.
--
-- ALL THREE NULLABLE, AND THAT IS NOT A LOOPHOLE
--
-- A job does not have to come from the catalogue. A device that isn't listed,
-- an odd repair nobody has priced, a goodwill fix — all real, all still
-- free-text jobs with no floor to check against, exactly as today. The floor
-- binds when a staff member has PICKED a priced repair; it cannot be escaped
-- by picking one and then editing the number down, which is the case that
-- actually matters.
--
-- WHAT THE FLOOR APPLIES TO
--
--   quoted_price   the number set when the job is created
--   revised_quote  the number set when a job goes to waiting_approval
--
-- Both, deliberately. A floor on creation alone is bypassed in two clicks:
-- create at the floor, then "revise" to £5. A revision is normally a cost
-- OVERRUN going up, so this rarely bites — but the one time it does is
-- precisely the case worth catching.
--
-- NULL IS STILL ALLOWED. "Blank = on diagnosis" is that field's own
-- documented state, and it survives picking a repair type: staff often look
-- up the price, then find the phone has water damage too and decide to quote
-- after opening it. A job with no quote is not a job quoted below the floor.

alter table public.jobs add column repair_type_id uuid references public.repair_types (id);
alter table public.jobs add column device_id      uuid references public.devices (id);
alter table public.jobs add column part_tier      part_tier;

comment on column public.jobs.repair_type_id is
  'Change request item 6. Which catalogue repair this job is, when it came from the catalogue. Nullable: a free-text job has none. With device_id and part_tier it is what repair_quote_price() needs to recompute the floor server-side, so no floor is ever taken from the request body.';

create index jobs_repair_type_idx on public.jobs (repair_type_id) where repair_type_id is not null;
create index jobs_device_idx      on public.jobs (device_id)      where device_id is not null;

-- The three travel together or not at all. Two of three cannot price
-- anything, and a half-filled selection would silently mean "no floor".
alter table public.jobs add constraint jobs_repair_selection_complete check (
  (repair_type_id is null and device_id is null and part_tier is null)
  or (repair_type_id is not null and device_id is not null and part_tier is not null)
);

create or replace function public.job_quote_floor(p_job public.jobs)
returns pence
language sql
stable
as $$
  select case
    when p_job.repair_type_id is null or p_job.device_id is null or p_job.part_tier is null
      then null
    else public.repair_quote_price(p_job.repair_type_id, p_job.device_id, p_job.part_tier)
  end;
$$;

comment on function public.job_quote_floor is
  'The admin-defined price for whatever repair a job was booked as, or null when the job is free-text or the repair type is diagnosis-only (all three base prices null, so repair_quote_price returns null). Change request item 6.';

create or replace function public.validate_job_quote_floor()
returns trigger
language plpgsql
as $$
declare
  v_floor pence;
begin
  v_floor := public.job_quote_floor(new);

  -- No catalogue selection, or a diagnosis-only repair type that has no price
  -- at any tier: nothing to be below.
  if v_floor is null then
    return new;
  end if;

  if new.quoted_price is not null and new.quoted_price < v_floor then
    raise exception
      'That quote is below the shop price for this repair (£%). Staff can quote more, never less.',
      trim(to_char(v_floor / 100.0, 'FM9999990.00'))
      using errcode = 'check_violation';
  end if;

  if new.revised_quote is not null and new.revised_quote < v_floor then
    raise exception
      'That revised quote is below the shop price for this repair (£%). Staff can quote more, never less.',
      trim(to_char(v_floor / 100.0, 'FM9999990.00'))
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.validate_job_quote_floor is
  'Change request item 6. Refuses a quoted_price or revised_quote below repair_quote_price() for the job''s own repair type / device / tier. Null quote is allowed — "blank = on diagnosis" is a real state, and a job with no quote is not a job quoted too low.';

create trigger jobs_validate_quote_floor
  before insert or update on public.jobs
  for each row execute function public.validate_job_quote_floor();
