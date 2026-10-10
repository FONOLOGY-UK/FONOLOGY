-- 0108 — Goods in: free-text items and one price per delivery
--
-- Tester hand-off doc "Bug Fixes & Feature Changes" (8 Oct 2026), C-1. Goods in on the till
-- becomes a plain record of what arrived:
--
--   * an item is a NAME and a QUANTITY typed by hand — not linked to a product, so booking a
--     delivery in no longer moves stock (stock is counted on the product itself);
--   * no cost per item: one optional PRICE for the whole delivery;
--   * supplier, their reference (optional, as it already was) and notes are unchanged.
--
-- Deliveries already booked the old way keep their product links, unit costs and stock
-- movements, and still read correctly: a line is EITHER a product (old) or a typed name (new).
-- Both tables stay history — the 0103 immutability triggers are untouched.

alter table public.stock_intakes
  add column total_price pence check (total_price is null or total_price >= 0);

comment on column public.stock_intakes.total_price is
  'What the whole delivery cost, as typed at the till (0108). NULL = not given. A cost: shown only to costs.view.';

alter table public.stock_intake_lines
  alter column product_id drop not null,
  alter column unit_cost drop not null,
  alter column stock_movement_id drop not null,
  add column item_name text check (item_name is null or (btrim(item_name) <> '' and length(item_name) <= 200)),
  add constraint stock_intake_lines_product_or_name check (product_id is not null or item_name is not null);

comment on column public.stock_intake_lines.item_name is
  'The item as typed at the till (0108). Lines booked before 0108 name a product instead.';

-- The one way a delivery is booked from now on. The shop is the person's own (staff_shop), never
-- the caller's to choose — the same rule 0103 had.
create function public.record_goods_in(
  p_staff_id      uuid,
  p_items         jsonb,   -- [{"name": "iPhone 13 screens", "qty": 10}, ...]
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
  v_item        jsonb;
  v_name        text;
  v_qty         integer;
begin
  if v_shop is null then
    raise exception 'This account is not assigned to a shop, so it cannot book a delivery in';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'The price cannot be negative';
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

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    if v_name is null then
      raise exception 'Every item needs a name';
    end if;
    v_qty := (v_item ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'The quantity for "%" must be a positive number', v_name;
    end if;
    insert into public.stock_intake_lines (intake_id, item_name, qty)
    values (v_intake_id, v_name, v_qty);
  end loop;

  return v_intake_id;
end;
$$;

comment on function public.record_goods_in is
  'Books a delivery in at the till (0108): typed items, one optional price. Records only — moves no stock.';

-- The product-linked way (0103) has no caller left.
drop function public.record_stock_intake(uuid, jsonb, text, text, text);
