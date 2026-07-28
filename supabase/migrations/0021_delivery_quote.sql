-- 0021 — Read-only delivery quote, shared with create_order
-- ---------------------------------------------------------------------------
-- The checkout screen let the customer pick "Standard / Next day / Remote
-- areas" as if remote were a choice — it isn't, it's a fact about the
-- postcode. Order FNL-10071 showed £3.95 on screen and was charged £9.95
-- (the real, postcode-derived remote rate) because nothing on the frontend
-- ever asked the server what the fee actually would be before the order was
-- placed.
--
-- This extracts the fee-computation half of create_order() (zone lookup,
-- free-delivery-if-every-line-is-free-delivery, rate lookup) into its own
-- function, callable before an order exists, then rewires create_order to
-- call it — so there is exactly one place this logic lives. The two can no
-- longer drift apart.

create or replace function public.delivery_quote(
  p_lines           jsonb,   -- [{"product_id": "...", "quantity": 2}, ...]
  p_delivery_method delivery_method,
  p_postcode        text default null
)
returns table (delivery_fee pence, zone_code text)
language plpgsql
stable
as $$
declare
  v_line         jsonb;
  v_product      public.products;
  v_zone_id      uuid;
  v_zone_code    text;
  v_fee          pence := 0;
  v_all_free     boolean := true;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A quote needs at least one line';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;
    if not v_product.free_delivery then
      v_all_free := false;
    end if;
  end loop;

  if p_delivery_method <> 'collect' then
    v_zone_id := public.delivery_zone_for(p_postcode);
    select code into v_zone_code from public.delivery_zones where id = v_zone_id;
    if not v_all_free then
      select price into v_fee
      from public.delivery_rates
      where zone_id = v_zone_id and method = p_delivery_method;
    end if;
  end if;

  return query select v_fee, v_zone_code;
end;
$$;

comment on function public.delivery_quote is
  'What create_order would actually charge for delivery, computed the same way, before the order exists. The checkout screen must show this, not a self-picked tier.';

-- create_order now calls delivery_quote for the fee/zone instead of
-- reimplementing the same three steps — same 12-arg signature, so this is a
-- body swap, not a new overload; no drop-and-recreate needed.
create or replace function public.create_order(
  p_lines           jsonb,
  p_delivery_method delivery_method,
  p_customer_id     uuid default null,
  p_guest_email     citext default null,
  p_recipient_name  text default null,
  p_address_line1   text default null,
  p_address_line2   text default null,
  p_city            text default null,
  p_county          text default null,
  p_postcode        text default null,
  p_discount        pence default 0,
  p_phone           text default null
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
  v_zone_code    text;
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
  end loop;

  select q.delivery_fee, q.zone_code
    into v_delivery_fee, v_zone_code
    from public.delivery_quote(p_lines, p_delivery_method, p_postcode) q;

  if p_delivery_method <> 'collect' then
    select id into v_zone_id from public.delivery_zones where code = v_zone_code;
  end if;

  insert into public.orders (
    customer_id, guest_email, delivery_method, delivery_zone_id,
    recipient_name, address_line1, address_line2, city, county, postcode, phone,
    subtotal, delivery_fee, discount
  ) values (
    p_customer_id, p_guest_email, p_delivery_method, v_zone_id,
    p_recipient_name, p_address_line1, p_address_line2, p_city, p_county, p_postcode, p_phone,
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

comment on function public.create_order(jsonb, delivery_method, uuid, citext, text, text, text, text, text, text, pence, text) is
  'The only way an order should be created. Fee/zone come from delivery_quote() — the same function the checkout screen calls before the order exists — so shown and charged can never drift.';
