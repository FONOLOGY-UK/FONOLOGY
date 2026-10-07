-- 0106 — the unified numbering system (client spec "Multi-Shop Reference Numbering System", v2,
-- 7 Oct 2026). Replaces the placeholder per-shop prefixes of 0100.
--
-- Every customer-facing number is now
--
--     [SHOP_CODE]-[PREFIX]-[DDMMYY][NNN]      e.g. F01-JOB-061026001   (17 characters)
--
--   SHOP_CODE  F01, F02 … — the shop responsible for the record (see below). F100 after F99.
--   PREFIX     exactly seven: ORD online order · SAL till sale · REQ repair request (booking) ·
--              JOB repair job · TRD sell / trade-in request · PAY trade-in payout · REF refund.
--              Anything else is refused.
--   DDMMYY     the shop's calendar day (Europe/London, shop_day()) when the record is created.
--   NNN        a counter per shop, per prefix, per day, from 001. After 999 it simply grows a
--              digit (…061026999 → …0610261000) rather than failing — client decision.
--
-- Which shop: a till sale, refund or payout — the shop it is processed at (shop_id, which the DB
-- already takes from staff_shop()); a booking, job or trade-in request — its shop_id; an online
-- order — the shop that fulfils it (fulfilment_shop_id, the hub today). A record moved to another
-- shop later keeps its number: it says where the record started.
--
-- SHOP CODES are assigned by the database when a shop is inserted — nobody types one — from a
-- one-row counter, so two shops created at the same moment queue on that row and can never share a
-- code, and a rolled-back insert gives its number back. A code is permanent (an update is refused)
-- and never reused: the counter only goes up, and shops are never deleted (every till table points
-- at them). The hub is F01; every other existing shop is renumbered F02, F03 … in the order they
-- trade (sort_order, then age). The client confirmed existing data is dummy, so references already
-- issued (FNL-, JOB-, BUY-, REF-, S2-…) are left exactly as they are — still unique, still in
-- reference_registry, still found by search and by the track page.
--
-- The daily counter lives in reference_counters, one row per (shop, prefix, day), bumped with an
-- upsert: the row lock serialises two tills issuing the same series at once (each gets its own
-- number, in order), and different shops or prefixes never touch each other's row. The lock is
-- held until the creating transaction commits; a rollback hands the number back, so a day's
-- series has no gaps from failed saves.
--
-- Not covered by the spec, deliberately unchanged: goods-in notes (stock_intakes, 0103) are an
-- internal document, not one of the seven transactions, and keep GIN- from reference_seq with the
-- shop's code in front off the hub (shop_ref_prefix()), now F02-GIN-…

-- ---------------------------------------------------------------------------
-- Shop codes
-- ---------------------------------------------------------------------------

create function public.format_shop_code(p_number integer) returns text
language sql immutable
as $$
  select 'F' || case when p_number < 100 then lpad(p_number::text, 2, '0') else p_number::text end
$$;

comment on function public.format_shop_code is
  'Shop number -> code: 1 -> F01, 42 -> F42, 100 -> F100 (0106).';

-- Renumber what exists: hub first, then by trading order. Through a temporary value, so the
-- unique constraint never sees two shops holding the same code mid-update.
alter table public.shops drop constraint shops_code_shape;

update public.shops set code = 'tmp-' || id::text;

update public.shops s
   set code = public.format_shop_code(o.n::integer)
  from (select id, row_number() over (order by is_fulfilment_hub desc, sort_order, created_at, id) as n
          from public.shops) o
 where o.id = s.id;

alter table public.shops
  add constraint shops_code_shape check (code ~ '^F([0-9]{2}|[1-9][0-9]{2,})$');

comment on column public.shops.code is
  'F01, F02 … assigned by the column default next_shop_code(); permanent and never reused. Starts every reference this shop issues (0106).';

create table public.shop_code_counter (
  only_row     boolean primary key default true check (only_row),
  last_number  integer not null check (last_number >= 0)
);

insert into public.shop_code_counter (last_number)
select count(*) from public.shops;

alter table public.shop_code_counter enable row level security;
alter table public.shop_code_counter force row level security;

comment on table public.shop_code_counter is
  'The highest shop number ever handed out. Only goes up, so a retired shop''s code is never given to a new one (0106).';

-- The column default hands out the code; the row lock it takes on the counter is held until the
-- creating transaction ends, so no other shop can be numbered in between.
create function public.next_shop_code() returns text
language plpgsql
as $$
declare
  v_number integer;
begin
  update public.shop_code_counter
     set last_number = last_number + 1
   returning last_number into v_number;
  return public.format_shop_code(v_number);
end;
$$;

alter table public.shops alter column code set default public.next_shop_code();

-- A code typed into an insert skips the default, so it is not the one just handed out: refused.
create function public.shops_code_not_chosen() returns trigger
language plpgsql
as $$
begin
  if new.code is distinct from (select public.format_shop_code(last_number) from public.shop_code_counter) then
    raise exception 'Shop codes are assigned automatically and cannot be chosen'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger shops_code_not_chosen
  before insert on public.shops
  for each row execute function public.shops_code_not_chosen();

create function public.shops_code_is_permanent() returns trigger
language plpgsql
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'A shop code is permanent (% cannot become %)', old.code, new.code
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger shops_code_is_permanent
  before update of code on public.shops
  for each row execute function public.shops_code_is_permanent();

-- ---------------------------------------------------------------------------
-- The daily counters and the one function that issues a number
-- ---------------------------------------------------------------------------

create table public.reference_counters (
  shop_id      uuid not null references public.shops (id),
  prefix       text not null
               check (prefix in ('ORD', 'SAL', 'REQ', 'JOB', 'TRD', 'PAY', 'REF')),
  issued_on    date not null,
  last_number  integer not null check (last_number >= 1),
  primary key (shop_id, prefix, issued_on)
);

alter table public.reference_counters enable row level security;
alter table public.reference_counters force row level security;

comment on table public.reference_counters is
  'One row per shop, prefix and shop-day: the last number issued in that series. Written only by issue_shop_reference() (0106).';

create function public.issue_shop_reference(
  p_prefix      text,
  p_shop_id     uuid,
  p_entity_type text,
  p_entity_id   uuid
) returns text
language plpgsql
as $$
declare
  v_code      text;
  v_day       date := public.shop_day(now());
  v_number    integer;
  v_reference text;
begin
  if p_prefix is null or p_prefix not in ('ORD', 'SAL', 'REQ', 'JOB', 'TRD', 'PAY', 'REF') then
    raise exception 'Unknown reference prefix %', coalesce(p_prefix, '(none)')
      using errcode = '22023';
  end if;

  select code into v_code from public.shops where id = p_shop_id;
  if v_code is null then
    raise exception 'Cannot number a record for unknown shop %', p_shop_id
      using errcode = '23503';
  end if;

  insert into public.reference_counters as c (shop_id, prefix, issued_on, last_number)
  values (p_shop_id, p_prefix, v_day, 1)
  on conflict (shop_id, prefix, issued_on)
  do update set last_number = c.last_number + 1
  returning c.last_number into v_number;

  v_reference := v_code || '-' || p_prefix || '-' || to_char(v_day, 'DDMMYY')
              || case when v_number < 1000 then lpad(v_number::text, 3, '0') else v_number::text end;

  insert into public.reference_registry (reference, entity_type, entity_id)
  values (v_reference, p_entity_type, p_entity_id);

  return v_reference;
end;
$$;

comment on function public.issue_shop_reference is
  'Issues the next [SHOP]-[PREFIX]-[DDMMYY][NNN] number for a shop and records it in reference_registry. The only way a customer-facing reference is created (0106).';

comment on function public.issue_reference is
  'LEGACY (0001): PREFIX-nnnnn from reference_seq. Since 0106 used only for goods-in notes (GIN-); every customer-facing number comes from issue_shop_reference().';

comment on function public.shop_ref_prefix is
  'Goods-in note prefix: GIN on the hub, the shop''s code in front elsewhere (F02-GIN). The seven customer-facing series use issue_shop_reference() instead (0106).';

-- ---------------------------------------------------------------------------
-- Every customer-facing record now numbers itself through it
-- ---------------------------------------------------------------------------

create or replace function public.orders_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_shop_reference('ORD', new.fulfilment_shop_id, 'order', new.id);
  return new;
end;
$$;

create or replace function public.sales_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_shop_reference('SAL', new.shop_id, 'sale', new.id);
  return new;
end;
$$;

create or replace function public.bookings_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_shop_reference('REQ', new.shop_id, 'booking', new.id);
  return new;
end;
$$;

create or replace function public.jobs_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_shop_reference('JOB', new.shop_id, 'job', new.id);
  return new;
end;
$$;

create or replace function public.sell_requests_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_shop_reference('TRD', new.shop_id, 'sell_request', new.id);
  return new;
end;
$$;

create or replace function public.trade_in_payouts_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_shop_reference('PAY', new.shop_id, 'trade_in_payout', new.id);
  return new;
end;
$$;

create or replace function public.refunds_set_reference() returns trigger
language plpgsql
as $$
begin
  -- Only when the caller has not supplied one (an import must not be renumbered) — as since 0035.
  if new.reference is null then
    new.reference := public.issue_shop_reference('REF', new.shop_id, 'refund', new.id);
  end if;
  return new;
end;
$$;

-- Jobs no longer have a sequence of their own: the daily JOB series replaces it.
drop function public.issue_job_reference(uuid, uuid);
drop function public.issue_job_reference(uuid);
drop sequence public.job_reference_seq;

comment on function public.convert_booking_to_job is
  'Change request item 2. Creates a job from a repair request, carrying every field the customer already gave across, and moves the request to in_progress — in one transaction, so a job can never exist against a request still showing as unclaimed. Refuses a second conversion of the same request (one booking, one job) and refuses to run until every field named in that repair type''s conversion_required_fields has actually been answered. The job gets the next number in its shop''s JOB series (0106); the request keeps its REQ number.';
