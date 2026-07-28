-- 0005 — Orders
-- Delivery zones, online orders, order lines, plate-verification documents.
--
-- Three things the frontend never had that this file adds for real:
--   1. Delivery priced by postcode area, not a flat guess.
--   2. A status machine that actually stops an order reaching an impossible
--      state (a collect order marked "shipped" has happened before now).
--   3. Plate-verification documents that genuinely block dispatch, instead of
--      a mock upload that let checkout complete regardless.

-- ---------------------------------------------------------------------------
-- Delivery zones
-- ---------------------------------------------------------------------------
-- Rates are still placeholders the client hasn't signed off — that's exactly
-- why they're rows, not constants. Changing a price is an UPDATE, not a
-- migration.

create table public.delivery_zones (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,   -- 'standard', 'remote'
  label       text not null
);

insert into public.delivery_zones (code, label) values
  ('standard', 'Standard UK'),
  ('remote',   'Remote areas (Highlands, Islands, NI, Channel Islands, Isle of Man, Scilly)');

-- Outward-code prefixes mapped to a zone. Matching prefers the LONGEST match,
-- which is why TR21–TR25 (Isles of Scilly, remote) can sit alongside the fact
-- that TR on its own is never seeded — mainland Cornwall (TR1, TR11, ...)
-- falls through to 'standard' because nothing matches it at all, not because
-- something shorter loses to something longer.
create table public.delivery_postcode_prefixes (
  prefix   text primary key,
  zone_id  uuid not null references public.delivery_zones (id)
);

create index delivery_postcode_prefixes_zone_idx on public.delivery_postcode_prefixes (zone_id);

-- Whole postcode areas that are entirely remote.
insert into public.delivery_postcode_prefixes (prefix, zone_id)
select p, (select id from public.delivery_zones where code = 'remote')
from unnest(array['IV','HS','KW','ZE','BT','IM','GY','JE']) as p;

-- Isles of Scilly — a handful of districts inside the otherwise-mainland TR area.
insert into public.delivery_postcode_prefixes (prefix, zone_id)
select 'TR' || n, (select id from public.delivery_zones where code = 'remote')
from generate_series(21, 25) as n;

-- Western Scottish Highlands & Islands districts inside the PA area
-- (PA1–PA19 is Paisley/Renfrewshire — mainland, deliberately not seeded).
insert into public.delivery_postcode_prefixes (prefix, zone_id)
select 'PA' || n, (select id from public.delivery_zones where code = 'remote')
from generate_series(20, 78) as n;

-- Highlands districts inside the PH area (PH1–PH16 is Perth — mainland).
insert into public.delivery_postcode_prefixes (prefix, zone_id)
select 'PH' || n, (select id from public.delivery_zones where code = 'remote')
from generate_series(17, 50) as n;

-- Isle of Arran / Isle of Cumbrae — two districts inside the otherwise-mainland KA area.
insert into public.delivery_postcode_prefixes (prefix, zone_id)
select p, (select id from public.delivery_zones where code = 'remote')
from unnest(array['KA27','KA28']) as p;

comment on table public.delivery_postcode_prefixes is
  'Outward-code prefix -> zone. Resolve with public.delivery_zone_for(postcode); always take the longest matching prefix.';

-- Rates: zone x method. 'collect' has no address and no zone, so it is
-- represented once per zone at £0 rather than a special-cased null zone —
-- simpler than teaching every query about a zone that means "no zone".
create type delivery_method as enum ('collect', 'standard', 'next_day');

create table public.delivery_rates (
  id        uuid primary key default gen_random_uuid(),
  zone_id   uuid not null references public.delivery_zones (id),
  method    delivery_method not null,
  price     pence not null check (price >= 0),
  updated_at timestamptz not null default now(),

  constraint delivery_rates_unique unique (zone_id, method)
);

create trigger delivery_rates_updated_at
  before update on public.delivery_rates
  for each row execute function public.set_updated_at();

insert into public.delivery_rates (zone_id, method, price)
select z.id, m.method, m.price
from public.delivery_zones z
cross join (values
  ('collect'::delivery_method,  0),
  ('standard'::delivery_method, 395),
  ('next_day'::delivery_method, 695)
) as m(method, price)
where z.code = 'standard'
union all
select z.id, m.method, m.price
from public.delivery_zones z
cross join (values
  ('collect'::delivery_method,  0),
  ('standard'::delivery_method, 995),
  ('next_day'::delivery_method, 995)   -- placeholder: next-day isn't really offered to remote areas today; same price until the client decides whether to offer it at all
) as m(method, price)
where z.code = 'remote';

-- Normalises a postcode, pulls the outward code (everything except the fixed
-- 3-character inward code), and returns the longest-matching zone. Falls back
-- to 'standard' for anything unrecognised — a delivery quote should never
-- hard-fail because a postcode looked unusual.
create or replace function public.delivery_zone_for(p_postcode text)
returns uuid
language plpgsql
stable
as $$
declare
  v_clean   text;
  v_outward text;
  v_zone_id uuid;
begin
  v_clean := upper(regexp_replace(coalesce(p_postcode, ''), '\s+', '', 'g'));

  if length(v_clean) < 5 then
    return (select id from public.delivery_zones where code = 'standard');
  end if;

  -- UK inward code is always exactly 3 characters (digit + 2 letters).
  v_outward := left(v_clean, length(v_clean) - 3);

  select zone_id into v_zone_id
  from public.delivery_postcode_prefixes
  where left(v_outward, length(prefix)) = prefix
  order by length(prefix) desc
  limit 1;

  return coalesce(v_zone_id, (select id from public.delivery_zones where code = 'standard'));
end;
$$;

comment on function public.delivery_zone_for is
  'UK postcode -> delivery zone id. Longest matching outward-code prefix wins. Unrecognised postcodes fall back to standard.';

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
-- Guests are the common case, not the exception — customer_id is nullable and
-- a guest order carries only an email. Delivery address is structured, not one
-- free-text line, because it has to resolve to a zone; the zone itself is
-- frozen on the order at creation time so a later rate change never rewrites
-- what an old order was actually charged.

create type order_status as enum ('pending', 'paid', 'ready', 'shipped', 'collected', 'cancelled');

create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,

  customer_id    uuid references public.customers (id) on delete set null,
  guest_email    citext,

  status         order_status not null default 'pending',
  delivery_method delivery_method not null,
  delivery_zone_id uuid references public.delivery_zones (id),  -- null for collect

  -- Structured so it can be zoned; also so a receipt or a courier label can be
  -- built without parsing a free-text blob.
  recipient_name  text,
  address_line1   text,
  address_line2   text,
  city            text,
  county          text,
  postcode        text,

  subtotal       pence not null check (subtotal >= 0),
  delivery_fee   pence not null default 0 check (delivery_fee >= 0),
  -- Staff-applied adjustment (goodwill, price match). Not a customer promo
  -- code — promotions are till-only, so there is deliberately no online
  -- discount-code redemption path anywhere in this schema.
  discount       pence not null default 0 check (discount >= 0),
  total          pence generated always as (greatest(subtotal + delivery_fee - discount, 0)) stored,

  payment_provider   text check (payment_provider in ('stripe', 'clearpay')),
  provider_reference text,

  paid_at        timestamptz,   -- set once, the moment status first reaches 'paid' — see the trigger below
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint orders_guest_or_customer check (customer_id is not null or guest_email is not null),

  constraint orders_delivery_address_present check (
    delivery_method = 'collect'
    or (address_line1 is not null and city is not null and postcode is not null)
  ),

  -- The rule the client asked for, enforced no matter which code path writes
  -- the row: a collect order can never carry 'shipped', a delivery order can
  -- never carry 'collected'. This sits on the table itself, not only in the
  -- status trigger below, so it holds even against a direct UPDATE.
  constraint orders_delivery_status_consistency check (
    not (delivery_method = 'collect' and status = 'shipped')
    and not (delivery_method <> 'collect' and status = 'collected')
  )
);

create index orders_customer_idx on public.orders (customer_id) where customer_id is not null;
create index orders_status_idx   on public.orders (status);
create index orders_day_idx      on public.orders (public.shop_day(created_at));
create index orders_delivery_zone_idx on public.orders (delivery_zone_id) where delivery_zone_id is not null;

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create or replace function public.orders_set_reference()
returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('order', new.id, 'FNL');
  return new;
end;
$$;

create trigger orders_issue_reference
  before insert on public.orders
  for each row execute function public.orders_set_reference();

-- ---------------------------------------------------------------------------
-- Order status machine
-- ---------------------------------------------------------------------------
-- pending -> paid -> ready -> shipped | collected, plus cancelled from
-- anywhere before a terminal state. The collect/shipped and delivery/collected
-- exclusions are the CHECK above, not here — this only owns "is this stage
-- reachable from that stage at all".
--
-- Concurrency: two staff clicking two different next-step buttons on the same
-- order at once is safe without extra locking. An UPDATE takes a row lock on
-- the order for the duration of the transaction, so the second writer's BEFORE
-- trigger sees the FIRST writer's committed status as OLD, not a stale read —
-- Postgres serialises this for free. The second, now-invalid move is rejected
-- by the transition check rather than silently overwriting the first.

create or replace function public.order_status_allowed_next(p_status order_status)
returns order_status[]
language sql
immutable
as $$
  select case p_status
    when 'pending' then array['paid', 'cancelled']::order_status[]
    when 'paid'    then array['ready', 'shipped', 'collected', 'cancelled']::order_status[]
    when 'ready'   then array['shipped', 'collected', 'cancelled']::order_status[]
    else array[]::order_status[]
  end;
$$;

create or replace function public.validate_order_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_line record;
begin
  if new.status = old.status then
    return new;
  end if;

  if not (new.status = any (public.order_status_allowed_next(old.status))) then
    raise exception 'Order % cannot move from % to %', old.reference, old.status, new.status;
  end if;

  -- A plate order with any document still pending or rejected is stuck here
  -- until that's resolved. Orders with no documents at all (everything that
  -- isn't a plate) sail through — the EXISTS is false and the check is free.
  if new.status in ('ready', 'shipped') and exists (
    select 1 from public.order_documents
    where order_id = new.id and status <> 'approved'
  ) then
    raise exception 'Order % has unresolved verification documents', old.reference;
  end if;

  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := now();

    -- Stock comes out here, once, the moment payment is confirmed — not at
    -- checkout (payment might fail) and not later. This is also the
    -- idempotency boundary for payment-webhook retries: a webhook that fires
    -- twice sends two UPDATEs, but the second finds old.status already
    -- 'paid', hits the no-op guard above, and never reaches this branch a
    -- second time. Stock is never double-consumed by a retried webhook.
    for v_line in select * from public.order_lines where order_id = new.id loop
      if v_line.product_id is not null then
        perform public.stock_consume(
          v_line.product_id, v_line.quantity, 'online_order',
          'order', new.id, null
        );
      end if;
    end loop;
  end if;

  -- The mirror image of the block above. An order can only reach cancelled
  -- from pending, paid or ready (order_status_allowed_next) — pending never
  -- consumed stock in the first place, so only paid/ready need it given
  -- back. Uses refund_restock: goods coming back onto the shelf without a
  -- courier ever having them is the same shape of event as a refunded sale
  -- being restocked, whichever door it came through.
  if new.status = 'cancelled' and old.status in ('paid', 'ready') then
    for v_line in select * from public.order_lines where order_id = new.id loop
      if v_line.product_id is not null then
        perform public.stock_receive(
          v_line.product_id, v_line.quantity, null, 'refund_restock',
          'order', new.id, null
        );
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create trigger orders_validate_status_transition
  before update on public.orders
  for each row execute function public.validate_order_status_transition();

-- ---------------------------------------------------------------------------
-- Order lines
-- ---------------------------------------------------------------------------
-- Snapshotted, not looked up live. If the product is repriced, renamed or
-- deleted after this order, the order still shows what the customer actually
-- bought and paid — the frontend already snapshots name/price this way at
-- add-to-cart time; this just makes it a column instead of an assumption.

create table public.order_lines (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,

  name        text not null,
  unit_price  pence not null check (unit_price >= 0),
  -- Staff/analytics only — never returned on a customer-facing order lookup.
  -- That boundary is an API concern; the column exists so margin can be
  -- computed for this order at all.
  cost_price  pence not null default 0 check (cost_price >= 0),
  quantity    integer not null check (quantity > 0),
  line_total  pence generated always as (unit_price * quantity) stored,

  created_at  timestamptz not null default now()
);

create index order_lines_order_idx   on public.order_lines (order_id);
create index order_lines_product_idx on public.order_lines (product_id);

-- Vapes are blocked from the online catalogue in the UI. This is the version
-- that actually matters: nothing can insert a vape line no matter what wrote
-- it, because product_is_purchasable_online() is the same check used to build
-- the catalogue the customer sees.
create or replace function public.order_lines_reject_vape()
returns trigger
language plpgsql
as $$
begin
  if new.product_id is not null
     and not public.product_is_purchasable_online(new.product_id) then
    raise exception 'Product % cannot be sold online', new.product_id;
  end if;
  return new;
end;
$$;

create trigger order_lines_reject_vape
  before insert on public.order_lines
  for each row execute function public.order_lines_reject_vape();

-- ---------------------------------------------------------------------------
-- create_order — the one correct way to place an order
-- ---------------------------------------------------------------------------
-- Takes the lines as jsonb ([{product_id, quantity}, ...]) so the whole order
-- — subtotal, free-delivery rule, zone resolution, delivery fee — is computed
-- from the actual rows inserted rather than trusted from the caller. Nothing
-- about totals is taken on faith.
--
-- Free delivery: if every line is a free_delivery product, delivery is £0.
-- One normal item in the basket and the whole order pays the normal rate —
-- one parcel, one charge, not a per-line split.

create or replace function public.create_order(
  p_lines           jsonb,   -- [{"product_id": "...", "quantity": 2}, ...]
  p_delivery_method delivery_method,
  p_customer_id     uuid default null,
  p_guest_email     citext default null,
  p_recipient_name  text default null,
  p_address_line1   text default null,
  p_address_line2   text default null,
  p_city            text default null,
  p_county          text default null,
  p_postcode        text default null,
  p_discount        pence default 0
)
returns uuid
language plpgsql
as $$
declare
  v_order_id     uuid;
  v_line         jsonb;
  v_product      public.products;
  v_subtotal     pence := 0;
  v_zone_id      uuid;
  v_delivery_fee pence := 0;
  v_all_free     boolean := true;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one line';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;
    if not public.product_is_purchasable_online(v_product.id) then
      raise exception 'Product % cannot be sold online', v_product.id;
    end if;
    v_subtotal := v_subtotal + v_product.price * (v_line ->> 'quantity')::integer;
    if not v_product.free_delivery then
      v_all_free := false;
    end if;
  end loop;

  if p_delivery_method <> 'collect' then
    v_zone_id := public.delivery_zone_for(p_postcode);
    if not v_all_free then
      select price into v_delivery_fee
      from public.delivery_rates
      where zone_id = v_zone_id and method = p_delivery_method;
    end if;
  end if;

  insert into public.orders (
    customer_id, guest_email, delivery_method, delivery_zone_id,
    recipient_name, address_line1, address_line2, city, county, postcode,
    subtotal, delivery_fee, discount
  ) values (
    p_customer_id, p_guest_email, p_delivery_method, v_zone_id,
    p_recipient_name, p_address_line1, p_address_line2, p_city, p_county, p_postcode,
    v_subtotal, v_delivery_fee, p_discount
  )
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    insert into public.order_lines (order_id, product_id, name, unit_price, cost_price, quantity)
    values (
      v_order_id, v_product.id, v_product.name, v_product.price, v_product.cost_price,
      (v_line ->> 'quantity')::integer
    );
  end loop;

  return v_order_id;
end;
$$;

comment on function public.create_order is
  'The only way an order should be created. Computes subtotal, zone and delivery fee from the lines actually inserted — nothing is trusted from the caller.';

-- ---------------------------------------------------------------------------
-- Order documents (number-plate verification)
-- ---------------------------------------------------------------------------
-- A private storage reference and an approval state that the order status
-- trigger above actually reads. This is its own table rather than a row in
-- the generic `documents` table from 0009 — see that file for why: in short,
-- gating ready/shipped needs a fast, direct, indexed link to the order, and
-- these have fields (kind, rejection reason) that don't generalise.

create type document_approval_status as enum ('pending', 'approved', 'rejected');
create type order_document_kind as enum ('v5c', 'driving_licence');

create table public.order_documents (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  kind             order_document_kind not null,
  storage_path     text not null,   -- private bucket only — see 0011. Never a public URL.
  status           document_approval_status not null default 'pending',
  reviewed_by      uuid references public.staff (id),
  reviewed_at      timestamptz,
  rejection_reason text,
  uploaded_at      timestamptz not null default now(),

  constraint order_documents_review_consistency check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);

create index order_documents_order_idx on public.order_documents (order_id);
create index order_documents_reviewed_by_idx on public.order_documents (reviewed_by) where reviewed_by is not null;

comment on table public.order_documents is
  'V5C/V750 and driving-licence uploads for plate orders. A rejected document is a process, not an automatic action: staff contact the customer for originals; if none arrive the order is refunded by hand through 0008''s refund path. Retention (default 30 days, from shop_settings) is purged by a job defined in 0009, once settings exists.';

comment on column public.order_documents.rejection_reason is
  'Shown to the customer when asking for originals. Required by the API when status is set to rejected — not enforced here because the review-consistency check already requires reviewed_by/reviewed_at, and a blank reason is a UX bug, not a data-integrity one.';
