-- 0088 - Turning a repair request into a job, without re-typing it
-- ---------------------------------------------------------------------------
-- Change request item 2.
--
-- Today staff re-key everything. jobsRouter.post('/') takes an optional
-- bookingId but pulls NOTHING across from it — the link is recorded and the
-- customer's name, phone, email, device and problem are all typed again from
-- a screen the customer already filled in. That is both slow and a source of
-- transcription errors on the one record a repair is tracked by.
--
-- NUMBERING NEEDS NO WORK AND THIS MIGRATION DOES NONE. Bookings and jobs
-- already have fully independent sequences through issue_reference()
-- (0006_repairs.sql:79 documents this as deliberate), so a converted request
-- gets the next ordinary job number and the booking keeps its own reference.
-- The doc's "must maintain separate, independent numbering" is already true.
--
-- Nor does the reverse link need a column: jobs.booking_id already exists and
-- the admin submissions list already derives "which requests are claimed"
-- from it. Showing the job NUMBER on the request is a join, not a new field.
--
-- THE DOC'S OWN OPEN QUESTION, WHICH IS THE ONLY REAL DESIGN HERE
-- ---------------------------------------------------------------------------
-- "Define exactly which fields count as the 1-3 missing details per repair
-- type before building the pop-up — this will vary by request type and should
-- be config-driven, not hardcoded."
--
-- So it is configured per repair type, and the set of things that CAN be
-- asked for is a closed enum rather than free text. A free-text list would
-- let an admin type "pascode" and quietly disable the prompt forever; a
-- closed set means an unknown value fails at the cast, loudly, with the
-- offending value named — the same reasoning 0077 used for
-- replace_staff_permissions' text[] parameter.
--
-- The six values are the things a JOB needs that a BOOKING genuinely cannot
-- supply, which is the actual definition of "missing":
--
--   quote                 the booking snapshots repair_quote_price() at the
--                         time of booking, but the price agreed with the
--                         customer in person is the one the job is worked to
--   passcode              not collected online, and not storable there for
--                         good reason; without it most repairs cannot be
--                         tested afterwards
--   condition_on_arrival  what the device looked like when it was handed
--                         over. The one field that settles "that scratch was
--                         already there" arguments
--   accessories_received  case, charger, SIM tray — what has to go back
--   imei                  for a device the shop will hold
--   data_backed_up        asked and answered before anyone opens it
--
-- Default is {quote} — the doc's own example, and the one that is missing
-- from essentially every request. A shop that wants more asks for more, per
-- repair type, without a deploy.
--
-- WHERE THE ANSWERS GO
-- ---------------------------------------------------------------------------
-- `quote` has a real column (jobs.quoted_price) and goes there. The other
-- five do not, and inventing five columns for a list an admin is expected to
-- change would defeat the point of making it configurable at all — so they
-- land in jobs.intake_details, a jsonb bag keyed by the same enum values.
-- Descriptive intake data that is read on one job and never joined or
-- filtered on, which is exactly the test 0007 applied to sell_requests.
-- condition and reached the same answer.

create type job_conversion_field as enum (
  'quote',
  'passcode',
  'condition_on_arrival',
  'accessories_received',
  'imei',
  'data_backed_up'
);

alter table public.repair_types
  add column conversion_required_fields job_conversion_field[] not null default '{quote}';

comment on column public.repair_types.conversion_required_fields is
  'Change request item 2. Which details staff must supply when turning a repair request of this type into a job — the "1-3 missing details" the pop-up asks for. Per repair type because it genuinely varies: a screen replacement needs a passcode to test afterwards, a battery swap on a device that will not power on cannot have one. A closed enum rather than free text so a typo fails loudly instead of silently disabling the prompt.';

alter table public.jobs add column intake_details jsonb not null default '{}'::jsonb;

comment on column public.jobs.intake_details is
  'Change request item 2. The answers to whatever conversion_required_fields asked for, keyed by the same enum values — passcode, condition on arrival, accessories received, and so on. jsonb rather than five columns because the list is admin-configurable; a column per possible question would make changing the list a deploy. Read on one job, never joined or filtered on — the same test 0007 applied to sell_requests.condition.';

-- ---------------------------------------------------------------------------
-- The conversion itself
-- ---------------------------------------------------------------------------
-- One function so the job, the booking's status and the link either all
-- happen or none of them do. Two separate writes from the API would leave a
-- job created against a booking still sitting in the queue looking unclaimed,
-- which is how the same device gets booked onto the bench twice.

create or replace function public.convert_booking_to_job(
  p_booking_id     uuid,
  p_staff_id       uuid,
  p_quoted_price   pence default null,
  p_intake_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_booking   public.bookings;
  v_repair    public.repair_types;
  v_device    public.devices;
  v_existing  uuid;
  v_job_id    uuid;
  v_required  job_conversion_field[];
  v_field     job_conversion_field;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Repair request % not found', p_booking_id;
  end if;

  -- One booking, one job. Without this, a double-click at the counter makes
  -- two bench tickets for one device and the second one never gets closed.
  select id into v_existing from public.jobs where booking_id = p_booking_id limit 1;
  if v_existing is not null then
    raise exception 'Repair request % is already on the bench', v_booking.reference;
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'Repair request % was cancelled', v_booking.reference;
  end if;

  select * into v_repair from public.repair_types where id = v_booking.repair_type_id;
  select * into v_device from public.devices where id = v_booking.device_id;

  v_required := coalesce(v_repair.conversion_required_fields, '{quote}'::job_conversion_field[]);

  -- Each configured field has to have actually been answered. Checked here
  -- and not only in the dialog, because the dialog is a convenience and this
  -- is the rule.
  foreach v_field in array v_required loop
    if v_field = 'quote' then
      if p_quoted_price is null then
        raise exception 'A quote is required before this request can go on the bench';
      end if;
    else
      if nullif(btrim(coalesce(p_intake_details ->> v_field::text, '')), '') is null then
        raise exception 'Missing required detail: %', replace(v_field::text, '_', ' ');
      end if;
    end if;
  end loop;

  insert into public.jobs (
    source, booking_id, customer_name, phone, email,
    device_description, problem_description, notes,
    quoted_price, repair_type_id, device_id, part_tier,
    intake_details, assigned_staff_id
  )
  values (
    -- A booking IS the mail-in form. jobs_mail_in_has_booking already
    -- requires a booking_id for a mail-in job, which this satisfies by
    -- construction.
    'mail_in',
    v_booking.id,
    v_booking.customer_name,
    v_booking.phone,
    v_booking.email,
    -- Everything the customer already told us, carried across rather than
    -- re-typed. That is the entire request.
    coalesce(v_device.name, 'Device'),
    coalesce(v_repair.name, 'Repair') ||
      case when nullif(btrim(coalesce(v_booking.notes, '')), '') is null
           then ''
           else ' — ' || v_booking.notes end,
    v_booking.notes,
    p_quoted_price,
    v_booking.repair_type_id,
    v_booking.device_id,
    v_booking.tier,
    coalesce(p_intake_details, '{}'::jsonb),
    p_staff_id
  )
  returning id into v_job_id;

  -- The request is now being worked on, so the customer-facing status says
  -- so. Not 'dispatched' and not 'ready' — those are about the device going
  -- back, which has not happened.
  update public.bookings
     set status = 'in_progress'
   where id = p_booking_id
     and status = 'received';

  return v_job_id;
end;
$$;

comment on function public.convert_booking_to_job is
  'Change request item 2. Creates a job from a repair request, carrying every field the customer already gave across, and moves the request to in_progress — in one transaction, so a job can never exist against a request still showing as unclaimed. Refuses a second conversion of the same request (one booking, one job) and refuses to run until every field named in that repair type''s conversion_required_fields has actually been answered. Numbering needs nothing here: bookings and jobs have had independent issue_reference() sequences since 0006.';
