-- 0015 — Orders need a contact phone number
-- Found building B3: OrderInput (apps/web) requires phone at checkout
-- (ukPhoneSchema, unconditional — collected for guests and signed-in
-- customers alike, since it's delivery-contact info, not identity), and the
-- frontend's Order response schema requires `phone: z.string()`. There was
-- no column for it anywhere on `orders` — a courier needs a contact number
-- as much as an address; this isn't optional information, it just never got
-- modeled. Added as nullable text (existing rows have none, and the column
-- doesn't need a floor or format check here — apps/web's ukPhoneSchema
-- already validates shape at the boundary before it reaches this function).
--
-- create_order() gains a new trailing parameter with a default, so no
-- existing caller (there are none outside this app yet) breaks.
--
-- Applied to the DEV project only — same as 0014, not promoted to
-- production as part of this phase.

alter table public.orders
  add column phone text;

-- create_order's parameter list is changing shape (p_phone appended), which
-- CREATE OR REPLACE treats as a new overload, not a replacement — the old
-- 11-argument version would otherwise sit alongside the new 12-argument one
-- forever. Same pattern as 0013's create_refund.
drop function if exists public.create_order(jsonb, delivery_method, uuid, citext, text, text, text, text, text, text, pence);

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
  'The only way an order should be created. Computes subtotal, zone and delivery fee from the lines actually inserted — nothing is trusted from the caller.';
