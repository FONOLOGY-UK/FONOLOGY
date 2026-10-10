-- 0006 — Repairs
-- Catalogue (devices, repair types, part tiers), mail-in bookings, the bench
-- jobs board, and the parts a job actually used.
--
-- The biggest addition here isn't in the brief for this file by accident:
-- job_parts doesn't exist anywhere in the frontend. Nothing links a repair to
-- the stock it consumes today. The client has now confirmed parts come out of
-- the same shelf as counter sales, so this is new structure, not a port.

-- A tender shared by repairs (job_payments, below) and the till (0008,
-- sale_payments/refunds). Defined here because this is the first file that
-- needs it — 0008 reuses this type rather than declaring its own.
create type tender_method as enum ('cash', 'pos1', 'pos2', 'transfer');

-- ---------------------------------------------------------------------------
-- Devices, repair types, part tiers
-- ---------------------------------------------------------------------------
-- Price is computed, not stored per combination: repair_types carries three
-- base prices (one per tier), devices carries a multiplier, and
-- repair_quote_price() does base x multiplier, rounded to whole pounds — the
-- same maths the frontend already displays. A device x repair x tier grid
-- would be hundreds of cells to keep in sync for no benefit; this is three
-- numbers per repair type and one per device.

create table public.devices (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  brand             text not null,
  price_multiplier  numeric(4, 2) not null check (price_multiplier > 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger devices_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

create type part_tier as enum ('original', 'oem', 'copy');

create table public.repair_types (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  description           text,
  estimate_label        text,   -- "40-60 min", "Free diagnosis" — free text, matches the frontend
  base_price_original   pence,
  base_price_oem        pence,
  base_price_copy       pence,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Diagnosis-only repairs (water damage, data recovery) have no price at any
  -- tier and must never produce a quote. Priced repairs have all three —
  -- there's no state where a repair is priced for 'original' but not 'copy'.
  constraint repair_types_all_or_no_pricing check (
    (base_price_original is null and base_price_oem is null and base_price_copy is null)
    or (base_price_original is not null and base_price_oem is not null and base_price_copy is not null)
  )
);

create trigger repair_types_updated_at
  before update on public.repair_types
  for each row execute function public.set_updated_at();

-- Fixed, tiny lookup table — the row IS the enum value, so there's no
-- separate uuid id for something that will only ever have three rows.
create table public.repair_part_tiers (
  id          part_tier primary key,
  name        text not null,
  strap_line  text,
  warranty_label text not null,
  sort_order  integer not null default 0
);

insert into public.repair_part_tiers (id, name, strap_line, warranty_label, sort_order) values
  ('original', 'Original', 'Pulled or service-pack parts from the manufacturer.', '12-month warranty', 1),
  ('oem',      'OEM',      'Built by the same factories, sold without the logo.', '6-month warranty', 2),
  ('copy',     'Copy',     'Quality-checked aftermarket. Honest budget option.',  '90-day warranty', 3);

-- Rounds to whole pounds, matching the frontend's display maths exactly:
-- round(basePence / 100 x multiplier) x 100. Returns null automatically for
-- diagnosis-only repair types, because null x anything is null — no special
-- case needed.
create or replace function public.repair_quote_price(
  p_repair_type_id uuid,
  p_device_id      uuid,
  p_tier           part_tier
)
returns pence
language sql
stable
as $$
  select (round(
    (case p_tier
       when 'original' then rt.base_price_original
       when 'oem'      then rt.base_price_oem
       when 'copy'     then rt.base_price_copy
     end)::numeric / 100.0
    * d.price_multiplier
  ) * 100)::integer
  from public.repair_types rt, public.devices d
  where rt.id = p_repair_type_id and d.id = p_device_id;
$$;

comment on function public.repair_quote_price is
  'base_price[tier] x device multiplier, rounded to whole pounds. Null in, null out — diagnosis-only repair types never produce a price.';

-- ---------------------------------------------------------------------------
-- "My model isn't listed"
-- ---------------------------------------------------------------------------
-- A customer whose phone isn't in the device list doesn't get a fake device
-- row with a guessed multiplier — they get a plain enquiry the shop follows
-- up with a human quote. No device reference, because there is no device.

create type repair_enquiry_status as enum ('new', 'contacted', 'closed');

create table public.repair_enquiries (
  id                  uuid primary key default gen_random_uuid(),
  customer_name       text not null,
  phone               text,
  email               citext,
  device_description  text not null,
  fault_description   text not null,
  status              repair_enquiry_status not null default 'new',
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bookings — mail-in repair requests from the website
-- ---------------------------------------------------------------------------
-- Customer-facing tracking entity. Mail-in only — no time slots, ever. The
-- internal bench record (Job, below) is deliberately separate: a booking is
-- what the customer sees when they check their reference; a job is the
-- day-to-day work record, and can exist without ever having a booking
-- (walk-ins) or point back to one (mail-in).

create type booking_status as enum ('received', 'in_progress', 'ready', 'dispatched', 'cancelled');

create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,

  device_id         uuid not null references public.devices (id),
  repair_type_id    uuid not null references public.repair_types (id),
  tier              part_tier,   -- null for a diagnosis-only booking; chosen once a price exists
  quoted_price      pence,       -- snapshot of repair_quote_price() at the moment of booking

  status            booking_status not null default 'received',

  customer_name     text not null,
  phone             text not null,
  email             citext not null,
  address_line1     text not null,
  address_line2     text,
  city              text,
  postcode          text not null,
  preferred_contact text not null check (preferred_contact in ('phone', 'email')),
  notes             text,

  return_tracking_number text,   -- set once the repaired device is posted back

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index bookings_status_idx on public.bookings (status);
create index bookings_device_idx on public.bookings (device_id);
create index bookings_repair_type_idx on public.bookings (repair_type_id);

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create or replace function public.bookings_set_reference()
returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('booking', new.id, 'FNL');
  return new;
end;
$$;

create trigger bookings_issue_reference
  before insert on public.bookings
  for each row execute function public.bookings_set_reference();

-- ---------------------------------------------------------------------------
-- Jobs — the bench record
-- ---------------------------------------------------------------------------
-- walk_in has no booking. mail_in always links to one. online links to the
-- order that led to it (rare — a repair sold as part of an online order — but
-- the reference exists rather than being force-fit into device_description).
--
-- waiting_approval exists because a repair can cost more than quoted. The
-- status itself is the "don't pick this up" signal — nobody needs a separate
-- assignment lock, because a job sitting in waiting_approval simply isn't in
-- in_progress, and that's what the bench board filters on.

create type job_source as enum ('walk_in', 'mail_in', 'online');
create type job_status as enum ('new', 'in_progress', 'waiting_approval', 'done', 'sent_back', 'collected');
create type job_payment_status as enum ('unpaid', 'deposit_paid', 'paid');

create table public.jobs (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,

  source            job_source not null,
  booking_id        uuid references public.bookings (id),
  order_id          uuid references public.orders (id),

  customer_name     text not null,
  phone             text,
  email             citext,
  device_description  text not null,
  problem_description text not null,
  notes             text,

  status            job_status not null default 'new',
  payment_status    job_payment_status not null default 'unpaid',
  quoted_price      pence,
  deposit_amount    pence not null default 0 check (deposit_amount >= 0),

  -- The cost-overrun path. revised_quote is set the moment the job enters
  -- waiting_approval; the approved_by/at pair is set the moment it leaves
  -- again — so "who approved this and when" is always answerable, and a job
  -- can't silently resume without someone having said yes.
  revised_quote             pence,
  revised_quote_approved_by uuid references public.staff (id),
  revised_quote_approved_at timestamptz,

  return_tracking_number text,   -- required before a mail_in job can reach sent_back

  assigned_staff_id uuid references public.staff (id),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint jobs_mail_in_has_booking check (source <> 'mail_in' or booking_id is not null),

  -- A deposit that exceeds the job's own price isn't a deposit any more.
  -- Only enforced once a price actually exists (quoted or revised) — a
  -- deposit taken before diagnosis, with no price yet, has nothing to be
  -- capped against.
  constraint jobs_deposit_not_over_price check (
    coalesce(revised_quote, quoted_price) is null
    or deposit_amount <= coalesce(revised_quote, quoted_price)
  ),

  -- payment_status and deposit_amount have to agree with each other — a job
  -- can't claim a deposit was taken while recording that £0 changed hands.
  constraint jobs_payment_status_deposit_consistency check (
    payment_status <> 'deposit_paid' or deposit_amount > 0
  )
);

create index jobs_status_idx on public.jobs (status);
create index jobs_booking_idx on public.jobs (booking_id) where booking_id is not null;
create index jobs_order_idx on public.jobs (order_id) where order_id is not null;
create index jobs_revised_quote_approved_by_idx on public.jobs (revised_quote_approved_by) where revised_quote_approved_by is not null;
create index jobs_assigned_staff_idx on public.jobs (assigned_staff_id) where assigned_staff_id is not null;

create trigger jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create or replace function public.jobs_set_reference()
returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('job', new.id, 'FNL');
  return new;
end;
$$;

create trigger jobs_issue_reference
  before insert on public.jobs
  for each row execute function public.jobs_set_reference();

create or replace function public.job_status_allowed_next(p_status job_status)
returns job_status[]
language sql
immutable
as $$
  select case p_status
    when 'new'              then array['in_progress']::job_status[]
    when 'in_progress'      then array['waiting_approval', 'done']::job_status[]
    when 'waiting_approval' then array['in_progress']::job_status[]
    when 'done'             then array['sent_back', 'collected']::job_status[]
    else array[]::job_status[]
  end;
$$;

create or replace function public.validate_job_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (new.status = any (public.job_status_allowed_next(old.status))) then
    raise exception 'Job % cannot move from % to %', old.reference, old.status, new.status;
  end if;

  if new.status = 'waiting_approval' and new.revised_quote is null then
    raise exception 'Job % needs a revised quote before it can wait on approval', old.reference;
  end if;

  if old.status = 'waiting_approval' and new.status = 'in_progress'
     and (new.revised_quote_approved_by is null or new.revised_quote_approved_at is null) then
    raise exception 'Job % cannot resume without recording who approved the revised quote', old.reference;
  end if;

  if new.status = 'sent_back' then
    if new.source <> 'mail_in' then
      raise exception 'Only a mail-in job can be sent back — % is %', old.reference, new.source;
    end if;
    if new.return_tracking_number is null then
      raise exception 'Job % needs a return tracking number before it can be sent back', old.reference;
    end if;
  end if;

  if new.status = 'collected' and new.source = 'mail_in' then
    raise exception 'A mail-in job is sent back, not collected — % is mail-in', old.reference;
  end if;

  return new;
end;
$$;

create trigger jobs_validate_status_transition
  before update on public.jobs
  for each row execute function public.validate_job_status_transition();

-- ---------------------------------------------------------------------------
-- Job parts — what a repair actually consumed
-- ---------------------------------------------------------------------------
-- Consumption happens the moment a part is added, not when the job
-- completes. A part leaves the shelf when it's physically fitted, and a job
-- that stalls in waiting_approval with a part already fitted shouldn't leave
-- that part floating as "still in stock" — the shelf count has to be honest
-- in the moment, not caught up later.

create table public.job_parts (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,
  product_id        uuid not null references public.products (id),
  quantity          integer not null default 1 check (quantity > 0),
  unit_cost         pence not null,   -- snapshot of products.cost_price at the moment the part was added
  stock_movement_id uuid not null references public.stock_movements (id),
  added_by          uuid references public.staff (id),
  added_at          timestamptz not null default now()
);

create index job_parts_job_idx on public.job_parts (job_id);
create index job_parts_product_idx on public.job_parts (product_id);
create index job_parts_stock_movement_idx on public.job_parts (stock_movement_id);
create index job_parts_added_by_idx on public.job_parts (added_by) where added_by is not null;

create or replace function public.add_job_part(
  p_job_id     uuid,
  p_product_id uuid,
  p_quantity   integer,
  p_staff_id   uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_cost_price pence;
  v_movement_id uuid;
  v_id uuid;
begin
  select cost_price into v_cost_price from public.products where id = p_product_id;
  if not found then
    raise exception 'Product % not found', p_product_id;
  end if;

  v_movement_id := public.stock_consume(
    p_product_id, p_quantity, 'repair_part',
    'job', p_job_id, p_staff_id
  );

  insert into public.job_parts (job_id, product_id, quantity, unit_cost, stock_movement_id, added_by)
  values (p_job_id, p_product_id, p_quantity, v_cost_price, v_movement_id, p_staff_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.add_job_part is
  'The one correct way to attach a part to a job. Consumes stock immediately (stock_consume) and snapshots its cost, so margin on the job reflects what the part actually cost that day.';

-- ---------------------------------------------------------------------------
-- Job payments — deposits and balances
-- ---------------------------------------------------------------------------
-- The frontend has a paid-in-advance FLAG with no number behind it. The
-- client confirmed deposits are real amounts, so this is an actual ledger of
-- what came in against a job, not a bigger flag.

create table public.job_payments (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id) on delete cascade,
  kind       text not null check (kind in ('deposit', 'balance')),
  amount     pence not null check (amount > 0),
  tender     tender_method not null,
  staff_id   uuid references public.staff (id),
  at         timestamptz not null default now()
);

create index job_payments_job_idx on public.job_payments (job_id);
create index job_payments_staff_idx on public.job_payments (staff_id) where staff_id is not null;

create or replace function public.record_job_payment(
  p_job_id   uuid,
  p_kind     text,
  p_amount   pence,
  p_tender   tender_method,
  p_staff_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_paid_total pence;
  v_target pence;
begin
  insert into public.job_payments (job_id, kind, amount, tender, staff_id)
  values (p_job_id, p_kind, p_amount, p_tender, p_staff_id)
  returning id into v_id;

  select coalesce(sum(amount), 0) into v_paid_total
  from public.job_payments where job_id = p_job_id;

  select coalesce(revised_quote, quoted_price, 0) into v_target
  from public.jobs where id = p_job_id;

  -- Cumulative payments can't exceed the job's price, once one is known —
  -- this was never actually enforced here despite the function's own
  -- comment and test claiming it was. The jobs_deposit_not_over_price CHECK
  -- looked like it covered this by accident, but deposit_amount is
  -- deliberately left unchanged (frozen at whatever it was) on the payment
  -- that reaches or exceeds the target, specifically so it keeps showing
  -- the real deposit rather than ballooning to the full total — which also
  -- means that CHECK never fires for an overpayment, since deposit_amount
  -- never actually reflects the overpaid figure. Found the moment the
  -- CASE-type bug above was fixed and this function could run at all: the
  -- "refuses an overpayment" test still expected an exception, and none
  -- came.
  if v_target > 0 and v_paid_total > v_target then
    raise exception 'Payment of % would bring the total paid on job % to %, more than its price of %',
      p_amount, p_job_id, v_paid_total, v_target;
  end if;

  -- The 'paid'::job_payment_status cast on the first branch is load-bearing,
  -- not decorative. With every branch a bare string literal, Postgres
  -- resolves the CASE's own type as text (there's nothing else to anchor
  -- it to) before it ever gets to the UPDATE target's type — and text has
  -- no implicit assignment cast to an enum. Left uncast, this statement
  -- fails on every single call, unconditionally, regardless of which
  -- branch actually matches. Found because the only existing test of this
  -- function expected it to throw anyway (a deposit over the job price),
  -- which happened to still show a passing throws_ok for entirely the
  -- wrong reason — this function had never once actually succeeded.
  update public.jobs
     set payment_status = case
           when v_target > 0 and v_paid_total >= v_target then 'paid'::job_payment_status
           when v_paid_total > 0 then 'deposit_paid'
           else 'unpaid'
         end,
         -- job_payments.amount for this job so far, not the pre-update
         -- payment_status column (every SET expression here reads the OLD
         -- row, so payment_status here is still whatever it was BEFORE this
         -- payment, even on the payment that completes the job) — that
         -- would leave a completing payment's deposit_amount showing the
         -- full price paid instead of the actual deposit portion.
         deposit_amount = case
           when v_target > 0 and v_paid_total >= v_target then deposit_amount
           else v_paid_total
         end
   where id = p_job_id;

  return v_id;
end;
$$;

comment on function public.record_job_payment is
  'Records money against a job and moves payment_status accordingly. A job with no price yet (quote pending) can take a deposit without ever reaching paid on its own — that needs a quote first.';
