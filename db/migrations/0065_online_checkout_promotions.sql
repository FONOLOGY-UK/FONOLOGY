-- 0065 — Bug fix: promotions/bulk tiers never applied to online checkout
--
-- Investigated per the client's bug report ("#20 — promotions don't apply
-- at checkout"). Finding: this is NOT a Phase 4 regression. create_order()
-- has used a line's plain products.price directly since its very first
-- definition (0005_orders.sql) and has never once called
-- resolve_sale_unit_price() (0013) — only the till's complete_sale() (0008
-- onward) ever did. So online checkout has never applied a bulk-tier
-- promotion, in any round of this project. 0061's own header comment
-- describes an "approved trimmed-v1" split where "the caller (apps/api)
-- adds the variant's price_adjustment on top of the resolved price" — that
-- was the intended design, but orders.routes.ts never actually calls
-- resolve_sale_unit_price() and passes no price to create_order() at all
-- (unlike pos.routes.ts, which prices every line itself before calling
-- complete_sale()). The gap is in create_order() itself, not the API layer,
-- so the fix belongs here, and is a straight port of the pricing rule
-- pos.routes.ts already uses for the till (apps/api/src/routes/pos.routes.ts
-- lines ~241-262): resolve_sale_unit_price() returns either a qualifying
-- promo tier's price (an absolute override) or the plain shelf price when
-- no tier applies; a variant's price_adjustment only ever layers on top of
-- the SHELF price, never on top of a tier override — a tier, when it
-- fires, is the price, full stop.
--
-- Scope kept deliberately minimal: order_lines (0005) has no list_price /
-- tier_applied columns the way sale_lines does (0008) — adding a "you
-- saved" receipt line for online orders is new surface area the client
-- didn't ask for here ("fix both paths and test both" — the paying price is
-- what has to be right, not a saved-amount display). unit_price itself
-- carries the discount correctly, which is what subtotal/total/Stripe all
-- read.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

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
  p_phone           text default null,
  p_payment_provider text default null
)
returns uuid
language plpgsql
as $$
declare
  v_order_id     uuid;
  v_line         jsonb;
  v_product      public.products;
  v_variant      public.product_variants;
  v_variant_id   uuid;
  v_unit_price   pence;
  v_cost_price   pence;
  v_resolved     pence;
  v_subtotal     pence := 0;
  v_zone_id      uuid;
  v_delivery_fee pence := 0;
  v_zone_code    text;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one line';
  end if;

  if p_payment_provider is not null and p_payment_provider not in ('stripe', 'clearpay') then
    raise exception 'Unknown payment provider %', p_payment_provider;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;

    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;

    -- Bug fix (this file): resolve any qualifying bulk-tier promotion for
    -- this product/quantity, same rule the till already applies. A firing
    -- tier is an absolute override; otherwise fall through to shelf price
    -- (+ variant adjustment, if any) exactly as before this file.
    v_resolved := public.resolve_sale_unit_price(v_product.id, (v_line ->> 'quantity')::integer);

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id;
      if not found then
        raise exception 'Variant % does not belong to product %', v_variant_id, v_product.id;
      end if;
      if not public.variant_is_purchasable_online(v_variant_id) then
        raise exception 'Variant % cannot be sold online', v_variant_id;
      end if;
      v_unit_price := case when v_resolved < v_product.price
        then v_resolved
        else v_product.price + v_variant.price_adjustment
      end;
    else
      if not public.product_is_purchasable_online(v_product.id) then
        raise exception 'Product % cannot be sold online', v_product.id;
      end if;
      v_unit_price := v_resolved;
    end if;

    v_subtotal := v_subtotal + v_unit_price * (v_line ->> 'quantity')::integer;
  end loop;

  -- delivery_quote() (0021) only ever looks at each line's product_id and
  -- its free_delivery flag — a flag that lives on the PARENT product and is
  -- untouched by variants in this trimmed v1 (see 0060's header: no
  -- per-variant anything beyond stock/cost/price/barcode). So the free-
  -- delivery rule and the fee/zone resolution need no variant awareness at
  -- all; passing p_lines straight through keeps checkout and this function
  -- sharing the exact same fee logic, which is the whole point of 0021.
  select q.delivery_fee, q.zone_code
    into v_delivery_fee, v_zone_code
    from public.delivery_quote(p_lines, p_delivery_method, p_postcode) q;

  if p_delivery_method <> 'collect' then
    select id into v_zone_id from public.delivery_zones where code = v_zone_code;
  end if;

  insert into public.orders (
    customer_id, guest_email, delivery_method, delivery_zone_id,
    recipient_name, address_line1, address_line2, city, county, postcode, phone,
    subtotal, delivery_fee, discount, payment_provider
  ) values (
    p_customer_id, p_guest_email, p_delivery_method, v_zone_id,
    p_recipient_name, p_address_line1, p_address_line2, p_city, p_county, p_postcode, p_phone,
    v_subtotal, v_delivery_fee, p_discount, p_payment_provider
  )
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;

    v_resolved := public.resolve_sale_unit_price(v_product.id, (v_line ->> 'quantity')::integer);

    if v_variant_id is not null then
      select * into v_variant from public.product_variants where id = v_variant_id;
      v_unit_price := case when v_resolved < v_product.price
        then v_resolved
        else v_product.price + v_variant.price_adjustment
      end;
      v_cost_price := v_variant.cost_price;
    else
      v_unit_price := v_resolved;
      v_cost_price := v_product.cost_price;
    end if;

    insert into public.order_lines (order_id, product_id, variant_id, name, unit_price, cost_price, quantity)
    values (
      v_order_id, v_product.id, v_variant_id,
      case when v_variant_id is not null then
        v_product.name || ' — ' || (select string_agg(value::text, ', ') from jsonb_each_text(v_variant.options))
      else v_product.name end,
      v_unit_price, v_cost_price,
      (v_line ->> 'quantity')::integer
    );
  end loop;

  return v_order_id;
end;
$$;

comment on function public.create_order(jsonb, delivery_method, uuid, citext, text, text, text, text, text, text, pence, text, text) is
  'The only way an order should be created. Computes subtotal, zone and delivery fee from the lines actually inserted — nothing is trusted from the caller. p_payment_provider records which provider the customer chose; provider_reference is filled in later, when payment is confirmed. Variant-aware since 0061: a line''s effective price is products.price + product_variants.price_adjustment when variant_id is set, and the snapshot name/cost follow the variant, not the parent. Promotion-aware since 0065: resolve_sale_unit_price() is consulted for every line, same rule the till already applied — a qualifying bulk tier overrides price outright; a variant adjustment only ever layers on top of the plain shelf price.';
