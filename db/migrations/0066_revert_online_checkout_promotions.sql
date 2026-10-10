-- 0066 — Revert: promotions must NOT apply to online checkout
--
-- Client decision, made explicit after 0065: bulk-tier promotions are a
-- TILL-ONLY feature. 0065 was a well-intentioned fix for a report that
-- turned out to be a misunderstanding of the requirement, not a genuine gap
-- — online checkout was never supposed to price a line via
-- resolve_sale_unit_price() at all. Per the additive-only rule (see
-- supabase/migrations/README.md), 0065 is not edited in place — it was
-- pushed and may already have run elsewhere — this file supersedes it with
-- a straight CREATE OR REPLACE back to the pre-0065 body (0061's own
-- variant-aware create_order(), byte-for-byte, minus the two
-- resolve_sale_unit_price() calls 0065 added).
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

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id;
      if not found then
        raise exception 'Variant % does not belong to product %', v_variant_id, v_product.id;
      end if;
      if not public.variant_is_purchasable_online(v_variant_id) then
        raise exception 'Variant % cannot be sold online', v_variant_id;
      end if;
      v_unit_price := v_product.price + v_variant.price_adjustment;
    else
      if not public.product_is_purchasable_online(v_product.id) then
        raise exception 'Product % cannot be sold online', v_product.id;
      end if;
      v_unit_price := v_product.price;
    end if;

    v_subtotal := v_subtotal + v_unit_price * (v_line ->> 'quantity')::integer;
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

    if v_variant_id is not null then
      select * into v_variant from public.product_variants where id = v_variant_id;
      v_unit_price := v_product.price + v_variant.price_adjustment;
      v_cost_price := v_variant.cost_price;
    else
      v_unit_price := v_product.price;
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
  'The only way an order should be created. Computes subtotal, zone and delivery fee from the lines actually inserted — nothing is trusted from the caller. p_payment_provider records which provider the customer chose; provider_reference is filled in later, when payment is confirmed. Variant-aware since 0061: a line''s effective price is products.price + product_variants.price_adjustment when variant_id is set, and the snapshot name/cost follow the variant, not the parent. Promotions are TILL-ONLY (client decision, 0066) — 0065''s resolve_sale_unit_price() call was reverted; online checkout always prices at shelf price plus any variant adjustment, never a bulk tier.';
