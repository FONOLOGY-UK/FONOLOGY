-- 0007 — Sell / trade-in
-- Customer requests, human quotes, guest-friendly acceptance, and payouts.
--
-- No automatic grading or pricing formula anywhere in this file — the client
-- confirmed a person always sets the price. The frontend's mock estimate
-- formula does not get ported; it was explicitly indicative, never real.

create type sell_request_status as enum (
  'submitted', 'quoted', 'accepted', 'declined', 'received', 'paid', 'rejected'
);

create table public.sell_requests (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,

  customer_id       uuid references public.customers (id),   -- nullable, guest-friendly

  name              text not null,
  phone             text not null,
  email             citext not null,
  preferred_contact text not null check (preferred_contact in ('phone', 'email')),

  device_id         uuid references public.devices (id),   -- shares the repair catalogue's device list
  device_other      text,                                   -- free text when the model isn't listed
  condition         jsonb not null,                          -- {storage, screen, body, powers_on, network, accessories[]} — descriptive intake data, not something ever joined or filtered on, so jsonb rather than five columns

  status            sell_request_status not null default 'submitted',

  quoted_amount     pence,
  quoted_by         uuid references public.staff (id),
  quoted_at         timestamptz,

  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint sell_requests_device_or_other check (device_id is not null or device_other is not null),

  constraint sell_requests_quote_consistency check (
    (quoted_amount is null and quoted_by is null and quoted_at is null)
    or (quoted_amount is not null and quoted_by is not null and quoted_at is not null)
  )
);

create index sell_requests_status_idx on public.sell_requests (status);
create index sell_requests_customer_idx on public.sell_requests (customer_id) where customer_id is not null;
create index sell_requests_device_idx on public.sell_requests (device_id) where device_id is not null;
create index sell_requests_quoted_by_idx on public.sell_requests (quoted_by) where quoted_by is not null;

-- Which moves are legal. paid is reachable directly from accepted as well as
-- from received, because the payout trigger further down (
-- trade_in_payouts_advance_sell_request) sets paid the moment a payout is
-- recorded and does not force a separate received step first — received
-- exists as an optional staff-recorded checkpoint, not a mandatory gate.
-- What this rules out is the thing that actually matters: nothing can jump
-- straight from submitted or quoted to paid, and nothing leaves a terminal
-- state (declined, rejected, paid).
create or replace function public.sell_request_status_allowed_next(p_status sell_request_status)
returns sell_request_status[]
language sql
immutable
as $$
  select case p_status
    when 'submitted' then array['quoted', 'declined']::sell_request_status[]
    when 'quoted'    then array['accepted', 'declined']::sell_request_status[]
    when 'accepted'  then array['received', 'paid']::sell_request_status[]
    when 'received'  then array['paid', 'rejected']::sell_request_status[]
    else array[]::sell_request_status[]
  end;
$$;

create or replace function public.validate_sell_request_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (new.status = any (public.sell_request_status_allowed_next(old.status))) then
    raise exception 'Sell request % cannot move from % to %', old.reference, old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger sell_requests_validate_status_transition
  before update on public.sell_requests
  for each row execute function public.validate_sell_request_status_transition();

create trigger sell_requests_updated_at
  before update on public.sell_requests
  for each row execute function public.set_updated_at();

create or replace function public.sell_requests_set_reference()
returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('sell_request', new.id, 'FNL');
  return new;
end;
$$;

create trigger sell_requests_issue_reference
  before insert on public.sell_requests
  for each row execute function public.sell_requests_set_reference();

-- Photos of the device being offered. A real child table rather than a jsonb
-- array of paths, to match how product_images and order_documents already
-- model "an ordered set of uploaded files" elsewhere in this schema.
-- Private by default (see 0011) — nobody but staff needs to see these.
create table public.sell_request_photos (
  id               uuid primary key default gen_random_uuid(),
  sell_request_id  uuid not null references public.sell_requests (id) on delete cascade,
  storage_path     text not null,
  position         integer not null default 0,
  created_at       timestamptz not null default now(),

  constraint sell_request_photos_position_unique unique (sell_request_id, position)
);

-- ---------------------------------------------------------------------------
-- Customer acceptance — no account required
-- ---------------------------------------------------------------------------
-- The customer may have no login at all, so acceptance can't be "click a
-- button while signed in". A single-use link does the job: the API mints a
-- random token, emails/texts it, and stores only its hash — same principle as
-- staff.pin_hash in 0002, never store the thing itself, only proof you can
-- check against it.

create table public.sell_request_acceptance_tokens (
  id               uuid primary key default gen_random_uuid(),
  sell_request_id  uuid not null references public.sell_requests (id) on delete cascade,
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  used_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index sell_request_acceptance_tokens_request_idx
  on public.sell_request_acceptance_tokens (sell_request_id);

-- Redeeming is one atomic UPDATE: the WHERE clause only matches an unused,
-- unexpired token, and the row lock it takes means two simultaneous attempts
-- with the same token can't both succeed — the second one's UPDATE simply
-- matches zero rows once the first has set used_at. No separate check-then-
-- update race is possible because there is no separate check.
create or replace function public.redeem_sell_acceptance_token(p_token_hash text)
returns uuid
language plpgsql
as $$
declare
  v_sell_request_id uuid;
begin
  update public.sell_request_acceptance_tokens
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
  returning sell_request_id into v_sell_request_id;

  if v_sell_request_id is not null then
    update public.sell_requests
       set status = 'accepted'
     where id = v_sell_request_id and status = 'quoted';
  end if;

  return v_sell_request_id;   -- null means invalid, expired, or already used
end;
$$;

comment on function public.redeem_sell_acceptance_token is
  'Call with the hash of the token from the acceptance link (hash it the same way it was hashed at issue — the API''s job, not this function''s). Returns the sell_request id on success, null otherwise. Recommended token lifetime: 7 days, set by the caller as expires_at when the row is inserted.';

-- ---------------------------------------------------------------------------
-- Trade-in payouts — money OUT
-- ---------------------------------------------------------------------------
-- Always negative, always its own BUY- reference series, always excluded from
-- revenue — the same shape of rule as 0004's stock direction checks: don't
-- trust a positive number to not sneak in here.
--
-- method is text + check, not an enum, on purpose — everywhere else in this
-- schema prefers native enums for stability, but bank transfer is explicitly
-- provisional (the client hasn't confirmed it). An enum value, once shipped,
-- is awkward to remove; a CHECK constraint is a one-line migration either way.

create table public.trade_in_payouts (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,

  sell_request_id     uuid references public.sell_requests (id),   -- null for a walk-in buy-in with no prior online request
  device_label        text not null,
  customer_name       text not null,

  amount              pence not null check (amount < 0),
  method              text not null check (method in ('cash', 'bank_transfer')),

  staff_id            uuid not null references public.staff (id),
  notes               text,

  restocked           boolean not null default false,
  resale_price        pence,
  restocked_product_id uuid references public.products (id),

  created_at          timestamptz not null default now()
);

create index trade_in_payouts_sell_request_idx
  on public.trade_in_payouts (sell_request_id) where sell_request_id is not null;
create index trade_in_payouts_staff_idx on public.trade_in_payouts (staff_id);
create index trade_in_payouts_restocked_product_idx
  on public.trade_in_payouts (restocked_product_id) where restocked_product_id is not null;

create or replace function public.trade_in_payouts_set_reference()
returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('trade_in_payout', new.id, 'BUY');
  return new;
end;
$$;

create trigger trade_in_payouts_issue_reference
  before insert on public.trade_in_payouts
  for each row execute function public.trade_in_payouts_set_reference();

-- If a payout names a sell request, move that request on. Money changed
-- hands, so 'paid' is the honest status regardless of what it was before.
create or replace function public.trade_in_payouts_advance_sell_request()
returns trigger
language plpgsql
as $$
begin
  if new.sell_request_id is not null then
    update public.sell_requests set status = 'paid' where id = new.sell_request_id;
  end if;
  return new;
end;
$$;

create trigger trade_in_payouts_advance_sell_request
  after insert on public.trade_in_payouts
  for each row execute function public.trade_in_payouts_advance_sell_request();

-- Turns a name into a URL-safe slug. Small and generic enough that a later
-- file could reuse it, but it lives here because this is the first place a
-- product gets created from something other than the admin form (0003's
-- products.slug is hand-typed by staff; a restocked trade-in has no form).
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(p_text), '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Restocking — manual, by design
-- ---------------------------------------------------------------------------
-- The client confirmed a bought-in device only becomes stock if staff tick a
-- box and set a resale price. This is that tick: it creates the product and a
-- buy_in stock movement in one step, at the price actually paid, and refuses
-- to run twice on the same payout.

create or replace function public.restock_trade_in(
  p_payout_id  uuid,
  p_name       text,
  p_category   product_category,
  p_resale_price pence,
  p_kind       product_kind default 'accessory',
  p_staff_id   uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_payout    public.trade_in_payouts;
  v_unit_cost pence;
  v_product_id uuid;
  v_slug      text;
begin
  select * into v_payout from public.trade_in_payouts where id = p_payout_id;
  if not found then
    raise exception 'Trade-in payout % not found', p_payout_id;
  end if;
  if v_payout.restocked then
    raise exception 'Payout % has already been restocked', p_payout_id;
  end if;

  -- amount is money OUT (negative); cost is what was actually paid (positive).
  v_unit_cost := -v_payout.amount;
  -- The FULL payout id, not a truncated prefix — an 8-character slice is
  -- only 32 bits of a uuid's entropy, which is not actually collision-proof
  -- (found by testing two restocks whose ids happened to share a prefix).
  -- The full id is unique by construction, because it's the payout's own
  -- primary key.
  v_slug := public.slugify(p_name) || '-' || p_payout_id::text;

  insert into public.products (slug, name, kind, category, price, cost_price, stock_qty)
  values (v_slug, p_name, p_kind, p_category, p_resale_price, v_unit_cost, 0)
  returning id into v_product_id;

  perform public.stock_receive(
    v_product_id, 1, v_unit_cost, 'buy_in',
    'trade_in_payout', p_payout_id, p_staff_id
  );

  update public.trade_in_payouts
     set restocked = true, resale_price = p_resale_price, restocked_product_id = v_product_id
   where id = p_payout_id;

  return v_product_id;
end;
$$;

comment on function public.restock_trade_in is
  'The only way a trade-in becomes sellable stock. One call, one product, one buy_in movement at what the shop actually paid. Refuses to run twice on the same payout.';
