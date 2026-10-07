-- 0103 — Goods in: stock arriving, booked in on the till (Log A)
-- ---------------------------------------------------------------------------
-- Client change request (October 2026, "Fonology Remaining Features" #4): two
-- inventory logs per shop that are never combined. Log A is the manual record
-- of stock ARRIVING — a delivery from a supplier, booked in at the till. Log B
-- (0104) is the automatic trail of every change to a product.
--
-- A delivery is a header (who, which shop, which supplier, their reference)
-- and its lines. Booking it in moves stock through stock_receive() exactly as
-- before — one 'receipt' movement per line, source 'stock_intake' — so the
-- running totals, the 30-day "restocking" badge and the cost price behave as
-- they always have. Typing a new total on the product screen is NOT a
-- delivery and never appears here.
--
-- The shop is the person's own (staff_shop), as for a till sale: an owner with
-- no shop can't book a delivery in. Staff without costs.view may enter a unit
-- cost — they just never read one back (apps/api lib/costs.ts) — and a line
-- with no cost keeps the product's current cost rather than zeroing it.
--
-- Both tables are history: no update, no delete.

create table public.stock_intakes (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique,
  shop_id       uuid not null references public.shops (id),
  supplier_id   uuid references public.suppliers (id),
  -- As typed, so the record still reads right if the supplier row is renamed.
  supplier_name text,
  supplier_ref  text,
  notes         text,
  staff_id      uuid not null references public.staff (id),
  created_at    timestamptz not null default now()
);

create index stock_intakes_shop_idx on public.stock_intakes (shop_id, created_at desc);
create index stock_intakes_supplier_idx on public.stock_intakes (supplier_id);
create index stock_intakes_staff_idx on public.stock_intakes (staff_id);

comment on table public.stock_intakes is
  'Log A — stock arriving, booked in on the till. Never combined with the change log (0104). Immutable.';

create table public.stock_intake_lines (
  id                uuid primary key default gen_random_uuid(),
  intake_id         uuid not null references public.stock_intakes (id),
  product_id        uuid not null references public.products (id),
  variant_id        uuid references public.product_variants (id),
  qty               integer not null check (qty > 0),
  unit_cost         pence not null check (unit_cost >= 0),
  stock_movement_id uuid not null references public.stock_movements (id)
);

create index stock_intake_lines_intake_idx on public.stock_intake_lines (intake_id);
create index stock_intake_lines_product_idx on public.stock_intake_lines (product_id);
create index stock_intake_lines_variant_idx on public.stock_intake_lines (variant_id);
create index stock_intake_lines_movement_idx on public.stock_intake_lines (stock_movement_id);

comment on table public.stock_intake_lines is
  'One product (or variant) on a goods-in record, with the receipt movement it made.';

-- GIN-1234 at the hub, S2-GIN-1235 elsewhere (0100's prefix rule).
create function public.stock_intakes_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('stock_intake', new.id, public.shop_ref_prefix(new.shop_id, 'GIN'));
  return new;
end;
$$;

create trigger stock_intakes_set_reference
  before insert on public.stock_intakes
  for each row execute function public.stock_intakes_set_reference();

create function public.block_stock_intake_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'Goods-in records cannot be changed or deleted. Book a correction on the product instead.';
end;
$$;

create trigger stock_intakes_immutable
  before update or delete on public.stock_intakes
  for each row execute function public.block_stock_intake_change();

create trigger stock_intake_lines_immutable
  before update or delete on public.stock_intake_lines
  for each row execute function public.block_stock_intake_change();

alter table public.stock_intakes enable row level security;
alter table public.stock_intakes force row level security;
alter table public.stock_intake_lines enable row level security;
alter table public.stock_intake_lines force row level security;

-- ---------------------------------------------------------------------------
-- Booking a delivery in
-- ---------------------------------------------------------------------------

create function public.record_stock_intake(
  p_staff_id      uuid,
  p_lines         jsonb,   -- [{"product_id": "...", "variant_id": null, "qty": 3, "unit_cost": 450}, ...]
  p_supplier_name text default null,
  p_supplier_ref  text default null,
  p_notes         text default null
)
returns uuid
language plpgsql
as $$
declare
  v_shop        uuid := public.staff_shop(p_staff_id);
  v_intake_id   uuid;
  v_supplier_id uuid;
  v_supplier    text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  v_line        jsonb;
  v_product     public.products;
  v_variant     public.product_variants;
  v_variant_id  uuid;
  v_qty         integer;
  v_cost        integer;
  v_movement_id uuid;
begin
  if v_shop is null then
    raise exception 'This account is not assigned to a shop, so it cannot book stock in';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A delivery needs at least one line';
  end if;

  if v_supplier is not null then
    select id into v_supplier_id
      from public.suppliers
     where lower(name) = lower(v_supplier)
     order by is_active desc
     limit 1;
    if not found then
      insert into public.suppliers (name) values (v_supplier) returning id into v_supplier_id;
    end if;
  end if;

  insert into public.stock_intakes (shop_id, supplier_id, supplier_name, supplier_ref, notes, staff_id)
  values (
    v_shop, v_supplier_id, v_supplier,
    nullif(btrim(coalesce(p_supplier_ref, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_staff_id
  )
  returning id into v_intake_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;
    if v_product.shop_id <> v_shop then
      raise exception 'Product % belongs to another shop', v_product.id;
    end if;
    if not v_product.is_active then
      raise exception '"%" has been retired — restore it before booking stock in', v_product.name;
    end if;

    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
    if v_variant_id is null and v_product.has_variants then
      raise exception 'Choose which option of "%" arrived', v_product.name;
    end if;
    if v_variant_id is not null then
      select * into v_variant
        from public.product_variants
       where id = v_variant_id and product_id = v_product.id;
      if not found then
        raise exception 'Variant % is not an option of "%"', v_variant_id, v_product.name;
      end if;
      if not v_variant.is_active then
        raise exception 'That option of "%" has been removed', v_product.name;
      end if;
    end if;

    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Each line needs a quantity of at least 1';
    end if;

    -- No cost entered: keep what the product already costs, so a delivery booked in by
    -- someone who doesn't know the price never zeroes it.
    v_cost := coalesce(
      nullif(v_line ->> 'unit_cost', '')::integer,
      case when v_variant_id is not null then v_variant.cost_price else v_product.cost_price end
    );
    if v_cost < 0 then
      raise exception 'A unit cost can''t be negative';
    end if;

    v_movement_id := public.stock_receive(
      p_product_id  => v_product.id,
      p_qty         => v_qty,
      p_unit_cost   => v_cost,
      p_kind        => 'receipt',
      p_source_type => 'stock_intake',
      p_source_id   => v_intake_id,
      p_staff_id    => p_staff_id,
      p_variant_id  => v_variant_id
    );

    insert into public.stock_intake_lines (intake_id, product_id, variant_id, qty, unit_cost, stock_movement_id)
    values (v_intake_id, v_product.id, v_variant_id, v_qty, v_cost, v_movement_id);
  end loop;

  return v_intake_id;
end;
$$;

comment on function public.record_stock_intake is
  'Books a supplier delivery in at the person''s own shop: one goods-in record, one receipt movement per line. A line without a unit cost keeps the current cost.';
