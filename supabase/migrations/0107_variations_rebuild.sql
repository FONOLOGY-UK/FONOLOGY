-- 0107 — product variations, rebuilt
--
-- Client spec "Product Variation Feature — Requirements & Behaviour Specification, Complete
-- Rebuild" (v1.0, 8 Oct 2026). The 0060 variants did not save reliably and never showed properly
-- on the product page; the client asked for them to be removed and rebuilt. Every variant row is
-- test data, so this wipes them (no data migration — the spec says so in as many words) and
-- every product becomes a plain product again.
--
-- WHAT STAYS FROM 0060, AND WHY
-- product_variants itself stays as the one sellable row of a variation product. Everything that
-- moves money or stock already knows it: stock_movements, sale/order/refund lines, goods in, the
-- change log, and the master list's cross-shop matching (a variant is matched across shop copies
-- by its `options`, e.g. {"Colour":"Black","Compatibility":"iPhone 13"}). Replacing the table
-- would mean rewriting all of those for no change in behaviour. What changes is everything the
-- spec describes:
--
--   * A variation has its OWN selling price (`price`), not an adjustment on the parent's. The
--     parent is a placeholder: it is never sold, and its `price` is kept equal to the default
--     variation's by trigger, so lists, cards and price sorting read the right figure without
--     knowing about variations.
--   * No SKU, anywhere (spec §9) — the column goes.
--   * Option TYPES and VALUES are real rows now (product_variant_types / _values), so the admin
--     can order them by drag and drop and a colour value can carry its swatch. A variation's
--     `options` map is still the combination key; the API keeps it in step with these rows.
--   * Optional per-variation details — title, description, badge, compatibility, supplier,
--     pictures. NULL (no pictures) means "use the parent's", so a parent edit reaches every
--     variation that was not given its own.
--   * Exactly one default variation per product, which must be live and enabled.
--   * "Deleting" a variation removes it (`removed_at`): it can carry sale history that
--     stock_movements will not let go of (ON DELETE RESTRICT), so the row stays, disabled, and
--     every reader treats it as gone. The live-options index ignores removed rows, so a value
--     deleted and added back again makes fresh variations.

-- ---------------------------------------------------------------------------
-- 1. Wipe the old variations
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from public.job_parts jp
      join public.stock_movements m on m.id = jp.stock_movement_id
     where m.variant_id is not null
  ) then
    raise exception 'A repair job used a variant''s stock — wipe that by hand before 0107';
  end if;
end
$$;

-- The ledger and goods-in lines refuse deletes by design; this one clean-up is the exception.
alter table public.stock_intake_lines disable trigger stock_intake_lines_immutable;
alter table public.stock_movements disable trigger stock_movements_immutable;
delete from public.stock_intake_lines where variant_id is not null;
delete from public.stock_movements where variant_id is not null;
alter table public.stock_movements enable trigger stock_movements_immutable;
alter table public.stock_intake_lines enable trigger stock_intake_lines_immutable;

-- order/sale/refund lines keep their rows (ON DELETE SET NULL on variant_id).
delete from public.product_variants;
update public.products set has_variants = false where has_variants;

-- ---------------------------------------------------------------------------
-- 2. product_variants: own price, optional details, default, removal; no SKU
-- ---------------------------------------------------------------------------

alter table public.product_variants
  drop constraint product_variants_unique_options,
  drop column sku,
  drop column price_adjustment,
  add column price pence not null check (price >= 0),
  add column name text check (name is null or btrim(name) <> ''),
  add column description text,
  add column tag text check (tag is null or btrim(tag) <> ''),
  add column compatibility text check (compatibility is null or btrim(compatibility) <> ''),
  add column supplier_id uuid references public.suppliers (id) on delete set null,
  add column is_default boolean not null default false,
  add column removed_at timestamptz,
  add constraint product_variants_removed_is_disabled
    check (removed_at is null or not is_active),
  add constraint product_variants_default_is_live
    check (not is_default or (is_active and removed_at is null));

create unique index product_variants_live_options_idx
  on public.product_variants (product_id, options) where removed_at is null;
create unique index product_variants_one_default_idx
  on public.product_variants (product_id) where is_default;
create index product_variants_supplier_idx
  on public.product_variants (supplier_id) where supplier_id is not null;

comment on column public.product_variants.price is
  'This variation''s own selling price (0107). Replaces 0060''s price_adjustment.';
comment on column public.product_variants.name is
  'Optional title for this variation; NULL = the parent''s name. Same NULL-means-inherit rule for description, tag, compatibility and supplier_id.';
comment on column public.product_variants.is_default is
  'The one variation the product page opens on and the shop card prices and pictures (0107). Must be live and enabled.';
comment on column public.product_variants.removed_at is
  'Set when the variation is deleted (its option value was removed). Kept for its history, never shown or sold again.';

-- The parent is a placeholder: its price follows the default variation, so every reader of
-- products.price (lists, cards, sorting, the online price) gets the price the customer sees first.
create function public.variants_sync_parent_price() returns trigger
language plpgsql
as $$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
  v_price   pence;
begin
  select price into v_price from public.product_variants where product_id = v_product and is_default;
  if found then
    update public.products set price = v_price where id = v_product and price is distinct from v_price;
  end if;
  return null;
end
$$;

create trigger product_variants_sync_parent_price
  after insert or update of price, is_default on public.product_variants
  for each row execute function public.variants_sync_parent_price();

-- ---------------------------------------------------------------------------
-- 3. Option types, values and per-variation pictures
-- ---------------------------------------------------------------------------

create table public.product_variant_types (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name       text not null check (btrim(name) <> '' and length(name) <= 40),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index product_variant_types_name_idx
  on public.product_variant_types (product_id, lower(name));
comment on table public.product_variant_types is
  'An option a variation product varies by, e.g. Colour, Compatibility (0107). `position` is the storefront order. A type whose name says colour shows its values as swatches.';

create table public.product_variant_values (
  id         uuid primary key default gen_random_uuid(),
  type_id    uuid not null references public.product_variant_types (id) on delete cascade,
  value      text not null check (btrim(value) <> '' and length(value) <= 60),
  position   integer not null default 0,
  swatch_hex text check (swatch_hex ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now()
);
create unique index product_variant_values_value_idx
  on public.product_variant_values (type_id, lower(value));
create index product_variant_values_type_idx on public.product_variant_values (type_id, position);
comment on table public.product_variant_values is
  'One choice within an option type, e.g. Black (0107). swatch_hex is the colour swatch, set on colour types only.';

create table public.product_variant_images (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  url        text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_variant_images_variant_idx on public.product_variant_images (variant_id, position);
create index product_variant_images_url_idx on public.product_variant_images (url);
comment on table public.product_variant_images is
  'A variation''s own pictures (0107). None = the parent''s pictures are shown.';

alter table public.product_variant_types enable row level security;
alter table public.product_variant_types force row level security;
alter table public.product_variant_values enable row level security;
alter table public.product_variant_values force row level security;
alter table public.product_variant_images enable row level security;
alter table public.product_variant_images force row level security;

-- ---------------------------------------------------------------------------
-- 4. The parent is never sold — online or at the till
-- ---------------------------------------------------------------------------

create or replace function public.order_lines_reject_vape()
returns trigger
language plpgsql
as $$
begin
  if new.product_id is not null
     and not public.product_is_purchasable_online(new.product_id) then
    raise exception 'Product % cannot be sold online', new.product_id;
  end if;

  if new.variant_id is not null
     and not public.variant_is_purchasable_online(new.variant_id) then
    raise exception 'Variant % cannot be sold online', new.variant_id;
  end if;

  if new.variant_id is null and new.product_id is not null and exists (
    select 1 from public.products where id = new.product_id and has_variants
  ) then
    raise exception 'Choose an option of product % before buying it', new.product_id;
  end if;

  return new;
end;
$$;

create function public.sale_lines_require_variant() returns trigger
language plpgsql
as $$
begin
  if new.variant_id is null and new.product_id is not null and exists (
    select 1 from public.products where id = new.product_id and has_variants
  ) then
    raise exception 'Choose an option of product % before selling it', new.product_id;
  end if;
  return new;
end
$$;

create trigger sale_lines_require_variant
  before insert on public.sale_lines
  for each row execute function public.sale_lines_require_variant();

-- ---------------------------------------------------------------------------
-- 5. Functions that read the old price_adjustment / sku
-- ---------------------------------------------------------------------------

-- The highest price among the shop copies (per variation, matched by options), as before —
-- only now a variation's price is its own.
create or replace function public.online_unit_price(p_product_id uuid, p_variant_id uuid default null)
returns pence
language sql
stable
as $$
  select max(coalesce(v.price, c.price))::integer::pence
    from public.online_copies c
    left join public.product_variants v
           on v.product_id = c.product_id and v.is_active and p_variant_id is not null
          and v.options = (select options from public.product_variants where id = p_variant_id)
   where c.master_id = public.online_master_of(p_product_id)
     and (p_variant_id is null or v.id is not null);
$$;

-- "Add Product from Master List": now also copies the option types and values, every live
-- variation (its own price, details, default and pictures; cost and stock start at zero, each
-- shop counts its own) — the same rule as the parent.
create or replace function public.copy_master_to_shop(p_master_id uuid, p_shop_id uuid, p_staff_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_src      public.online_products;
  v_rep      public.products;
  v_new      uuid;
  v_variant  public.product_variants;
  v_type     public.product_variant_types;
  v_new_type uuid;
  v_new_var  uuid;
begin
  select * into v_src from public.online_products where master_id = p_master_id;
  if not found then
    select * into v_rep from public.products where master_product_id = p_master_id order by created_at limit 1;
    if not found then
      raise exception 'That master product no longer exists';
    end if;
  else
    select * into v_rep from public.products where id = v_src.id;
  end if;

  if exists (select 1 from public.products where shop_id = p_shop_id and master_product_id = p_master_id) then
    raise exception 'This shop already has a copy of that master product';
  end if;

  insert into public.products (
    slug, name, sub, description, category_id, price, cost_price, stock_qty, barcode, supplier_id,
    low_stock_alert, low_stock_threshold, in_store_only, tag, compatibility, has_variants,
    free_delivery, shop_id, master_product_id
  ) values (
    v_rep.slug || '-' || substr(gen_random_uuid()::text, 1, 8),
    v_rep.name, v_rep.sub, v_rep.description, v_rep.category_id,
    coalesce(v_src.price, v_rep.price), 0, 0, v_rep.barcode, null,
    v_rep.low_stock_alert, v_rep.low_stock_threshold, v_rep.in_store_only, v_rep.tag,
    v_rep.compatibility, v_rep.has_variants, v_rep.free_delivery, p_shop_id, p_master_id
  )
  returning id into v_new;

  insert into public.product_images (product_id, url, position)
  select v_new, url, position from public.product_images where product_id = v_rep.id;

  if v_rep.has_variants then
    for v_type in select * from public.product_variant_types where product_id = v_rep.id loop
      insert into public.product_variant_types (product_id, name, position)
      values (v_new, v_type.name, v_type.position)
      returning id into v_new_type;
      insert into public.product_variant_values (type_id, value, position, swatch_hex)
      select v_new_type, value, position, swatch_hex
        from public.product_variant_values where type_id = v_type.id;
    end loop;

    for v_variant in
      select * from public.product_variants where product_id = v_rep.id and removed_at is null
      order by is_default desc
    loop
      insert into public.product_variants (
        product_id, options, barcode, price, cost_price, stock_qty, low_stock_alert,
        low_stock_threshold, is_active, is_default, name, description, tag, compatibility,
        supplier_id
      ) values (
        v_new, v_variant.options, v_variant.barcode, v_variant.price, 0, 0,
        v_variant.low_stock_alert, v_variant.low_stock_threshold, v_variant.is_active,
        v_variant.is_default, v_variant.name, v_variant.description, v_variant.tag,
        v_variant.compatibility, v_variant.supplier_id
      )
      returning id into v_new_var;
      insert into public.product_variant_images (variant_id, url, position)
      select v_new_var, url, position from public.product_variant_images where variant_id = v_variant.id;
    end loop;
  end if;

  return v_new;
end;
$$;

-- Log B (0104): the variation columns that exist now.
create or replace function public.log_product_change()
returns trigger
language plpgsql
as $$
declare
  v_new        jsonb := to_jsonb(new);
  v_old        jsonb;
  v_variant    boolean := tg_table_name = 'product_variants';
  v_cols       text[];
  v_col        text;
  v_actor      uuid := public.current_actor();
  v_actor_name text;
  v_product_id uuid;
  v_variant_id uuid;
  v_name       text;
  v_label      text;
begin
  if v_actor is not null then
    select name into v_actor_name from public.staff where id = v_actor;
  end if;

  if v_variant then
    v_product_id := (v_new ->> 'product_id')::uuid;
    v_variant_id := (v_new ->> 'id')::uuid;
    select name into v_name from public.products where id = v_product_id;
    select string_agg(value, ', ') into v_label from jsonb_each_text(v_new -> 'options');
    v_cols := array['options', 'barcode', 'price', 'cost_price', 'name', 'description', 'tag',
                    'compatibility', 'supplier_id', 'is_default', 'low_stock_alert',
                    'low_stock_threshold'];
  else
    v_product_id := (v_new ->> 'id')::uuid;
    v_name := v_new ->> 'name';
    v_cols := array['name', 'sub', 'description', 'category_id', 'price', 'cost_price', 'barcode',
                    'imei', 'supplier_id', 'low_stock_alert', 'low_stock_threshold', 'in_store_only',
                    'tag', 'compatibility', 'has_variants', 'free_delivery'];
  end if;

  if tg_op = 'INSERT' then
    insert into public.inventory_change_log
      (shop_id, product_id, variant_id, product_name, variant_label, change, new_value, actor_id, actor_name)
    values
      ((v_new ->> 'shop_id')::uuid, v_product_id, v_variant_id, coalesce(v_name, ''), v_label, 'created',
       jsonb_build_object('price', v_new -> 'price', 'stock_qty', v_new -> 'stock_qty'),
       v_actor, v_actor_name);
    return null;
  end if;

  v_old := to_jsonb(old);

  if (v_old -> 'is_active') is distinct from (v_new -> 'is_active') then
    insert into public.inventory_change_log
      (shop_id, product_id, variant_id, product_name, variant_label, change, field, old_value, new_value,
       actor_id, actor_name)
    values
      ((v_new ->> 'shop_id')::uuid, v_product_id, v_variant_id, coalesce(v_name, ''), v_label,
       case when (v_new ->> 'is_active')::boolean then 'restored' else 'retired' end,
       'is_active', v_old -> 'is_active', v_new -> 'is_active', v_actor, v_actor_name);
  end if;

  foreach v_col in array v_cols loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      insert into public.inventory_change_log
        (shop_id, product_id, variant_id, product_name, variant_label, change, field, old_value, new_value,
         actor_id, actor_name)
      values
        ((v_new ->> 'shop_id')::uuid, v_product_id, v_variant_id, coalesce(v_name, ''), v_label, 'field',
         v_col, v_old -> v_col, v_new -> v_col, v_actor, v_actor_name);
    end if;
  end loop;

  return null;
end;
$$;

-- A disabled variation is hidden, not retired: its stock is still on the shelf. Only a removed
-- one (or a retired parent) counts as retired stock.
create or replace function public.inventory_summary(p_shop_id uuid default null)
returns table(total_stock integer, total_value_pence pence, retired_stock integer, retired_value_pence pence)
language sql
stable
as $$
  select
    coalesce(sum(units), 0)::integer                                as total_stock,
    coalesce(sum(units * unit_cost), 0)::integer                    as total_value_pence,
    coalesce(sum(units) filter (where retired), 0)::integer         as retired_stock,
    coalesce(sum(units * unit_cost) filter (where retired), 0)::integer
                                                                    as retired_value_pence
  from (
    select p.stock_qty as units, p.cost_price as unit_cost, not p.is_active as retired
    from public.products p
    where not p.has_variants and (p_shop_id is null or p.shop_id = p_shop_id)

    union all

    select v.stock_qty, v.cost_price, not p.is_active or v.removed_at is not null
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where p.has_variants and (p_shop_id is null or p.shop_id = p_shop_id)
  ) combined;
$$;
