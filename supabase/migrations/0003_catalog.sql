-- 0003 — Catalog
-- Products, suppliers, promotions.
--
-- No variants. One row is one sellable thing: a case in four colours is four
-- rows, each with its own stock count and its own barcode. That's how the
-- frontend already models it, and for a shop this size it's the right call —
-- variants add a whole layer of structure to solve a problem that doesn't
-- exist here.

create type product_kind as enum ('accessory', 'vape', 'plate');

create type product_category as enum (
  'cases', 'power', 'audio', 'protection', 'mounts', 'vape', 'plates'
);

-- Customers see one of three words, never a number. Exact counts, costs and
-- margins are staff-only — a hard business rule, enforced by never exposing
-- stock_qty on any customer-facing query.
create type stock_status as enum ('in-stock', 'out-of-stock', 'restocking');

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
-- Currently a free-typed string on each product, so two products from the same
-- supplier aren't linked by anything but spelling. Made a real record so
-- "what do we buy from Volta" is answerable.

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  contact     text,
  phone       text,
  email       citext,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  sub            text,                              -- short line under the name
  description    text,
  kind           product_kind not null default 'accessory',
  category       product_category not null,

  price          pence not null check (price >= 0),

  -- Weighted average cost. Recalculated whenever stock comes in at a different
  -- price — see 0004. Never edited by hand except as a correction.
  cost_price     pence not null default 0 check (cost_price >= 0),

  -- Running total. Kept in step with stock_movements by trigger, so reads are
  -- fast and the movement history stays the source of truth.
  stock_qty      integer not null default 0 check (stock_qty >= 0),

  -- Manufacturer barcode (EAN/UPC), as typed by the USB scanner.
  -- Unique where present: two products sharing a barcode would resolve to the
  -- wrong one at the till, which is worse than a save failing.
  barcode        text,

  supplier_id    uuid references public.suppliers (id) on delete set null,

  -- Optional low-stock warning, per product, with its own number.
  -- Vapes and plates are switched off in the seed data by design.
  low_stock_alert      boolean not null default false,
  low_stock_threshold  integer not null default 5 check (low_stock_threshold >= 1),

  -- Marked products ship free. If a basket contains anything not marked,
  -- normal delivery applies to the whole order — one parcel, one charge.
  free_delivery  boolean not null default false,

  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index products_barcode_unique_idx
  on public.products (barcode)
  where barcode is not null;

create index products_category_idx on public.products (category) where is_active;
create index products_kind_idx     on public.products (kind);
create index products_supplier_idx on public.products (supplier_id);

-- Low stock is asked for on nearly every admin screen load.
create index products_low_stock_idx
  on public.products (stock_qty)
  where low_stock_alert and is_active;

-- Search. The frontend currently serialises every row to JSON and does a
-- substring match on it, which tells us nothing about what matters — it
-- searches everything because nobody decided. Deciding here: name, sub and
-- barcode. Those are what someone at a till is actually typing.
create index products_search_idx
  on public.products
  using gin (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(sub,'')));

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

comment on column public.products.cost_price is
  'Weighted average cost. Maintained by the stock trigger, not set directly.';

comment on column public.products.stock_qty is
  'Running total, maintained from stock_movements. Never shown to customers.';

-- Vapes can never be bought online. The frontend hides the button; that is UX
-- only and a real order must be rejected server-side regardless.
create or replace function public.product_is_purchasable_online(p_product_id uuid)
returns boolean
language sql
stable
as $$
  select kind <> 'vape' and is_active
  from public.products
  where id = p_product_id;
$$;

-- ---------------------------------------------------------------------------
-- Product images
-- ---------------------------------------------------------------------------
-- An ordered array of URLs today, with "first one is the main image" as an
-- unwritten convention. Made explicit — position is the order, and the main
-- image is position 0.

create table public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  url         text not null,
  alt         text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint product_images_position_unique unique (product_id, position)
);

create index product_images_product_idx
  on public.product_images (product_id, position);

-- ---------------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------------
-- Till only, never online — a hard business rule.
-- Tiers apply to multiples of the same product only. The client confirmed
-- different products never combine toward a tier, so a tier belongs to one
-- product and nothing needs to look across the basket.

create table public.promotions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  label       text,
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_by  uuid references public.staff (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint promotions_dates_sane check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index promotions_product_idx
  on public.promotions (product_id)
  where is_active;

create index promotions_created_by_idx on public.promotions (created_by);

create trigger promotions_updated_at
  before update on public.promotions
  for each row execute function public.set_updated_at();

create table public.promo_tiers (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references public.promotions (id) on delete cascade,
  min_qty       integer not null check (min_qty >= 2),
  unit_price    pence not null check (unit_price >= 0),

  -- Two tiers at the same quantity would leave array order deciding the price
  -- silently, which is how the frontend behaves today. Blocked.
  constraint promo_tiers_qty_unique unique (promotion_id, min_qty)
);

create index promo_tiers_promotion_idx
  on public.promo_tiers (promotion_id, min_qty desc);

comment on table public.promo_tiers is
  'Bulk pricing for multiples of one product. Never spans different products.';
