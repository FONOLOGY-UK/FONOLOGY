-- 0061 — Product variants (#16), part 2: money functions become
-- variant-aware
--
-- 0060 built the shape and the stock ledger split. This file threads
-- variant_id through the three functions that actually move money and
-- stock together: create_order() (online checkout), complete_sale() (the
-- till), create_refund() (both). Same discipline as 0060: every existing
-- call site (variant_id simply absent from a line) behaves identically to
-- before this file existed.
--
-- resolve_sale_unit_price() (0013) is DELIBERATELY untouched — per the
-- approved trimmed-v1 scope, promotions/bulk tiers stay product-level and
-- apply regardless of variant. A qualifying tier's price is an absolute
-- override (same behaviour as today); when no tier qualifies, the caller
-- (apps/api) adds the variant's price_adjustment on top of the resolved
-- price instead. That split lives in the API layer, not here, because it's
-- about which of two already-existing numbers to use, not a new DB rule.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

-- ---------------------------------------------------------------------------
-- create_order(): variant-aware pricing + purchasability
-- ---------------------------------------------------------------------------
-- IMPORTANT: the body below is layered on top of the CURRENT function
-- (0030_payment_provenance.sql's version — 13 parameters including
-- p_phone/p_payment_provider, pricing fee/zone via delivery_quote() rather
-- than querying delivery_rates directly), not the original 0005 body. A
-- first draft of this migration mistakenly started from the 0005 shape and
-- would have silently dropped p_phone, p_payment_provider AND the
-- delivery_quote()-sharing behaviour the moment it was applied — caught
-- immediately because the signature mismatch made CREATE OR REPLACE spawn
-- a second, ambiguous overload rather than replacing anything (the exact
-- failure mode 0030's own comment already warns about). No new SQL
-- parameter is added here — p_lines' jsonb SHAPE gains an optional
-- variant_id key — so this stays a straight replace, no DROP needed.

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
  'The only way an order should be created. Computes subtotal, zone and delivery fee from the lines actually inserted — nothing is trusted from the caller. p_payment_provider records which provider the customer chose; provider_reference is filled in later, when payment is confirmed. Variant-aware since 0061: a line''s effective price is products.price + product_variants.price_adjustment when variant_id is set, and the snapshot name/cost follow the variant, not the parent.';

-- ---------------------------------------------------------------------------
-- validate_order_status_transition(): variant-aware stock consume/return
-- ---------------------------------------------------------------------------
-- Same trigger, same two branches (paid -> consume, cancelled -> restock),
-- now reading order_lines.variant_id (0060) and threading it through to
-- stock_consume/stock_receive so a variant line moves the VARIANT's stock,
-- not the parent's — exactly the same decoupling proven in 0060's own
-- test suite, reached this time through the real order lifecycle instead
-- of a direct stock_consume call.

create or replace function public.validate_order_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_line record;
begin
  if new.status = old.status then
    return new;
  end if;

  if not (new.status = any (public.order_status_allowed_next(old.status))) then
    raise exception 'Order % cannot move from % to %', old.reference, old.status, new.status;
  end if;

  if new.status in ('ready', 'shipped') and exists (
    select 1 from public.order_documents
    where order_id = new.id and status <> 'approved'
  ) then
    raise exception 'Order % has unresolved verification documents', old.reference;
  end if;

  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := now();

    for v_line in select * from public.order_lines where order_id = new.id loop
      if v_line.product_id is not null then
        perform public.stock_consume(
          v_line.product_id, v_line.quantity, 'online_order',
          'order', new.id, null, null, v_line.variant_id
        );
      end if;
    end loop;
  end if;

  if new.status = 'cancelled' and old.status in ('paid', 'ready') then
    for v_line in select * from public.order_lines where order_id = new.id loop
      if v_line.product_id is not null then
        perform public.stock_receive(
          v_line.product_id, v_line.quantity, null, 'refund_restock',
          'order', new.id, null, null, v_line.variant_id
        );
      end if;
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_sale(): variant-aware cost snapshot + stock consume
-- ---------------------------------------------------------------------------
-- Same caution as create_order()/create_refund() above, and for the same
-- reason: this layers on top of the CURRENT function
-- (0032_freeze_card_machine_label.sql's version — machine_label frozen
-- from shop_settings, confirmed_by/provider_reference/source on each
-- payment leg), not 0008's original body. Confirmed against dev's real
-- pg_proc entry before writing this — the argument LIST happens to be
-- identical across 0008/0030/0032 (all provenance additions went into
-- sale_payments columns and the p_payments jsonb shape, never a new
-- top-level parameter), which is exactly what made the earlier mistake on
-- create_order() easy to make silently here too: no overload error to
-- catch it, since the signature never changed. Caught this one only by
-- deliberately re-reading the migration history instead of trusting the
-- clean pg_proc arg-list match.
--
-- unit_price/list_price/tier_applied are still trusted from the caller,
-- exactly as before this file — that hasn't changed, and isn't a variants
-- concern (see resolve_sale_unit_price's own comment in 0013). What's new
-- is: a line may name a variant, whose OWN cost_price is what gets
-- snapshotted onto sale_lines and used for the sale's below-cost check —
-- not the parent's, which no longer means anything once has_variants is
-- true (0060's own reasoning, one level up). Whether the named variant
-- actually belongs to the named product is enforced by
-- stock_movements_variant_matches_product (0060) the moment stock_consume
-- inserts the movement — not re-checked here separately.

create or replace function public.complete_sale(
  p_staff_id  uuid,
  p_lines     jsonb,   -- [{"product_id","variant_id"?,"quantity","unit_price","list_price","tier_applied"}]
  p_payments  jsonb,   -- [{"tender", "amount", "reference"?}]
  p_discount  pence default 0,
  p_below_cost_reason text default null
)
returns uuid
language plpgsql
as $$
declare
  v_sale_id  uuid;
  v_subtotal pence := 0;
  v_cost     pence := 0;
  v_line     jsonb;
  v_payment  jsonb;
  v_product  public.products;
  v_variant_id uuid;
  v_line_cost  pence;
  v_below_cost boolean;
  v_reference text;
  v_tender   tender_method;
  v_machine_labels jsonb;
  v_machine_label  text;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line';
  end if;
  if jsonb_array_length(p_payments) = 0 then
    raise exception 'A sale needs at least one payment';
  end if;

  select card_machine_labels into v_machine_labels from public.shop_settings limit 1;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;

    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
    if v_variant_id is not null then
      select cost_price into v_line_cost from public.product_variants where id = v_variant_id;
      if not found then
        raise exception 'Variant % not found', v_variant_id;
      end if;
    else
      v_line_cost := v_product.cost_price;
    end if;

    v_subtotal := v_subtotal + (v_line ->> 'unit_price')::integer * (v_line ->> 'quantity')::integer;
    v_cost     := v_cost + v_line_cost * (v_line ->> 'quantity')::integer;
  end loop;

  v_below_cost := (v_subtotal - p_discount) <= v_cost;

  insert into public.sales (staff_id, subtotal, discount, cost, below_cost, below_cost_reason)
  values (p_staff_id, v_subtotal, p_discount, v_cost, v_below_cost, p_below_cost_reason)
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;

    if v_variant_id is not null then
      select cost_price into v_line_cost from public.product_variants where id = v_variant_id;
    else
      v_line_cost := v_product.cost_price;
    end if;

    insert into public.sale_lines (sale_id, product_id, variant_id, name, quantity, unit_price, list_price, cost_price, tier_applied)
    values (
      v_sale_id, v_product.id, v_variant_id, v_product.name,
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      coalesce((v_line ->> 'list_price')::integer, (v_line ->> 'unit_price')::integer),
      v_line_cost,
      coalesce((v_line ->> 'tier_applied')::boolean, false)
    );

    perform public.stock_consume(
      v_product.id, (v_line ->> 'quantity')::integer, 'sale',
      'sale', v_sale_id, p_staff_id, null, v_variant_id
    );
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_reference := nullif(btrim(coalesce(v_payment ->> 'reference', '')), '');
    v_tender := (v_payment ->> 'tender')::tender_method;

    v_machine_label := case
      when v_tender in ('pos1', 'pos2') then v_machine_labels ->> v_tender::text
      else null
    end;

    insert into public.sale_payments (
      sale_id, tender, amount, confirmed_by, provider_reference, source, machine_label
    )
    values (
      v_sale_id, v_tender, (v_payment ->> 'amount')::integer,
      p_staff_id, v_reference, 'manual', v_machine_label
    );
  end loop;

  set constraints public.sale_payments_sum_matches_total immediate;
  set constraints public.sale_payments_sum_matches_total deferred;

  return v_sale_id;
end;
$$;

comment on function public.complete_sale is
  'The only way a till sale should be created. Stock is consumed line by line inside the same transaction as the payment rows, so if the deferred payments-equal-total check fails at commit, the stock movements roll back with it — nothing is left half-applied. Each payment may carry an optional "reference" (the card machine''s slip reference); every leg records who confirmed it, that the confirmation was manual, and (for pos1/pos2) the machine''s name FROZEN at that moment (0032). Variant-aware since 0061: a line naming a variant snapshots THAT variant''s cost_price (not the parent''s) and consumes the variant''s stock; unit_price/list_price/tier_applied are still trusted from the caller exactly as before, unrelated to variants.';

-- ---------------------------------------------------------------------------
-- create_refund(): variant-aware restock
-- ---------------------------------------------------------------------------
-- Same caution as create_order() above: the body below is layered on top
-- of the CURRENT function (0013_schema_gaps.sql's version — p_job_id
-- inserted between p_order_id and p_original_tender, the "exactly one of
-- sale/order/job" constraint, and the job_payments-sum path for a job
-- refund's original total), not the older 0008 body. Confirmed against
-- dev's actual pg_proc entry before writing this, specifically because of
-- the create_order near-miss just above. No new SQL parameter — p_lines
-- gains an optional variant_id key — so this stays a straight replace.

create or replace function public.create_refund(
  p_staff_id       uuid,
  p_amount         pence,
  p_refund_tender  tender_method,
  p_reason         text,
  p_lines          jsonb default '[]'::jsonb,   -- [{"product_id","variant_id"?,"name","quantity","unit_price","restock"}]
  p_sale_id        uuid default null,
  p_order_id       uuid default null,
  p_job_id         uuid default null,
  p_original_tender tender_method default null,
  p_outside_window boolean default false,
  p_window_override_by uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_refund_id uuid;
  v_line jsonb;
  v_variant_id uuid;
  v_original_total pence;
  v_already_refunded pence;
begin
  if (case when p_sale_id is not null then 1 else 0 end)
   + (case when p_order_id is not null then 1 else 0 end)
   + (case when p_job_id is not null then 1 else 0 end) <> 1 then
    raise exception 'A refund must reference exactly one of a sale, an order, or a job';
  end if;

  if p_sale_id is not null then
    select total into v_original_total from public.sales where id = p_sale_id;
    if v_original_total is null then
      raise exception 'Sale % not found', p_sale_id;
    end if;
  elsif p_order_id is not null then
    select total into v_original_total from public.orders where id = p_order_id;
    if v_original_total is null then
      raise exception 'Order % not found', p_order_id;
    end if;
  else
    if not exists (select 1 from public.jobs where id = p_job_id) then
      raise exception 'Job % not found', p_job_id;
    end if;
    select coalesce(sum(amount), 0) into v_original_total
    from public.job_payments where job_id = p_job_id;
  end if;

  select coalesce(sum(amount), 0) into v_already_refunded
  from public.refunds
  where (p_sale_id is not null and sale_id = p_sale_id)
     or (p_order_id is not null and order_id = p_order_id)
     or (p_job_id is not null and job_id = p_job_id);

  if v_already_refunded + p_amount > v_original_total then
    raise exception 'Refund amount (%) plus what has already been refunded (%) would exceed what was paid (%)',
      p_amount, v_already_refunded, v_original_total;
  end if;

  insert into public.refunds (
    sale_id, order_id, job_id, amount, original_tender, refund_tender, reason,
    outside_window, window_override_by, staff_id
  ) values (
    p_sale_id, p_order_id, p_job_id, p_amount, p_original_tender, p_refund_tender, p_reason,
    p_outside_window, p_window_override_by, p_staff_id
  )
  returning id into v_refund_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;

    insert into public.refund_lines (refund_id, product_id, variant_id, name, quantity, unit_price, restocked)
    values (
      v_refund_id,
      nullif(v_line ->> 'product_id', '')::uuid,
      v_variant_id,
      v_line ->> 'name',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      coalesce((v_line ->> 'restock')::boolean, false)
    );

    if coalesce((v_line ->> 'restock')::boolean, false)
       and (v_line ->> 'product_id') is not null and (v_line ->> 'product_id') <> '' then
      perform public.stock_receive(
        (v_line ->> 'product_id')::uuid, (v_line ->> 'quantity')::integer, null,
        'refund_restock', 'refund', v_refund_id, p_staff_id, null, v_variant_id
      );
    end if;
  end loop;

  return v_refund_id;
end;
$$;

comment on function public.create_refund is
  'The only way a refund should be recorded. Exactly one of p_sale_id/p_order_id/p_job_id is required. A restocked line calls stock_receive with kind refund_restock — unit_cost null. Variant-aware since 0061: a line naming a variant restocks THAT variant''s shelf, not the parent''s.';
