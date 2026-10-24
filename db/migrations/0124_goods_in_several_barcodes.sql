-- 0124 — Several barcodes on one Goods in line (client bug report, 24 Oct 2026, item 2.2).
--
-- While booking a product in, staff can scan or type more than one barcode that should find it
-- (the box's barcode plus, say, two more from the packaging). A product line now takes
-- register_barcodes, an array; each one goes on the product (or the chosen variation) — as its main
-- barcode when it has none, otherwise as an extra (0122) — and gets its own row in the barcode
-- register with the line's quantity. register_barcode (one, 0123) still works, so the API before
-- this file runs unchanged on it. A barcode that already belongs to something else is refused by
-- 0122's triggers (23505), and the API names the owner.
--
-- Only the product-line branch changes; the rest of the function is 0123's, word for word.

create or replace function public.record_goods_in_v2(
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
  v_product     public.products;
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

      -- 0124: every barcode the line names, in order, each once.
      for v_barcode in
        select b
          from (
            select btrim(x) as b, min(ord) as first_seen
              from jsonb_array_elements_text(
                     jsonb_build_array(coalesce(v_line ->> 'register_barcode', ''))
                     || coalesce(v_line -> 'register_barcodes', '[]'::jsonb)
                   ) with ordinality as t(x, ord)
             where btrim(x) <> ''
             group by btrim(x)
          ) s
         order by first_seen
      loop
        -- Read the product again each time: the first barcode may have just become its main one,
        -- and attach_goods_in_barcode decides main or extra from the row it is given.
        select * into v_product from public.products where id = (v_received.o_product).id;
        perform public.attach_goods_in_barcode(v_product, v_variant_id, v_barcode);
        insert into public.goods_in_barcodes
          (shop_id, intake_id, barcode, item_name, qty, unit_cost, status, product_id, variant_id,
           stock_movement_id, created_by, linked_by, linked_at)
        values (v_shop, v_intake_id, v_barcode, v_name, v_qty, v_cost, 'linked',
                v_product.id, v_variant_id, v_received.o_movement_id, p_staff_id,
                p_staff_id, now());
      end loop;

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
  'Books a delivery in at the person''s own shop (0123, 0124): product lines receive stock and may register one or more new barcodes, unknown barcodes wait in the "to link" list, typed items are notes.';
