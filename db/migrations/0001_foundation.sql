-- 0001 — Foundation
-- Money, time, reference numbers, audit log.
-- Everything else depends on this file.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
-- All money is integer pence. Never a decimal, never a float, never pounds.
-- Pounds exist only in the display layer.
-- Max value is about £21.4m, which is comfortably beyond a single shop.
-- Amounts may be negative (trade-in payouts are money OUT), so the domain
-- itself has no sign check — individual columns add one where it applies.

create domain pence as integer;

comment on domain pence is 'Money in integer pence. Negative allowed (payouts).';

-- ---------------------------------------------------------------------------
-- Time
-- ---------------------------------------------------------------------------
-- Every timestamp is stored UTC. But "today's sales" means the shop's today,
-- not the server's — the server runs UTC and the shop runs on UK time with
-- British Summer Time. Left alone, sales after midnight UK land on the wrong
-- day and every hour-of-day figure is an hour out for half the year.
--
-- So: store UTC, group by shop_day().
--
-- Marked immutable so it can be used in indexes and generated columns.
-- Strictly it isn't (timezone rules can change), but UK rules are stable and
-- historical data won't be reinterpreted. This is a deliberate trade.

create or replace function public.shop_day(ts timestamptz)
returns date
language sql
immutable
as $$
  select (ts at time zone 'Europe/London')::date;
$$;

create or replace function public.shop_hour(ts timestamptz)
returns integer
language sql
immutable
as $$
  select extract(hour from (ts at time zone 'Europe/London'))::integer;
$$;

-- Monday = 0, matching the busiest-times chart the frontend already draws.
create or replace function public.shop_weekday(ts timestamptz)
returns integer
language sql
immutable
as $$
  select ((extract(isodow from (ts at time zone 'Europe/London'))::integer) - 1);
$$;

comment on function public.shop_day is 'UK calendar day for a UTC timestamp. Use for every daily total.';

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference numbers
-- ---------------------------------------------------------------------------
-- The frontend gives orders, mail-in repairs, sell requests, till sales AND
-- repair jobs the same "FNL-nnnn" format, from two separate in-memory counters
-- that happen not to overlap. The track page then searches three tables in a
-- fixed order and takes the first match. That works by luck, not design.
--
-- Fixed here by making every reference come from one sequence and land in one
-- table. Consequences:
--   - two references can never collide, because the registry enforces it
--   - tracking is one indexed lookup instead of a scan across three tables
--   - a reference always knows what it belongs to
--
-- Trade-in payouts keep their own BUY- prefix. They're money going out and the
-- business rules say they stay visibly separate from everything else.

create sequence public.reference_seq start with 10000 increment by 1;

create table public.reference_registry (
  reference    text primary key,
  entity_type  text not null,
  entity_id    uuid not null,
  created_at   timestamptz not null default now(),

  constraint reference_registry_entity_unique unique (entity_type, entity_id)
);

create index reference_registry_entity_idx
  on public.reference_registry (entity_type, entity_id);

comment on table public.reference_registry is
  'Every customer-facing reference number ever issued. One row per reference, no duplicates possible.';

create or replace function public.issue_reference(
  p_entity_type text,
  p_entity_id   uuid,
  p_prefix      text default 'FNL'
)
returns text
language plpgsql
as $$
declare
  v_reference text;
begin
  v_reference := p_prefix || '-' || nextval('public.reference_seq')::text;

  insert into public.reference_registry (reference, entity_type, entity_id)
  values (v_reference, p_entity_type, p_entity_id);

  return v_reference;
end;
$$;

comment on function public.issue_reference is
  'Issues the next reference and records what it belongs to. The only way references should ever be created.';

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
-- One table for everything that needs a "who did this" answer: refunds, cash
-- adjustments, stock write-offs, below-cost sales, settings changes, and every
-- time someone opens a customer's ID document.
--
-- One table rather than four, because the question is always the same shape
-- and the owner will want to see it in one place.

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,                       -- staff.id, null for system actions
  actor_label  text not null,              -- name captured at the time, survives staff deletion
  action       text not null,              -- 'refund.create', 'stock.write_off', 'document.view'
  entity_type  text not null,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  note         text,
  created_at   timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx  on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);

comment on column public.audit_log.actor_label is
  'Name copied at the time of the action, so the trail survives a staff member being removed.';
