-- 0060 — Product variants (Round 5 Phase 4 #16), trimmed v1
--
-- 0003_catalog.sql said, deliberately: "No variants. One row is one sellable
-- thing... variants add a whole layer of structure to solve a problem that
-- doesn't exist here." That was the right call for the shop as it was. It
-- isn't anymore — the client wants colour/storage/condition variations on
-- real products, with their own stock, SKU, barcode and price.
--
-- THE SHAPE
-- products stays the parent, completely unchanged in meaning for every
-- product that never gets a variant (has_variants defaults false, and every
-- existing row gets it for free — no backfill, no data migration). A new
-- product_variants table hangs off it: one row per sellable combination,
-- each with its own stock_qty, cost_price, sku, barcode and a price
-- ADJUSTMENT (not a replacement) added to the parent's price. A £0
-- adjustment variant needs no special-casing anywhere that reads price.
--
-- WHAT THIS FILE DOES NOT DO (trimmed v1, per the approved plan)
--   - No variant_option_values normalised table. `options` is jsonb only —
--     enough to drive a picker and label text. Add the normalised table
--     later only if a cross-product "filter by colour" feature is ever
--     actually asked for.
--   - No per-variant bulk pricing. promotions/promo_tiers are untouched —
--     a promotion still targets a product, applies regardless of variant.
--   - No per-variant photos. product_images is untouched; every variant of
--     a product shares the parent's gallery.
--
-- WHAT THIS FILE DOES DO IN FULL, NOT TRIMMED (explicit client instruction)
--   - The full stock ledger split: stock_movements, apply_stock_movement(),
--     stock_consume(), stock_receive() and stock_status_for() all become
--     variant-aware, mirroring the product-level mechanism exactly rather
--     than reimplementing it differently.
--   - Full barcode-to-variant resolution: a variant's barcode uniquely
--     resolves to that variant, same uniqueness guarantee products.barcode
--     already has.
--
-- #15 (unlocking stock / removing cost-averaging) is a separate, still-open
-- decision. Per the approved plan, this migration does not wait on it: the
-- variant-vs-parent split here is unaffected by which way #15 goes, only
-- the internals of the weighted-average math inside apply_stock_movement()
-- would change, and only in the branch that already exists for products
-- today, regardless of variants.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

-- ---------------------------------------------------------------------------
-- products: the fork
-- ---------------------------------------------------------------------------

alter table public.products
  add column has_variants boolean not null default false;

comment on column public.products.has_variants is
  'When true, this product''s own price/stock_qty/cost_price/barcode are frozen and unused — every sellable unit is a row in product_variants instead. Never backfilled: existing products default false and are untouched.';

-- ---------------------------------------------------------------------------
-- product_variants
-- ---------------------------------------------------------------------------

create table public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,

  -- Free-form key/value map, e.g. {"colour":"Black","storage":"128GB"}.
  -- Display order and exact option set are a UI concern, not a schema one —
  -- trimmed v1 deliberately skips a normalised option-values table (see
  -- header). Two variants of the same product with the identical option
  -- set would be indistinguishable at the till, so it's blocked outright.
  options     jsonb not null,
  sku         text not null,
  barcode     text,

  -- Added to products.price, never replaces it. Signed (pence allows
  -- negative) so a smaller/cheaper variant can adjust the price down.
  price_adjustment pence not null default 0,

  -- Independent of the parent's cost_price/stock_qty once has_variants is
  -- true — see apply_stock_movement() below. A Black 128GB and a White
  -- 256GB of the same case genuinely cost different amounts and sit at
  -- different counts; there is no meaningful parent-level aggregate of
  -- either, so none is computed.
  cost_price  pence not null default 0 check (cost_price >= 0),
  stock_qty   integer not null default 0 check (stock_qty >= 0),

  low_stock_alert      boolean not null default false,
  low_stock_threshold  integer not null default 5 check (low_stock_threshold >= 1),

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint product_variants_unique_options unique (product_id, options)
);

create unique index product_variants_sku_unique_idx on public.product_variants (sku);

-- Same posture as products_barcode_unique_idx (0003): unique where present,
-- because two variants sharing a barcode would resolve a scan to the wrong
-- one, which is worse than a save failing.
create unique index product_variants_barcode_unique_idx
  on public.product_variants (barcode)
  where barcode is not null;

create index product_variants_product_idx on public.product_variants (product_id);

-- Same shape as products_low_stock_idx (0003) — asked for on nearly every
-- admin screen load, now per-variant too.
create index product_variants_low_stock_idx
  on public.product_variants (stock_qty)
  where low_stock_alert and is_active;

create trigger product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

comment on table public.product_variants is
  'One row per sellable colour/storage/condition combination of a has_variants product. Mirrors products'' own price/cost/stock/barcode shape one level down, deliberately — see 0060''s header.';
comment on column public.product_variants.price_adjustment is
  'Added to the parent product''s price. Effective price = products.price + product_variants.price_adjustment. A zero adjustment needs no special-casing by any reader.';

-- RLS enabled schema-wide, zero policies (deny-all) — same posture as every
-- other table (0011 and on): a second line of defense if the service-role
-- key ever leaks, not where authorization actually lives.
alter table public.product_variants enable row level security;

-- A variant belongs to a product that actually allows them. Catches the
-- product-level UI/API getting out of step with has_variants (e.g. a
-- variant added to a product nobody flipped the flag on).
create or replace function public.product_variants_require_flag()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.products where id = new.product_id and has_variants
  ) then
    raise exception 'Product % does not have variants enabled', new.product_id;
  end if;
  return new;
end;
$$;

create trigger product_variants_require_flag
  before insert on public.product_variants
  for each row execute function public.product_variants_require_flag();

-- Same reasoning as product_is_purchasable_online() (0003), one level down:
-- a specific colour can be discontinued while the product stays listed and
-- other variants stay purchasable.
create or replace function public.variant_is_purchasable_online(p_variant_id uuid)
returns boolean
language sql
stable
as $$
  select v.is_active and p.kind <> 'vape' and p.is_active
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id;
$$;

-- ---------------------------------------------------------------------------
-- stock_movements: variant-aware
-- ---------------------------------------------------------------------------

alter table public.stock_movements
  add column variant_id uuid references public.product_variants (id) on delete restrict;

create index stock_movements_variant_idx
  on public.stock_movements (variant_id, created_at desc)
  where variant_id is not null;

comment on column public.stock_movements.variant_id is
  'Null for every movement against a plain (non-variant) product — every historical row is untouched by this column''s addition. Set alongside product_id (never instead of it) for a movement against a specific variant.';

-- A movement is against a product OR a specific variant OF that product,
-- never a variant belonging to a different product than product_id names —
-- that mismatch would silently move the wrong shelf's stock. A plain CHECK
-- can't express this (Postgres refuses a subquery inside one), so it's a
-- trigger instead — same mechanism product_variants_require_flag() above
-- already uses for an equivalent cross-row rule.
create or replace function public.stock_movements_variant_matches_product()
returns trigger
language plpgsql
as $$
begin
  if new.variant_id is not null and not exists (
    select 1 from public.product_variants v
    where v.id = new.variant_id and v.product_id = new.product_id
  ) then
    raise exception 'Variant % does not belong to product %', new.variant_id, new.product_id;
  end if;
  return new;
end;
$$;

create trigger stock_movements_variant_matches_product
  before insert on public.stock_movements
  for each row execute function public.stock_movements_variant_matches_product();

-- ---------------------------------------------------------------------------
-- apply_stock_movement(): two branches, same mechanism as before in each
-- ---------------------------------------------------------------------------
-- The pre-0060 body becomes the "else" branch, byte-for-byte in its logic —
-- same weighted-average formula, same FOR UPDATE row lock, same oversell
-- protection via the stock_qty >= 0 check. The new branch is that same
-- logic aimed at product_variants instead of products. This is deliberately
-- NOT a rewrite of the mechanism, only a duplication of it one level down —
-- see the plan's own reasoning for why that's the low-risk shape here.

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  v_qty_before  integer;
  v_cost_before pence;
  v_new_cost    pence;
begin
  if new.variant_id is not null then
    select stock_qty, cost_price
      into v_qty_before, v_cost_before
      from public.product_variants
     where id = new.variant_id
       for update;

    if not found then
      raise exception 'Variant % does not exist', new.variant_id;
    end if;

    if new.qty_delta > 0 and new.unit_cost is not null then
      if v_qty_before > 0 then
        v_new_cost := round(
          ((v_qty_before::numeric * v_cost_before) + (new.qty_delta::numeric * new.unit_cost))
          / (v_qty_before + new.qty_delta)
        )::integer;
      else
        v_new_cost := new.unit_cost;
      end if;
    else
      v_new_cost := v_cost_before;
    end if;

    update public.product_variants
       set stock_qty  = stock_qty + new.qty_delta,
           cost_price = v_new_cost,
           updated_at = now()
     where id = new.variant_id;

    return new;
  end if;

  select stock_qty, cost_price
    into v_qty_before, v_cost_before
    from public.products
   where id = new.product_id
     for update;

  if not found then
    raise exception 'Product % does not exist', new.product_id;
  end if;

  if new.qty_delta > 0 and new.unit_cost is not null then
    if v_qty_before > 0 then
      v_new_cost := round(
        ((v_qty_before::numeric * v_cost_before) + (new.qty_delta::numeric * new.unit_cost))
        / (v_qty_before + new.qty_delta)
      )::integer;
    else
      v_new_cost := new.unit_cost;
    end if;
  else
    v_new_cost := v_cost_before;
  end if;

  update public.products
     set stock_qty  = stock_qty + new.qty_delta,
         cost_price = v_new_cost,
         updated_at = now()
   where id = new.product_id;

  return new;
end;
$$;

comment on function public.apply_stock_movement is
  'Two branches: variant_id present -> applies to product_variants (weighted-average cost, row lock, oversell check, identical mechanism to the product branch). variant_id null -> the original product-level behaviour, byte-for-byte unchanged. Added in 0060.';

-- ---------------------------------------------------------------------------
-- stock_consume() / stock_receive(): thread the variant through
-- ---------------------------------------------------------------------------
-- p_variant_id defaults null, so every existing caller (POS sales, refunds,
-- receipts against plain products) compiles and behaves identically with no
-- change at the call site.
--
-- DROP first: CREATE OR REPLACE does not replace a function whose parameter
-- list differs (a new trailing parameter is a different signature to
-- Postgres, not the same function with a default added) — it creates a
-- SECOND, overloaded function instead. Left un-dropped, a call using the
-- old (fewer-argument) form becomes ambiguous between the two overloads
-- and fails outright. Found exactly that way, testing the "still works
-- exactly as before" claim against dev.
drop function if exists public.stock_consume(uuid, integer, stock_movement_kind, text, uuid, uuid, text);
drop function if exists public.stock_receive(uuid, integer, pence, stock_movement_kind, text, uuid, uuid, text);

create or replace function public.stock_consume(
  p_product_id  uuid,
  p_qty         integer,
  p_kind        stock_movement_kind,
  p_source_type text default null,
  p_source_id   uuid default null,
  p_staff_id    uuid default null,
  p_reason      text default null,
  p_variant_id  uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_qty <= 0 then
    raise exception 'Quantity must be positive, got %', p_qty;
  end if;

  insert into public.stock_movements
    (product_id, variant_id, kind, qty_delta, source_type, source_id, staff_id, reason)
  values
    (p_product_id, p_variant_id, p_kind, -p_qty, p_source_type, p_source_id, p_staff_id, p_reason)
  returning id into v_id;

  return v_id;
exception
  when check_violation then
    raise exception 'Not enough stock for product %', coalesce(p_variant_id, p_product_id)
      using hint = 'Check the shelf count before completing the sale.';
end;
$$;

create or replace function public.stock_receive(
  p_product_id  uuid,
  p_qty         integer,
  p_unit_cost   pence,
  p_kind        stock_movement_kind default 'receipt',
  p_source_type text default null,
  p_source_id   uuid default null,
  p_staff_id    uuid default null,
  p_reason      text default null,
  p_variant_id  uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_qty <= 0 then
    raise exception 'Quantity must be positive, got %', p_qty;
  end if;

  insert into public.stock_movements
    (product_id, variant_id, kind, qty_delta, unit_cost, source_type, source_id, staff_id, reason)
  values
    (p_product_id, p_variant_id, p_kind, p_qty, p_unit_cost, p_source_type, p_source_id, p_staff_id, p_reason)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- stock_status_for(): variant-aware overload
-- ---------------------------------------------------------------------------
-- The single-arg signature is untouched (every non-variant caller keeps
-- calling it exactly as before). A second, variant-aware signature covers
-- the has_variants path — its own 30-day "receipt in the last 30 days"
-- restocking window is evaluated per-variant, not per-product: a Black
-- case being restocked doesn't make White "restocking" if White never sold
-- out.

-- language plpgsql, not sql: the obvious `select case ... end from
-- product_variants where id = p_variant_id` shape is a trap when
-- p_variant_id is null — `where id = null` is never true, so the FROM
-- produces zero rows and the whole function returns NULL regardless of
-- what the CASE's own "p_variant_id is null" branch says, because that
-- branch is never reached. Found by testing, not by reading: the
-- direct-SQL translation of this migration's own pgTAP suite hit it as a
-- NOT NULL violation on the first real call with a null variant_id. An
-- explicit early RETURN sidesteps the whole problem.
create or replace function public.stock_status_for(p_product_id uuid, p_variant_id uuid)
returns stock_status
language plpgsql
stable
as $$
declare
  v_stock_qty integer;
begin
  if p_variant_id is null then
    return public.stock_status_for(p_product_id);
  end if;

  select stock_qty into v_stock_qty from public.product_variants where id = p_variant_id;

  if v_stock_qty > 0 then
    return 'in-stock'::stock_status;
  elsif exists (
    select 1 from public.stock_movements m
    where m.variant_id = p_variant_id
      and m.kind = 'receipt'
      and m.created_at > now() - interval '30 days'
  ) then
    return 'restocking'::stock_status;
  else
    return 'out-of-stock'::stock_status;
  end if;
end;
$$;

comment on function public.stock_status_for(uuid, uuid) is
  'Variant-aware overload (0060). p_variant_id null delegates to the original single-arg stock_status_for() unchanged; otherwise evaluates the same in-stock/restocking/out-of-stock rule against product_variants.stock_qty and stock_movements.variant_id.';

-- ---------------------------------------------------------------------------
-- low_stock_products: union in variant rows
-- ---------------------------------------------------------------------------
-- DROP first: adding a UNION changes the view's provenance enough that
-- CREATE OR REPLACE's "same column names, types and order" requirement is
-- safer to satisfy by starting clean than by trusting it holds by eye.
-- variant_id is null on every product-level row (existing callers keyed on
-- id/name/category/stock_qty/low_stock_threshold are unaffected — those
-- columns keep the exact same meaning they always had); a variant row's `id`
-- is the VARIANT's id and `name` includes the parent product's name so the
-- existing admin widget reads something meaningful without changes.

drop view if exists public.low_stock_products;

create view public.low_stock_products as
select p.id, p.name, c.slug as category, p.stock_qty, p.low_stock_threshold,
       null::uuid as variant_id
from public.products p
join public.categories c on c.id = p.category_id
where p.is_active
  and not p.has_variants
  and p.low_stock_alert
  and p.stock_qty > 0
  and p.stock_qty <= p.low_stock_threshold
union all
select v.id, p.name || ' — ' || (
       select string_agg(value::text, ', ')
       from jsonb_each_text(v.options)
     ) as name,
     c.slug as category, v.stock_qty, v.low_stock_threshold,
     v.id as variant_id
from public.product_variants v
join public.products p on p.id = v.product_id
join public.categories c on c.id = p.category_id
where p.is_active
  and v.is_active
  and v.low_stock_alert
  and v.stock_qty > 0
  and v.stock_qty <= v.low_stock_threshold;

comment on view public.low_stock_products is
  'Product-level rows (variant_id null, unchanged meaning) unioned with per-variant rows (variant_id set, name includes the parent product name + options) for has_variants products. Extended in 0060 — see 0043/0046 for the product-level rule this preserves exactly.';

-- ---------------------------------------------------------------------------
-- order_lines / sale_lines / refund_lines: additive variant_id
-- ---------------------------------------------------------------------------
-- Nullable, no backfill, no change to any existing row's meaning. A line
-- against a plain product has variant_id null forever, same as today.

alter table public.order_lines  add column variant_id uuid references public.product_variants (id) on delete set null;
alter table public.sale_lines   add column variant_id uuid references public.product_variants (id) on delete set null;
alter table public.refund_lines add column variant_id uuid references public.product_variants (id) on delete set null;

create index order_lines_variant_idx  on public.order_lines  (variant_id) where variant_id is not null;
create index sale_lines_variant_idx   on public.sale_lines   (variant_id) where variant_id is not null;
create index refund_lines_variant_idx on public.refund_lines (variant_id) where variant_id is not null;

-- order_lines_reject_vape() (0005) already checks product_is_purchasable_online()
-- at the product/kind level, which stays correct regardless of variants — a
-- vape product has no variants in practice and the kind check is unaffected.
-- Extended here only to also reject a variant that's been individually
-- deactivated while the parent stays listed.
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

  return new;
end;
$$;
