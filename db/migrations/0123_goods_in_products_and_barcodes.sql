-- 0123 — Goods in books stock again, registers barcodes, and keeps a "to link" list
-- (client changes, October 2026, #8, with the answers to Q4 and Q5).
--
-- Since 0108 a delivery was typed names that moved no stock. The client now wants:
--
--   * a line to be a PRODUCT (or one of its variations), found by name or by scanning, whose
--     quantity is added to stock — one 'receipt' movement per line through stock_receive(), source
--     'stock_intake', as 0103 did. An optional cost per item (no cost = keep the current one) beside
--     the delivery's optional total price (0108);
--   * a barcode scanned that nothing in the shop has yet to be REGISTERED: put on the product it
--     turns out to be (as its main barcode if it has none, else as an extra one, 0122), or on a
--     product created there and then;
--   * a barcode whose product isn't known yet to wait in a "to link" list with its quantity. No
--     stock moves until someone links it to a product; then the barcode is registered on it and the
--     quantity is received (client answer Q4);
--   * an audit report of every barcode registered this way, the product it went to (or "not linked
--     yet") and the quantity added.
--
-- goods_in_barcodes is that register and the "to link" list in one table: status 'linked',
-- 'to_link' or 'dismissed' (scanned by mistake). Deliveries themselves stay immutable (0103); a typed
-- line from before this file still reads correctly.

create table public.goods_in_barcodes (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops (id),
  intake_id         uuid not null references public.stock_intakes (id),
  barcode           text not null check (btrim(barcode) <> '' and length(barcode) <= 64),
  -- What the person called it while it waited, e.g. "Blue USB-C cable". Optional.
  item_name         text check (item_name is null or length(item_name) <= 200),
  qty               integer not null check (qty > 0),
  -- Per item, as typed; null = keep the product's cost when it is received.
  unit_cost         pence check (unit_cost is null or unit_cost >= 0),
  status            text not null check (status in ('linked', 'to_link', 'dismissed')),
  product_id        uuid references public.products (id),
  variant_id        uuid references public.product_variants (id),
  stock_movement_id uuid references public.stock_movements (id),
  created_by        uuid not null references public.staff (id),
  created_at        timestamptz not null default now(),
  linked_by         uuid references public.staff (id),
  linked_at         timestamptz,
  dismissed_by      uuid references public.staff (id),
  dismissed_at      timestamptz,
  constraint goods_in_barcodes_linked_has_product check (status <> 'linked' or product_id is not null)
);

create index goods_in_barcodes_shop_idx on public.goods_in_barcodes (shop_id, created_at desc);
create index goods_in_barcodes_to_link_idx on public.goods_in_barcodes (shop_id) where status = 'to_link';
create index goods_in_barcodes_intake_idx on public.goods_in_barcodes (intake_id);

alter table public.goods_in_barcodes enable row level security;
alter table public.goods_in_barcodes force row level security;

comment on table public.goods_in_barcodes is
  'Barcodes registered through Goods in (0123): the audit report, and the "to link" list (status to_link) whose stock is received when linked.';

-- ---------------------------------------------------------------------------
-- Put a barcode on a product or variation, unless it is already there
-- ---------------------------------------------------------------------------
-- As its main barcode when it has none, otherwise as an extra one (0122). A barcode that belongs to
-- something else in the shop is refused by 0122's triggers / the unique indexes (23505), and the
-- API names the owner.
create function public.attach_goods_in_barcode(
  p_product public.products,
  p_variant_id uuid,
  p_barcode text
) returns void
language plpgsql
as $$
declare
  v_variant public.product_variants;
begin
  if p_variant_id is not null then
    select * into v_variant from public.product_variants where id = p_variant_id;
    if v_variant.barcode = p_barcode
       or exists (select 1 from public.product_barcodes
                   where variant_id = p_variant_id and barcode = p_barcode) then
      return;
    end if;
    if v_variant.barcode is null then
      update public.product_variants set barcode = p_barcode where id = p_variant_id;
    else
      insert into public.product_barcodes (shop_id, product_id, variant_id, barcode)
      values (p_product.shop_id, p_product.id, p_variant_id, p_barcode);
    end if;
  else
    if p_product.barcode = p_barcode
       or exists (select 1 from public.product_barcodes
                   where product_id = p_product.id and variant_id is null and barcode = p_barcode) then
      return;
    end if;
    if p_product.barcode is null then
      update public.products set barcode = p_barcode where id = p_product.id;
    else
      insert into public.product_barcodes (shop_id, product_id, barcode)
      values (p_product.shop_id, p_product.id, p_barcode);
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checking one product line, and receiving it
-- ---------------------------------------------------------------------------
-- Returns the receipt movement. Shared by booking a delivery in and by linking a waiting barcode.
create function public.receive_goods_in_line(
  p_staff_id   uuid,
  p_shop_id    uuid,
  p_intake_id  uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_qty        integer,
  p_unit_cost  integer,
  out o_product public.products,
  out o_movement_id uuid,
  out o_cost integer
)
language plpgsql
as $$
declare
  v_variant public.product_variants;
begin
  select * into o_product from public.products where id = p_product_id;
  if not found then
    raise exception 'That product no longer exists';
  end if;
  if o_product.shop_id <> p_shop_id then
    raise exception '"%" belongs to another shop', o_product.name;
  end if;
  if not o_product.is_active then
    raise exception '"%" has been retired. Restore it before booking stock in', o_product.name;
  end if;
  if p_variant_id is null and o_product.has_variants then
    raise exception 'Choose which variation of "%" arrived', o_product.name;
  end if;
  if p_variant_id is not null then
    select * into v_variant
      from public.product_variants
     where id = p_variant_id and product_id = o_product.id and removed_at is null;
    if not found then
      raise exception 'That variation of "%" no longer exists', o_product.name;
    end if;
    if not v_variant.is_active then
      raise exception 'That variation of "%" is switched off', o_product.name;
    end if;
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Each line needs a quantity of at least 1';
  end if;

  -- No cost given: keep what it already costs, so a delivery booked by someone who doesn't know the
  -- price never zeroes it (0103's rule).
  o_cost := coalesce(
    p_unit_cost,
    case when p_variant_id is not null then v_variant.cost_price else o_product.cost_price end
  );
  if o_cost < 0 then
    raise exception 'A cost can''t be negative';
  end if;

  o_movement_id := public.stock_receive(
    p_product_id  => o_product.id,
    p_qty         => p_qty,
    p_unit_cost   => o_cost,
    p_kind        => 'receipt',
    p_source_type => 'stock_intake',
    p_source_id   => p_intake_id,
    p_staff_id    => p_staff_id,
    p_variant_id  => p_variant_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking a delivery in
-- ---------------------------------------------------------------------------
-- p_lines, one of:
--   {"type":"product","product_id":..,"variant_id":null,"qty":3,"unit_cost":450,"register_barcode":"501…"}
--       stock received; register_barcode (optional) = a barcode scanned that nothing had, now put on it
--   {"type":"barcode","barcode":"501…","name":"Blue cable","qty":10,"unit_cost":null}
--       product not known yet: waits in the "to link" list, no stock moves
--   {"type":"item","name":"Screen protectors","qty":5}
--       a typed note only (0108's kind of line), no stock moves
create function public.record_goods_in_v2(
  p_staff_id      uuid,
  p_lines         jsonb,
  p_price         pence default null,
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
  v_type        text;
  v_qty         integer;
  v_cost        integer;
  v_barcode     text;
  v_name        text;
  v_variant_id  uuid;
  v_received    record;
begin
  if v_shop is null then
    raise exception 'This account is not assigned to a shop, so it cannot book a delivery in';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'The price cannot be negative';
  end if;
  -- Every change this makes (stock, barcodes) is attributed to the person booking it in (0104).
  perform set_config('app.staff_id', p_staff_id::text, true);

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

  insert into public.stock_intakes
    (shop_id, supplier_id, supplier_name, supplier_ref, notes, staff_id, total_price)
  values (
    v_shop, v_supplier_id, v_supplier,
    nullif(btrim(coalesce(p_supplier_ref, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_staff_id,
    p_price
  )
  returning id into v_intake_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_type := coalesce(v_line ->> 'type', 'item');
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Each line needs a quantity of at least 1';
    end if;
    v_cost := nullif(v_line ->> 'unit_cost', '')::integer;
    v_name := nullif(btrim(coalesce(v_line ->> 'name', '')), '');

    if v_type = 'product' then
      v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
      select * into v_received from public.receive_goods_in_line(
        p_staff_id, v_shop, v_intake_id, (v_line ->> 'product_id')::uuid, v_variant_id, v_qty, v_cost);

      insert into public.stock_intake_lines
        (intake_id, product_id, variant_id, qty, unit_cost, stock_movement_id)
      values (v_intake_id, (v_received.o_product).id, v_variant_id, v_qty, v_received.o_cost,
              v_received.o_movement_id);

      v_barcode := nullif(btrim(coalesce(v_line ->> 'register_barcode', '')), '');
      if v_barcode is not null then
        perform public.attach_goods_in_barcode(v_received.o_product, v_variant_id, v_barcode);
        insert into public.goods_in_barcodes
          (shop_id, intake_id, barcode, item_name, qty, unit_cost, status, product_id, variant_id,
           stock_movement_id, created_by, linked_by, linked_at)
        values (v_shop, v_intake_id, v_barcode, v_name, v_qty, v_cost, 'linked',
                (v_received.o_product).id, v_variant_id, v_received.o_movement_id, p_staff_id,
                p_staff_id, now());
      end if;

    elsif v_type = 'barcode' then
      v_barcode := nullif(btrim(coalesce(v_line ->> 'barcode', '')), '');
      if v_barcode is null then
        raise exception 'A barcode line needs the barcode';
      end if;
      if exists (select 1 from public.products where shop_id = v_shop and barcode = v_barcode)
         or exists (select 1 from public.product_variants
                     where shop_id = v_shop and barcode = v_barcode and removed_at is null)
         or exists (select 1 from public.product_barcodes where shop_id = v_shop and barcode = v_barcode) then
        raise exception 'Barcode % is already on a product. Scan it again to pick that product', v_barcode;
      end if;
      insert into public.stock_intake_lines (intake_id, item_name, qty)
      values (v_intake_id, coalesce(v_name, 'Barcode ' || v_barcode) || ' (to link)', v_qty);
      insert into public.goods_in_barcodes
        (shop_id, intake_id, barcode, item_name, qty, unit_cost, status, created_by)
      values (v_shop, v_intake_id, v_barcode, v_name, v_qty, v_cost, 'to_link', p_staff_id);

    elsif v_type = 'item' then
      if v_name is null then
        raise exception 'Every typed item needs a name';
      end if;
      insert into public.stock_intake_lines (intake_id, item_name, qty) values (v_intake_id, v_name, v_qty);

    else
      raise exception 'Unknown line type %', v_type;
    end if;
  end loop;

  return v_intake_id;
end;
$$;

comment on function public.record_goods_in_v2 is
  'Books a delivery in at the person''s own shop (0123): product lines receive stock (and may register a new barcode), unknown barcodes wait in the "to link" list, typed items are notes.';

-- ---------------------------------------------------------------------------
-- Linking a waiting barcode
-- ---------------------------------------------------------------------------
create function public.link_goods_in_barcode(
  p_staff_id   uuid,
  p_id         uuid,
  p_product_id uuid,
  p_variant_id uuid default null
) returns void
language plpgsql
as $$
declare
  v_shop     uuid := public.staff_shop(p_staff_id);
  v_row      public.goods_in_barcodes;
  v_received record;
begin
  select * into v_row from public.goods_in_barcodes where id = p_id for update;
  if not found or v_row.shop_id is distinct from v_shop then
    raise exception 'That barcode is not waiting in your shop';
  end if;
  if v_row.status <> 'to_link' then
    raise exception 'That barcode has already been dealt with';
  end if;
  perform set_config('app.staff_id', p_staff_id::text, true);

  select * into v_received from public.receive_goods_in_line(
    p_staff_id, v_shop, v_row.intake_id, p_product_id, p_variant_id, v_row.qty, v_row.unit_cost);
  perform public.attach_goods_in_barcode(v_received.o_product, p_variant_id, v_row.barcode);

  update public.goods_in_barcodes
     set status = 'linked', product_id = p_product_id, variant_id = p_variant_id,
         stock_movement_id = v_received.o_movement_id, linked_by = p_staff_id, linked_at = now()
   where id = p_id;
end;
$$;

comment on function public.link_goods_in_barcode is
  'Links a waiting Goods in barcode to a product (0123): registers the barcode on it and receives the waiting quantity.';
