-- 0109 — Repair pricing per device (tester hand-off doc, 8 Oct 2026, change C-3)
--
-- The old model priced a repair as base price (per repair type, per part tier) × a multiplier
-- (per device). It is replaced by prices typed in by hand, per device:
--
--   * Repair types are DEFINITIONS only — name, description, time estimate, which sub-types the
--     repair comes in, and a "Diagnosis only" flag. No price anywhere on them.
--   * Sub-types (was: the fixed Original / OEM / Copy part tiers) are an admin-managed list —
--     those three by default, custom ones added, edited, and deleted. Deleting is a soft delete
--     (removed_at): past jobs and requests keep pointing at it and still read right.
--   * device_repair_prices holds ONE price per device, per repair, per sub-type — or, for a
--     Diagnosis-only repair, one flat price per device (sub_type_id null). NO ROW = NOT OFFERED for
--     that device. A price of 0 is a real, deliberate free repair.
--   * The multiplier is gone.
--
-- Existing jobs and requests keep their recorded prices untouched (quoted_price is never
-- rewritten). They gain sub_type_id, filled from their old part tier, so they still name it.
--
-- So the shop is not left with nothing offered, each device starts with the prices the old
-- formula gave it today (round(base / 100 × multiplier) × 100, the same rounding as
-- repair_quote_price), and every Diagnosis-only repair at £0 on every device — what the site
-- quoted for them until now.

-- ---------------------------------------------------------------------------
-- Sub-types
-- ---------------------------------------------------------------------------

create table public.repair_sub_types (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (btrim(name) <> '' and length(name) <= 60),
  strap_line     text,
  warranty_label text not null default '',
  sort_order     integer not null default 0,
  -- The part tier this replaces, for the three that came from repair_part_tiers.
  legacy_tier    part_tier unique,
  removed_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index repair_sub_types_live_name_idx
  on public.repair_sub_types (lower(name)) where removed_at is null;
comment on table public.repair_sub_types is
  'Grades a repair comes in (Original, OEM, Copy, custom ones) — 0109. Deleting sets removed_at; past jobs keep the row.';

insert into public.repair_sub_types (name, strap_line, warranty_label, sort_order, legacy_tier)
select name, strap_line, warranty_label, sort_order, id
  from public.repair_part_tiers;

-- ---------------------------------------------------------------------------
-- Repair types: definitions only
-- ---------------------------------------------------------------------------

alter table public.repair_types add column diagnosis_only boolean not null default false;
update public.repair_types set diagnosis_only = (base_price_original is null);
comment on column public.repair_types.diagnosis_only is
  'A repair quoted only after inspection (0109): no sub-types, one flat price per device.';

create table public.repair_type_sub_types (
  repair_type_id uuid not null references public.repair_types (id) on delete cascade,
  sub_type_id    uuid not null references public.repair_sub_types (id),
  primary key (repair_type_id, sub_type_id)
);
create index repair_type_sub_types_sub_idx on public.repair_type_sub_types (sub_type_id);
comment on table public.repair_type_sub_types is
  'Which sub-types a repair type comes in (0109). A Diagnosis-only repair has none.';

insert into public.repair_type_sub_types (repair_type_id, sub_type_id)
select rt.id, st.id
  from public.repair_types rt cross join public.repair_sub_types st
 where not rt.diagnosis_only;

-- A Diagnosis-only repair never has sub-types (spec C-3.2).
create function public.repair_type_sub_types_not_diagnosis() returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.repair_types where id = new.repair_type_id and diagnosis_only) then
    raise exception 'A diagnosis-only repair has no sub-types';
  end if;
  return new;
end
$$;
create trigger repair_type_sub_types_not_diagnosis
  before insert or update on public.repair_type_sub_types
  for each row execute function public.repair_type_sub_types_not_diagnosis();

-- ---------------------------------------------------------------------------
-- Prices, per device
-- ---------------------------------------------------------------------------

create table public.device_repair_prices (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references public.devices (id) on delete cascade,
  repair_type_id uuid not null references public.repair_types (id) on delete cascade,
  -- Null only for a Diagnosis-only repair's flat price.
  sub_type_id    uuid references public.repair_sub_types (id),
  price          pence not null check (price >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index device_repair_prices_sub_idx
  on public.device_repair_prices (device_id, repair_type_id, sub_type_id)
  where sub_type_id is not null;
create unique index device_repair_prices_flat_idx
  on public.device_repair_prices (device_id, repair_type_id)
  where sub_type_id is null;
create index device_repair_prices_repair_idx on public.device_repair_prices (repair_type_id);
create index device_repair_prices_sub_type_idx on public.device_repair_prices (sub_type_id);
create trigger device_repair_prices_updated_at
  before update on public.device_repair_prices
  for each row execute function public.set_updated_at();
comment on table public.device_repair_prices is
  'What a repair costs on one device (0109): per sub-type, or one flat price for a Diagnosis-only repair. No row = not offered for that device. 0 = free.';

-- Today's prices carried across, so nothing the site quotes today disappears.
insert into public.device_repair_prices (device_id, repair_type_id, sub_type_id, price)
select d.id, rt.id, st.id,
       (round(
          (case st.legacy_tier
             when 'original' then rt.base_price_original
             when 'oem'      then rt.base_price_oem
             when 'copy'     then rt.base_price_copy
           end)::numeric / 100.0 * d.price_multiplier
        ) * 100)::integer
  from public.devices d
  cross join public.repair_types rt
  join public.repair_sub_types st on st.legacy_tier is not null
 where not rt.diagnosis_only;

insert into public.device_repair_prices (device_id, repair_type_id, sub_type_id, price)
select d.id, rt.id, null, 0
  from public.devices d
  cross join public.repair_types rt
 where rt.diagnosis_only;

-- ---------------------------------------------------------------------------
-- Jobs and repair requests name the sub-type
-- ---------------------------------------------------------------------------

alter table public.jobs add column sub_type_id uuid references public.repair_sub_types (id);
alter table public.bookings add column sub_type_id uuid references public.repair_sub_types (id);
create index jobs_sub_type_idx on public.jobs (sub_type_id) where sub_type_id is not null;
create index bookings_sub_type_idx on public.bookings (sub_type_id) where sub_type_id is not null;

update public.jobs j set sub_type_id = st.id
  from public.repair_sub_types st where st.legacy_tier = j.part_tier;
update public.bookings b set sub_type_id = st.id
  from public.repair_sub_types st where st.legacy_tier = b.tier;

-- A job's catalogue repair: a repair type AND a device, or neither; a sub-type only with both.
-- (0082 required a part tier too — which a Diagnosis-only repair never has.)
alter table public.jobs drop constraint jobs_repair_selection_complete;
alter table public.jobs add constraint jobs_repair_selection_complete check (
  ((repair_type_id is null) = (device_id is null))
  and (sub_type_id is null or repair_type_id is not null)
);

-- ---------------------------------------------------------------------------
-- The price, the floor, the conversion
-- ---------------------------------------------------------------------------

-- The shop's price for one repair on one device: the sub-type's price, or the flat price of a
-- Diagnosis-only repair (p_sub_type_id null). NULL = not offered for that device.
create function public.repair_price(p_device_id uuid, p_repair_type_id uuid, p_sub_type_id uuid)
returns pence
language sql
stable
as $$
  select p.price
    from public.device_repair_prices p
    join public.repair_types rt on rt.id = p.repair_type_id
   where p.device_id = p_device_id
     and p.repair_type_id = p_repair_type_id
     and case when rt.diagnosis_only
              then p.sub_type_id is null and p_sub_type_id is null
              else p.sub_type_id = p_sub_type_id
         end;
$$;

create or replace function public.job_quote_floor(p_job public.jobs)
returns pence
language sql
stable
as $$
  select case
    when p_job.repair_type_id is null or p_job.device_id is null then null
    else public.repair_price(p_job.device_id, p_job.repair_type_id, p_job.sub_type_id)
  end;
$$;

-- The floor (0082) guards the quote being SET. It used to re-check on every update, so a price
-- raised on the device later would have stopped an older job from even changing status. Now a
-- job keeps the price it was created with: the floor applies when a quote is first given or
-- changed, not to everything else.
create or replace function public.validate_job_quote_floor()
returns trigger
language plpgsql
as $$
declare
  v_floor   pence;
  v_quote   boolean := tg_op = 'INSERT' or new.quoted_price is distinct from old.quoted_price;
  v_revised boolean := tg_op = 'INSERT' or new.revised_quote is distinct from old.revised_quote;
begin
  if not (v_quote or v_revised) then
    return new;
  end if;
  v_floor := public.job_quote_floor(new);
  if v_floor is null then
    return new;
  end if;

  if v_quote and new.quoted_price is not null and new.quoted_price < v_floor then
    raise exception
      'That quote is below the shop price for this repair (£%). Staff can quote more, never less.',
      trim(to_char(v_floor / 100.0, 'FM9999990.00'))
      using errcode = 'check_violation';
  end if;

  if v_revised and new.revised_quote is not null and new.revised_quote < v_floor then
    raise exception
      'That revised quote is below the shop price for this repair (£%). Staff can quote more, never less.',
      trim(to_char(v_floor / 100.0, 'FM9999990.00'))
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- As 0097, carrying the request's sub-type across too.
create or replace function public.convert_booking_to_job(
  p_booking_id uuid, p_staff_id uuid, p_quoted_price pence default null,
  p_intake_details jsonb default '{}'::jsonb)
returns uuid
language plpgsql
as $function$
declare
  v_booking   public.bookings;
  v_repair    public.repair_types;
  v_device    public.devices;
  v_existing  uuid;
  v_job_id    uuid;
  v_required  job_conversion_field[];
  v_field     job_conversion_field;
  v_staff_shop uuid := public.staff_shop(p_staff_id);
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Repair request % not found', p_booking_id;
  end if;
  if v_staff_shop is not null and v_staff_shop <> v_booking.shop_id then
    raise exception 'Repair request % belongs to another shop', v_booking.reference;
  end if;

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
    quoted_price, repair_type_id, device_id, part_tier, sub_type_id,
    intake_details, assigned_staff_id, shop_id
  )
  values (
    'mail_in',
    v_booking.id,
    v_booking.customer_name,
    v_booking.phone,
    v_booking.email,
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
    v_booking.sub_type_id,
    coalesce(p_intake_details, '{}'::jsonb),
    p_staff_id,
    v_booking.shop_id
  )
  returning id into v_job_id;

  update public.bookings
     set status = 'in_progress'
   where id = p_booking_id
     and status = 'received';

  return v_job_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The old pricing goes
-- ---------------------------------------------------------------------------

drop function public.repair_quote_price(uuid, uuid, part_tier);
alter table public.repair_types
  drop constraint repair_types_all_or_no_pricing,
  drop constraint repair_types_base_prices_not_negative,
  drop column base_price_original,
  drop column base_price_oem,
  drop column base_price_copy;
alter table public.devices drop column price_multiplier;

comment on table public.repair_part_tiers is
  'FROZEN (0109): replaced by repair_sub_types. Kept because jobs.part_tier / bookings.tier still name it on older rows.';

alter table public.repair_sub_types enable row level security;
alter table public.repair_sub_types force row level security;
alter table public.repair_type_sub_types enable row level security;
alter table public.repair_type_sub_types force row level security;
alter table public.device_repair_prices enable row level security;
alter table public.device_repair_prices force row level security;
