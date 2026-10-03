-- 0096 — shops (stage 3, multi-shop, step 1).
--
-- A shop is a row, not code: Shop 2 is an insert. Everything that belongs to one
-- till gets a shop_id; existing data becomes Shop 1.
--
-- TRANSITION: every shop_id column defaults to default_shop_id() (the hub shop), so
-- the API as it stands today keeps working unchanged. Once the API passes the shop
-- explicitly (step 2) a later migration drops these defaults — a forgotten shop_id
-- must then be an error, not silently Shop 1.
--
-- shop_settings keeps its per-shop columns for now (the API still reads them there);
-- they were COPIED into Shop 1 below and stop being read when step 2 lands.

create table public.shops (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,                       -- short prefix: S1, S2 … (temporary numbering prefix)
  name               text not null,
  sort_order         integer not null default 0,          -- stock is taken from lower numbers first
  is_fulfilment_hub  boolean not null default false,      -- online orders, repairs, trade-ins land here
  is_active          boolean not null default true,
  address            text,
  phone              text,
  email              citext,
  opening_hours      jsonb not null default '[]'::jsonb,
  receipt_header_text text,
  receipt_footer_text text,
  float_target       pence,
  printer_config     jsonb not null default '{}'::jsonb,
  card_machine_labels jsonb not null default '{}'::jsonb,
  card1_daily_limit   pence, card1_weekly_limit   pence, card1_monthly_limit   pence,
  card2_daily_limit   pence, card2_weekly_limit   pence, card2_monthly_limit   pence,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint shops_code_unique unique (code),
  constraint shops_code_shape check (code ~ '^[A-Z0-9]{1,6}$')
);

-- exactly one hub
create unique index shops_one_hub_idx on public.shops ((true)) where is_fulfilment_hub;

create trigger shops_updated_at
  before update on public.shops
  for each row execute function public.set_updated_at();

alter table public.shops enable row level security;
alter table public.shops force row level security;

insert into public.shops (code, name, sort_order, is_fulfilment_hub, address, phone, email, opening_hours,
                          receipt_header_text, receipt_footer_text, float_target, printer_config, card_machine_labels,
                          card1_daily_limit, card1_weekly_limit, card1_monthly_limit,
                          card2_daily_limit, card2_weekly_limit, card2_monthly_limit)
select 'S1', coalesce(nullif(shop_name, ''), 'Fonology'), 1, true, shop_address, shop_phone, shop_email, opening_hours,
       receipt_header_text, receipt_footer_text, float_target, printer_config, card_machine_labels,
       card1_daily_limit, card1_weekly_limit, card1_monthly_limit,
       card2_daily_limit, card2_weekly_limit, card2_monthly_limit
from public.shop_settings;

create function public.default_shop_id() returns uuid
language sql stable
as $$ select id from public.shops where is_fulfilment_hub $$;

comment on function public.default_shop_id is
  'The hub shop (Shop 1). Column default for shop_id during the transition; dropped once the API passes the shop explicitly.';

-- ---------------------------------------------------------------------------
-- shop_id on everything a till owns
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'staff', 'products', 'product_variants', 'stock_movements',
    'sales', 'refunds', 'jobs', 'job_payments', 'bookings', 'repair_enquiries',
    'sell_requests', 'trade_in_payouts', 'cash_entries', 'day_close',
    'print_agents', 'print_jobs'
  ] loop
    execute format(
      'alter table public.%I add column shop_id uuid not null default public.default_shop_id() references public.shops(id)', t);
    execute format('create index %I on public.%I (shop_id)', t || '_shop_idx', t);
  end loop;
end $$;

-- Owners are global and, from step 2, have no shop. Employees and managers always do.
alter table public.staff alter column shop_id drop not null;
alter table public.staff add constraint staff_shop_required
  check (role = 'owner' or shop_id is not null);

-- Online orders: the shop that physically dispatches (always the hub for now).
alter table public.orders
  add column fulfilment_shop_id uuid not null default public.default_shop_id() references public.shops(id);
create index orders_fulfilment_shop_idx on public.orders (fulfilment_shop_id);

-- A variant belongs to its product's shop. Kept in step by trigger so per-shop
-- SKU/barcode uniqueness can be a plain index.
create function public.variant_inherit_shop() returns trigger
language plpgsql as $$
begin
  select shop_id into new.shop_id from public.products where id = new.product_id;
  return new;
end $$;

create trigger product_variants_inherit_shop
  before insert on public.product_variants
  for each row execute function public.variant_inherit_shop();

-- ---------------------------------------------------------------------------
-- Uniqueness that was "one per business" becomes "one per shop"
-- (index names kept so error mapping by constraint name still works)
-- ---------------------------------------------------------------------------

alter table public.day_close drop constraint day_close_trading_day_key;
alter table public.day_close add constraint day_close_shop_day_key unique (shop_id, trading_day);

drop index public.cash_entries_one_float_open_per_day;
create unique index cash_entries_one_float_open_per_day
  on public.cash_entries (shop_id, trading_day) where kind = 'float_open';

drop index public.print_agents_single_primary_idx;
create unique index print_agents_single_primary_idx
  on public.print_agents (shop_id) where is_primary and revoked_at is null;

-- Linked copies in different shops carry the same barcode/SKU on purpose.
drop index public.products_barcode_unique_idx;
create unique index products_barcode_unique_idx
  on public.products (shop_id, barcode) where barcode is not null;

drop index public.product_variants_sku_unique_idx;
create unique index product_variants_sku_unique_idx on public.product_variants (shop_id, sku);

drop index public.product_variants_barcode_unique_idx;
create unique index product_variants_barcode_unique_idx
  on public.product_variants (shop_id, barcode) where barcode is not null;

-- ---------------------------------------------------------------------------
-- Promotions run per shop: no row = off there
-- ---------------------------------------------------------------------------

create table public.promotion_shops (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  shop_id      uuid not null references public.shops(id),
  primary key (promotion_id, shop_id)
);
create index promotion_shops_shop_idx on public.promotion_shops (shop_id);
alter table public.promotion_shops enable row level security;
alter table public.promotion_shops force row level security;

insert into public.promotion_shops (promotion_id, shop_id)
select id, public.default_shop_id() from public.promotions;
