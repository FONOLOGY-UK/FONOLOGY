-- 0097 — shop-aware functions and views (stage 3, multi-shop, step 2).
--
-- 0096 gave every till-owned row a shop. This makes the database enforce it:
--
--   * The ACTING shop is the shop of the staff member passed in (staff_shop()).
--     A sale, refund, job payment, part, trade-in restock or promotion can only touch
--     rows of that shop; anything else is refused here, not just in the API.
--   * Stock movements take their shop from the product.
--   * Reports, today's takings, card-limit usage, the money ledger and the print
--     queue take an optional shop (null = every shop, for owners and managers).
--
-- Refunds record BOTH the shop that paid out (shop_id: its drawer, its day close)
-- and the shop of the original sale (original_shop_id). Restocking only happens when
-- the returned product belongs to the refunding shop; mapping a product to its copy in
-- another shop needs the master list (step 3).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The shop a staff member works in. Null for an owner who has no shop.
create function public.staff_shop(p_staff_id uuid) returns uuid
language sql stable
as $$ select shop_id from public.staff where id = p_staff_id $$;

-- A product's stock movement belongs to the product's shop, whoever caused it.
create function public.stock_movement_set_shop() returns trigger
language plpgsql
as $$
begin
  select shop_id into new.shop_id from public.products where id = new.product_id;
  return new;
end $$;

create trigger stock_movements_a_set_shop
  before insert on public.stock_movements
  for each row execute function public.stock_movement_set_shop();

alter table public.refunds
  add column original_shop_id uuid references public.shops(id);
update public.refunds set original_shop_id = shop_id;
alter table public.refunds alter column original_shop_id set not null;
alter table public.refunds alter column original_shop_id set default public.default_shop_id();
create index refunds_original_shop_idx on public.refunds (original_shop_id);

-- ---------------------------------------------------------------------------
-- complete_sale: the sale belongs to the cashier's shop; lines must be its products
-- ---------------------------------------------------------------------------

create or replace function public.complete_sale(
  p_staff_id uuid, p_lines jsonb, p_payments jsonb,
  p_discount pence default 0, p_below_cost_reason text default null)
returns uuid
language plpgsql
as $function$
declare
  v_sale_id  uuid;
  v_subtotal pence := 0;
  v_cost     pence := 0;
  v_line     jsonb;
  v_payment  jsonb;
  v_product  public.products;
  v_product_id uuid;
  v_variant_id uuid;
  v_line_cost  pence;
  v_cost_pending boolean;
  v_below_cost boolean;
  v_reference text;
  v_tender   tender_method;
  v_machine_labels jsonb;
  v_machine_label  text;
  v_name     text;
  v_shop     uuid := public.staff_shop(p_staff_id);
begin
  if v_shop is null then
    raise exception 'This account is not assigned to a shop, so it cannot ring up a sale';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line';
  end if;
  if jsonb_array_length(p_payments) = 0 then
    raise exception 'A sale needs at least one payment';
  end if;

  select card_machine_labels into v_machine_labels from public.shops where id = v_shop;

  -- Pass 1: totals.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_product_id is null then
      if nullif(btrim(coalesce(v_line ->> 'name', '')), '') is null then
        raise exception 'A miscellaneous line needs a name';
      end if;
      if (v_line ->> 'unit_price') is null then
        raise exception 'A miscellaneous line needs a selling price';
      end if;
      v_line_cost := coalesce((v_line ->> 'cost_price')::integer, 0);
    else
      select * into v_product from public.products where id = v_product_id;
      if not found then
        raise exception 'Product % not found', v_product_id;
      end if;
      if v_product.shop_id <> v_shop then
        raise exception 'Product % belongs to another shop', v_product_id;
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
    end if;

    v_subtotal := v_subtotal + (v_line ->> 'unit_price')::integer * (v_line ->> 'quantity')::integer;
    v_cost     := v_cost + v_line_cost * (v_line ->> 'quantity')::integer;
  end loop;

  v_below_cost := (v_subtotal - p_discount) <= v_cost;

  insert into public.sales (staff_id, shop_id, subtotal, discount, cost, below_cost, below_cost_reason)
  values (p_staff_id, v_shop, v_subtotal, p_discount, v_cost, v_below_cost, p_below_cost_reason)
  returning id into v_sale_id;

  -- Pass 2: the lines themselves, and stock.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_product_id is null then
      v_name := btrim(v_line ->> 'name');
      v_cost_pending := (v_line ->> 'cost_price') is null;
      v_line_cost := coalesce((v_line ->> 'cost_price')::integer, 0);

      insert into public.sale_lines (
        sale_id, product_id, variant_id, name, quantity,
        unit_price, list_price, cost_price, tier_applied, cost_price_pending
      )
      values (
        v_sale_id, null, null, v_name,
        (v_line ->> 'quantity')::integer,
        (v_line ->> 'unit_price')::integer,
        (v_line ->> 'unit_price')::integer,
        v_line_cost,
        false,
        v_cost_pending
      );

      continue;
    end if;

    select * into v_product from public.products where id = v_product_id;
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
$function$;

-- ---------------------------------------------------------------------------
-- create_refund: paid out of the refunding shop's drawer; remembers where the sale was
-- ---------------------------------------------------------------------------

create or replace function public.create_refund(
  p_staff_id uuid, p_amount pence, p_refund_tender tender_method, p_reason text,
  p_lines jsonb default '[]'::jsonb, p_sale_id uuid default null, p_order_id uuid default null,
  p_job_id uuid default null, p_original_tender tender_method default null,
  p_outside_window boolean default false, p_window_override_by uuid default null,
  p_stripe_refund_id text default null, p_stripe_refund_status text default null)
returns uuid
language plpgsql
as $function$
declare
  v_refund_id uuid;
  v_line jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_restock boolean;
  v_original_total pence;
  v_already_refunded pence;
  v_sold_qty integer;
  v_already_restocked integer;
  v_lock_id uuid;
  v_original_shop uuid;
  v_shop uuid;
begin
  if (case when p_sale_id is not null then 1 else 0 end)
   + (case when p_order_id is not null then 1 else 0 end)
   + (case when p_job_id is not null then 1 else 0 end) <> 1 then
    raise exception 'A refund must reference exactly one of a sale, an order, or a job';
  end if;

  -- The PARENT is locked (0076) so two concurrent refunds of one sale are serialised.
  if p_sale_id is not null then
    select total, shop_id into v_original_total, v_original_shop
      from public.sales where id = p_sale_id for update;
    if v_original_total is null then
      raise exception 'Sale % not found', p_sale_id;
    end if;
  elsif p_order_id is not null then
    select total, fulfilment_shop_id into v_original_total, v_original_shop
      from public.orders where id = p_order_id for update;
    if v_original_total is null then
      raise exception 'Order % not found', p_order_id;
    end if;
  else
    select id, shop_id into v_lock_id, v_original_shop from public.jobs where id = p_job_id for update;
    if v_lock_id is null then
      raise exception 'Job % not found', p_job_id;
    end if;
    select coalesce(sum(amount), 0) into v_original_total
    from public.job_payments where job_id = p_job_id;
  end if;

  -- The refunding shop is the cashier's. A cashier with no shop (an owner) refunds
  -- on behalf of the shop that took the money.
  v_shop := coalesce(public.staff_shop(p_staff_id), v_original_shop);

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
    outside_window, window_override_by, staff_id, stripe_refund_id, stripe_refund_status,
    shop_id, original_shop_id
  ) values (
    p_sale_id, p_order_id, p_job_id, p_amount, p_original_tender, p_refund_tender, p_reason,
    p_outside_window, p_window_override_by, p_staff_id, p_stripe_refund_id, p_stripe_refund_status,
    v_shop, v_original_shop
  )
  returning id into v_refund_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity   := (v_line ->> 'quantity')::integer;
    v_restock    := coalesce((v_line ->> 'restock')::boolean, false);

    -- Only this shop's own stock can be put back. A product sold by another shop
    -- is refunded but not restocked here (the master list maps it in step 3).
    if v_restock and v_product_id is not null
       and not exists (select 1 from public.products where id = v_product_id and shop_id = v_shop) then
      v_restock := false;
    end if;

    if v_restock and v_product_id is not null then
      if p_sale_id is not null then
        select coalesce(sum(quantity), 0) into v_sold_qty
        from public.sale_lines
        where sale_id = p_sale_id
          and product_id = v_product_id
          and variant_id is not distinct from v_variant_id;
      elsif p_order_id is not null then
        select coalesce(sum(quantity), 0) into v_sold_qty
        from public.order_lines
        where order_id = p_order_id
          and product_id = v_product_id
          and variant_id is not distinct from v_variant_id;
      else
        select coalesce(sum(quantity), 0) into v_sold_qty
        from public.job_parts
        where job_id = p_job_id
          and product_id = v_product_id;
      end if;

      if v_sold_qty = 0 then
        raise exception 'Product % was not part of this sale/order/job — cannot restock it', v_product_id;
      end if;

      select coalesce(sum(rl.quantity), 0) into v_already_restocked
      from public.refund_lines rl
      join public.refunds r on r.id = rl.refund_id
      where rl.restocked
        and rl.product_id = v_product_id
        and rl.variant_id is not distinct from v_variant_id
        and (
          (p_sale_id is not null and r.sale_id = p_sale_id)
          or (p_order_id is not null and r.order_id = p_order_id)
          or (p_job_id is not null and r.job_id = p_job_id)
        );

      if v_already_restocked + v_quantity > v_sold_qty then
        raise exception
          'Restocking % of product % would restock % in total against this sale/order/job, more than the % actually sold',
          v_quantity, v_product_id, v_already_restocked + v_quantity, v_sold_qty;
      end if;
    end if;

    insert into public.refund_lines (refund_id, product_id, variant_id, name, quantity, unit_price, restocked)
    values (
      v_refund_id,
      v_product_id,
      v_variant_id,
      v_line ->> 'name',
      v_quantity,
      (v_line ->> 'unit_price')::integer,
      v_restock
    );

    if v_restock and v_product_id is not null then
      perform public.stock_receive(
        v_product_id, v_quantity, null,
        'refund_restock', 'refund', v_refund_id, p_staff_id, null, v_variant_id
      );
    end if;
  end loop;

  return v_refund_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Jobs: payments, parts, conversion and trade-in restocks stay inside one shop
-- ---------------------------------------------------------------------------

create or replace function public.record_job_payment(
  p_job_id uuid, p_kind text, p_amount pence, p_tender tender_method, p_staff_id uuid default null)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid;
  v_paid_total pence;
  v_target pence;
  v_job_shop uuid;
  v_staff_shop uuid := public.staff_shop(p_staff_id);
begin
  select shop_id into v_job_shop from public.jobs where id = p_job_id;
  if v_job_shop is null then
    raise exception 'Job % not found', p_job_id;
  end if;
  if v_staff_shop is not null and v_staff_shop <> v_job_shop then
    raise exception 'Job % belongs to another shop', p_job_id;
  end if;

  insert into public.job_payments (job_id, kind, amount, tender, staff_id, shop_id)
  values (p_job_id, p_kind, p_amount, p_tender, p_staff_id, v_job_shop)
  returning id into v_id;

  select coalesce(sum(amount), 0) into v_paid_total
  from public.job_payments where job_id = p_job_id;

  select coalesce(revised_quote, quoted_price, 0) into v_target
  from public.jobs where id = p_job_id;

  if v_target > 0 and v_paid_total > v_target then
    raise exception 'Payment of % would bring the total paid on job % to %, more than its price of %',
      p_amount, p_job_id, v_paid_total, v_target;
  end if;

  -- The 'paid'::job_payment_status cast is load-bearing (see 0013).
  update public.jobs
     set payment_status = case
           when v_target > 0 and v_paid_total >= v_target then 'paid'::job_payment_status
           when v_paid_total > 0 then 'deposit_paid'
           else 'unpaid'
         end,
         deposit_amount = case
           when v_target > 0 and v_paid_total >= v_target then deposit_amount
           else v_paid_total
         end
   where id = p_job_id;

  return v_id;
end;
$function$;

create or replace function public.add_job_part(
  p_job_id uuid, p_product_id uuid, p_quantity integer, p_staff_id uuid default null)
returns uuid
language plpgsql
as $function$
declare
  v_cost_price pence;
  v_product_shop uuid;
  v_job_shop uuid;
  v_movement_id uuid;
  v_id uuid;
begin
  select cost_price, shop_id into v_cost_price, v_product_shop from public.products where id = p_product_id;
  if not found then
    raise exception 'Product % not found', p_product_id;
  end if;
  select shop_id into v_job_shop from public.jobs where id = p_job_id;
  if v_job_shop is distinct from v_product_shop then
    raise exception 'Product % belongs to another shop than job %', p_product_id, p_job_id;
  end if;

  v_movement_id := public.stock_consume(
    p_product_id, p_quantity, 'repair_part',
    'job', p_job_id, p_staff_id
  );

  insert into public.job_parts (job_id, product_id, quantity, unit_cost, stock_movement_id, added_by)
  values (p_job_id, p_product_id, p_quantity, v_cost_price, v_movement_id, p_staff_id)
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.convert_booking_to_job(
  p_booking_id uuid, p_staff_id uuid, p_quoted_price pence default null,
  p_intake_details jsonb default '{}'::jsonb)
returns uuid
language plpgsql
as $function$
declare
  v_booking   public.bookings;
  v_repair    public.repair_types;
  v_device    public.devices;
  v_existing  uuid;
  v_job_id    uuid;
  v_required  job_conversion_field[];
  v_field     job_conversion_field;
  v_staff_shop uuid := public.staff_shop(p_staff_id);
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Repair request % not found', p_booking_id;
  end if;
  if v_staff_shop is not null and v_staff_shop <> v_booking.shop_id then
    raise exception 'Repair request % belongs to another shop', v_booking.reference;
  end if;

  select id into v_existing from public.jobs where booking_id = p_booking_id limit 1;
  if v_existing is not null then
    raise exception 'Repair request % is already on the bench', v_booking.reference;
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'Repair request % was cancelled', v_booking.reference;
  end if;

  select * into v_repair from public.repair_types where id = v_booking.repair_type_id;
  select * into v_device from public.devices where id = v_booking.device_id;

  v_required := coalesce(v_repair.conversion_required_fields, '{quote}'::job_conversion_field[]);

  foreach v_field in array v_required loop
    if v_field = 'quote' then
      if p_quoted_price is null then
        raise exception 'A quote is required before this request can go on the bench';
      end if;
    else
      if nullif(btrim(coalesce(p_intake_details ->> v_field::text, '')), '') is null then
        raise exception 'Missing required detail: %', replace(v_field::text, '_', ' ');
      end if;
    end if;
  end loop;

  insert into public.jobs (
    source, booking_id, customer_name, phone, email,
    device_description, problem_description, notes,
    quoted_price, repair_type_id, device_id, part_tier,
    intake_details, assigned_staff_id, shop_id
  )
  values (
    'mail_in',
    v_booking.id,
    v_booking.customer_name,
    v_booking.phone,
    v_booking.email,
    coalesce(v_device.name, 'Device'),
    coalesce(v_repair.name, 'Repair') ||
      case when nullif(btrim(coalesce(v_booking.notes, '')), '') is null
           then ''
           else ' — ' || v_booking.notes end,
    v_booking.notes,
    p_quoted_price,
    v_booking.repair_type_id,
    v_booking.device_id,
    v_booking.tier,
    coalesce(p_intake_details, '{}'::jsonb),
    p_staff_id,
    v_booking.shop_id
  )
  returning id into v_job_id;

  update public.bookings
     set status = 'in_progress'
   where id = p_booking_id
     and status = 'received';

  return v_job_id;
end;
$function$;

create or replace function public.restock_trade_in(
  p_payout_id uuid, p_name text, p_category_id uuid, p_resale_price pence,
  p_kind product_kind default 'accessory', p_staff_id uuid default null, p_imei text default null)
returns uuid
language plpgsql
as $function$
declare
  v_payout    public.trade_in_payouts;
  v_unit_cost pence;
  v_product_id uuid;
  v_slug      text;
  v_imei      text;
  v_staff_shop uuid := public.staff_shop(p_staff_id);
begin
  select * into v_payout from public.trade_in_payouts where id = p_payout_id;
  if not found then
    raise exception 'Trade-in payout % not found', p_payout_id;
  end if;
  if v_staff_shop is not null and v_staff_shop <> v_payout.shop_id then
    raise exception 'Payout % belongs to another shop', p_payout_id;
  end if;
  if v_payout.restocked then
    raise exception 'Payout % has already been restocked', p_payout_id;
  end if;

  v_unit_cost := -v_payout.amount;
  v_slug := public.slugify(p_name) || '-' || p_payout_id::text;
  v_imei := nullif(regexp_replace(coalesce(p_imei, ''), '[^0-9A-Za-z]', '', 'g'), '');

  -- The resale item is stocked in the shop that paid for it.
  insert into public.products (slug, name, kind, category_id, price, cost_price, stock_qty, imei, shop_id)
  values (v_slug, p_name, p_kind, p_category_id, p_resale_price, v_unit_cost, 0, v_imei, v_payout.shop_id)
  returning id into v_product_id;

  perform public.stock_receive(
    v_product_id, 1, v_unit_cost, 'buy_in',
    'trade_in_payout', p_payout_id, p_staff_id
  );

  update public.trade_in_payouts
     set restocked = true, resale_price = p_resale_price, restocked_product_id = v_product_id
   where id = p_payout_id;

  return v_product_id;
end;
$function$;

-- A promotion row is tied to a product, so it runs in that product's shop. All the
-- products of one promotion must be in the same shop (p_shop_id, when given).
drop function public.upsert_promotion_group(uuid[], jsonb, uuid, text, boolean, timestamptz, timestamptz, uuid);
create function public.upsert_promotion_group(
  p_product_ids uuid[], p_tiers jsonb, p_group_id uuid default null, p_label text default null,
  p_active boolean default true, p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_created_by uuid default null, p_shop_id uuid default null)
returns uuid
language plpgsql
as $function$
declare
  v_group_id   uuid := coalesce(p_group_id, gen_random_uuid());
  v_product_id uuid;
  v_promo_id   uuid;
  v_tier       jsonb;
  v_min_qty    integer;
  v_unit_price integer;
  v_count      integer;
  v_missing    integer;
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'A promotion needs at least one product.';
  end if;

  select count(distinct id) into v_count from unnest(p_product_ids) as id;
  if v_count <> array_length(p_product_ids, 1) then
    raise exception 'The same product is listed more than once in this promotion.';
  end if;

  select count(*) into v_missing
  from unnest(p_product_ids) as wanted(id)
  where not exists (select 1 from public.products p where p.id = wanted.id);
  if v_missing > 0 then
    raise exception 'This promotion names % product(s) that no longer exist.', v_missing;
  end if;

  if p_shop_id is not null then
    select count(*) into v_missing
    from public.products p
    where p.id = any (p_product_ids) and p.shop_id <> p_shop_id;
    if v_missing > 0 then
      raise exception 'This promotion names % product(s) from another shop.', v_missing;
    end if;
  elsif (select count(distinct shop_id) from public.products where id = any (p_product_ids)) > 1 then
    raise exception 'A promotion cannot mix products from different shops.';
  end if;

  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    raise exception 'A promotion needs at least one bulk tier.';
  end if;

  for v_tier in select * from jsonb_array_elements(p_tiers) loop
    if v_tier->>'minQty' is null or v_tier->>'unitPrice' is null then
      raise exception 'Each tier needs a minQty and a unitPrice.';
    end if;
    v_min_qty := (v_tier->>'minQty')::integer;
    v_unit_price := (v_tier->>'unitPrice')::integer;
    if v_min_qty < 2 then
      raise exception 'Bulk pricing starts at 2 or more (got %).', v_min_qty;
    end if;
    if v_unit_price < 0 then
      raise exception 'A tier price cannot be negative (got %).', v_unit_price;
    end if;
  end loop;

  select count(distinct (t->>'minQty')::integer) into v_count
  from jsonb_array_elements(p_tiers) as t;
  if v_count <> jsonb_array_length(p_tiers) then
    raise exception 'Two tiers share the same quantity; which price applies would be arbitrary.';
  end if;

  delete from public.promotions
  where group_id = v_group_id
    and product_id <> all (p_product_ids);

  foreach v_product_id in array p_product_ids loop
    insert into public.promotions (group_id, product_id, label, is_active, starts_at, ends_at, created_by)
    values (v_group_id, v_product_id, p_label, p_active, p_starts_at, p_ends_at, p_created_by)
    on conflict (group_id, product_id) do update
      set label     = excluded.label,
          is_active = excluded.is_active,
          starts_at = excluded.starts_at,
          ends_at   = excluded.ends_at
    returning id into v_promo_id;

    delete from public.promo_tiers where promotion_id = v_promo_id;

    insert into public.promo_tiers (promotion_id, min_qty, unit_price)
    select v_promo_id, (t->>'minQty')::integer, (t->>'unitPrice')::integer
    from jsonb_array_elements(p_tiers) as t;

    insert into public.promotion_shops (promotion_id, shop_id)
    select v_promo_id, shop_id from public.products where id = v_product_id
    on conflict do nothing;
  end loop;

  return v_group_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Print queue: an agent only claims its own shop's jobs
-- ---------------------------------------------------------------------------

create or replace function public.claim_print_job(
  p_agent_id uuid, p_lease_seconds integer default 60, p_target print_target default null)
returns setof print_jobs
language plpgsql
as $function$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.print_agents
   where id = p_agent_id and is_primary and revoked_at is null;
  if v_shop is null then
    raise exception 'Agent is not the primary print agent.'
      using errcode = 'P0001';
  end if;

  return query
    with claimed as (
      update public.print_jobs j
         set status           = 'leased',
             lease_owner      = p_agent_id,
             lease_expires_at = now() + make_interval(secs => p_lease_seconds),
             attempts         = j.attempts + 1
       where j.id = (
         select id
           from public.print_jobs
          where status = 'queued'
            and shop_id = v_shop
            and (p_target is null or target = p_target)
          order by created_at
          for update skip locked
          limit 1
       )
      returning j.*
    )
    select * from claimed;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Money ledger and reports: a shop_id column, and an optional shop filter
-- ---------------------------------------------------------------------------

create or replace view public.transactions as
 WITH job_running AS (
         SELECT jp.id, jp.at, jp.job_id, jp.amount, jp.tender, jp.staff_id,
            sum((jp.amount)::integer) OVER (PARTITION BY jp.job_id ORDER BY jp.at, jp.id) AS cum_through
           FROM job_payments jp
        ), refund_restock_cost AS (
         SELECT rl.refund_id,
            sum((rl.quantity * COALESCE((( SELECT sl.cost_price
                   FROM sale_lines sl
                  WHERE ((sl.sale_id = r.sale_id) AND (sl.product_id = rl.product_id) AND (NOT (sl.variant_id IS DISTINCT FROM rl.variant_id)))
                  ORDER BY sl.created_at
                 LIMIT 1))::integer, (( SELECT ol.cost_price
                   FROM order_lines ol
                  WHERE ((ol.order_id = r.order_id) AND (ol.product_id = rl.product_id) AND (NOT (ol.variant_id IS DISTINCT FROM rl.variant_id)))
                  ORDER BY ol.created_at
                 LIMIT 1))::integer, (( SELECT jp.unit_cost
                   FROM job_parts jp
                  WHERE ((jp.job_id = r.job_id) AND (jp.product_id = rl.product_id))
                  ORDER BY jp.added_at
                 LIMIT 1))::integer, 0))) AS cost
           FROM (refund_lines rl
             JOIN refunds r ON ((r.id = rl.refund_id)))
          WHERE rl.restocked
          GROUP BY rl.refund_id
        )
 SELECT s.id,
    s.created_at AS at,
    'shop'::text AS stream,
    s.reference,
    (s.total)::integer AS amount,
    (s.cost)::integer AS cost,
    NULL::text AS tender,
    s.staff_id,
    s.shop_id
   FROM sales s
UNION ALL
 SELECT o.id,
    o.paid_at AS at,
    'shop'::text AS stream,
    o.reference,
    (o.total)::integer AS amount,
    (COALESCE(( SELECT sum(((ol.cost_price)::integer * ol.quantity)) AS sum
           FROM order_lines ol
          WHERE (ol.order_id = o.id)), (0)::bigint))::integer AS cost,
    NULL::text AS tender,
    NULL::uuid AS staff_id,
    o.fulfilment_shop_id AS shop_id
   FROM orders o
  WHERE (o.paid_at IS NOT NULL)
UNION ALL
 SELECT jr.id,
    jr.at,
    'repair'::text AS stream,
    j.reference,
    (jr.amount)::integer AS amount,
        CASE
            WHEN ((COALESCE((j.revised_quote)::integer, (j.quoted_price)::integer, 0) > 0) AND (jr.cum_through >= COALESCE((j.revised_quote)::integer, (j.quoted_price)::integer, 0)) AND ((jr.cum_through - (jr.amount)::integer) < COALESCE((j.revised_quote)::integer, (j.quoted_price)::integer, 0))) THEN (COALESCE(( SELECT sum(((part.unit_cost)::integer * part.quantity)) AS sum
               FROM job_parts part
              WHERE (part.job_id = j.id)), (0)::bigint))::integer
            ELSE 0
        END AS cost,
    (jr.tender)::text AS tender,
    jr.staff_id,
    j.shop_id
   FROM (job_running jr
     JOIN jobs j ON ((j.id = jr.job_id)))
UNION ALL
 SELECT t.id,
    t.created_at AS at,
    'trade-in'::text AS stream,
    t.reference,
    (t.amount)::integer AS amount,
    0 AS cost,
    t.method AS tender,
    t.staff_id,
    t.shop_id
   FROM trade_in_payouts t
UNION ALL
 SELECT r.id,
    r.created_at AS at,
        CASE
            WHEN (r.job_id IS NOT NULL) THEN 'repair'::text
            ELSE 'shop'::text
        END AS stream,
    COALESCE(s.reference, o.reference, jb.reference, 'NO-RECEIPT'::text) AS reference,
    (- (r.amount)::integer) AS amount,
    ((- COALESCE(rrc.cost, (0)::bigint)))::integer AS cost,
    (r.refund_tender)::text AS tender,
    r.staff_id,
    r.shop_id
   FROM ((((refunds r
     LEFT JOIN sales s ON ((s.id = r.sale_id)))
     LEFT JOIN orders o ON ((o.id = r.order_id)))
     LEFT JOIN jobs jb ON ((jb.id = r.job_id)))
     LEFT JOIN refund_restock_cost rrc ON ((rrc.refund_id = r.id)));

create or replace view public.low_stock_products as
 SELECT p.id,
    p.name,
    c.slug AS category,
    p.stock_qty,
    p.low_stock_threshold,
    NULL::uuid AS variant_id,
    p.shop_id
   FROM (products p
     JOIN categories c ON ((c.id = p.category_id)))
  WHERE (p.is_active AND (NOT p.has_variants) AND p.low_stock_alert AND (p.stock_qty > 0) AND (p.stock_qty <= p.low_stock_threshold))
UNION ALL
 SELECT v.id,
    ((p.name || ' — '::text) || ( SELECT string_agg(jsonb_each_text.value, ', '::text) AS string_agg
           FROM jsonb_each_text(v.options) jsonb_each_text(key, value))) AS name,
    c.slug AS category,
    v.stock_qty,
    v.low_stock_threshold,
    v.id AS variant_id,
    p.shop_id
   FROM ((product_variants v
     JOIN products p ON ((p.id = v.product_id)))
     JOIN categories c ON ((c.id = p.category_id)))
  WHERE (p.is_active AND v.is_active AND v.low_stock_alert AND (v.stock_qty > 0) AND (v.stock_qty <= v.low_stock_threshold));

-- today_takings / today_takings_by_tender were never read by the API (pos_today_* are).
-- They keep meaning "every shop".

drop function public.analytics_totals(date, date);
create function public.analytics_totals(p_from date, p_to date, p_shop_id uuid default null)
returns table(revenue pence, cost pence, profit pence, margin numeric)
language sql stable
as $$
  select
    coalesce(sum(amount), 0)::integer as revenue,
    coalesce(sum(cost), 0)::integer as cost,
    coalesce(sum(amount) - sum(cost), 0)::integer as profit,
    case when sum(amount) > 0
         then round((sum(amount) - sum(cost))::numeric / sum(amount), 4)
         else 0
    end as margin
  from public.transactions
  where stream <> 'trade-in'
    and public.shop_day(at) between p_from and p_to
    and (p_shop_id is null or shop_id = p_shop_id);
$$;

drop function public.analytics_series(date, date);
create function public.analytics_series(p_from date, p_to date, p_shop_id uuid default null)
returns table(bucket_date date, bucket_label text, revenue pence, cost pence, shop_revenue pence, repair_revenue pence)
language plpgsql stable
as $function$
declare
  v_daily boolean := (p_to - p_from) <= 62;
begin
  return query
  select
    b.bucket_date,
    to_char(b.bucket_date, case when v_daily then 'DD Mon' else 'Mon YYYY' end) as bucket_label,
    sum(b.amount)::integer::pence as revenue,
    sum(b.cost)::integer::pence as cost,
    sum(b.amount) filter (where b.stream = 'shop')::integer::pence as shop_revenue,
    sum(b.amount) filter (where b.stream = 'repair')::integer::pence as repair_revenue
  from (
    select
      case when v_daily
           then public.shop_day(t.at)
           else date_trunc('month', public.shop_day(t.at))::date
      end as bucket_date,
      t.amount,
      t.cost,
      t.stream
    from public.transactions t
    where t.stream <> 'trade-in'
      and public.shop_day(t.at) between p_from and p_to
      and (p_shop_id is null or t.shop_id = p_shop_id)
  ) b
  group by b.bucket_date
  order by b.bucket_date;
end;
$function$;

drop function public.busiest_times(date, date);
create function public.busiest_times(p_from date, p_to date, p_shop_id uuid default null)
returns table(weekday integer, hour integer, sale_count integer)
language sql stable
as $$
  select
    public.shop_weekday(at) as weekday,
    public.shop_hour(at) as hour,
    count(*)::integer as sale_count
  from public.transactions
  where amount > 0
    and public.shop_day(at) between p_from and p_to
    and (p_shop_id is null or shop_id = p_shop_id)
  group by 1, 2;
$$;

drop function public.revenue_by_category(date, date);
create function public.revenue_by_category(p_from date, p_to date, p_shop_id uuid default null)
returns table(category_id uuid, category_label text, revenue pence, units integer)
language sql stable
as $$
  select c.id, c.label, sum(combined.revenue)::integer as revenue, sum(combined.units)::integer as units
  from (
    select p.category_id, sl.line_total as revenue, sl.quantity as units, s.created_at as at, s.shop_id
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    join public.products p on p.id = sl.product_id

    union all

    select p.category_id, ol.line_total, ol.quantity, o.paid_at as at, o.fulfilment_shop_id
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.paid_at is not null
    join public.products p on p.id = ol.product_id
  ) combined
  join public.categories c on c.id = combined.category_id
  where public.shop_day(combined.at) between p_from and p_to
    and (p_shop_id is null or combined.shop_id = p_shop_id)
  group by c.id, c.label
  order by revenue desc;
$$;

drop function public.tender_totals(date, date);
create function public.tender_totals(p_from date, p_to date, p_shop_id uuid default null)
returns table(tender text, payment_count integer, total pence)
language sql stable
as $$
  select combined.tender::text, count(*)::integer, coalesce(sum(combined.amount), 0)::integer
  from (
    select sp.tender, sp.amount, sp.created_at, s.shop_id
      from public.sale_payments sp join public.sales s on s.id = sp.sale_id
    union all
    select tender, amount, at as created_at, shop_id from public.job_payments
  ) combined
  where public.shop_day(combined.created_at) between p_from and p_to
    and (p_shop_id is null or combined.shop_id = p_shop_id)
  group by combined.tender;
$$;

drop function public.inventory_summary();
create function public.inventory_summary(p_shop_id uuid default null)
returns table(total_stock integer, total_value_pence pence, retired_stock integer, retired_value_pence pence)
language sql stable
as $$
  select
    coalesce(sum(units), 0)::integer                                as total_stock,
    coalesce(sum(units * unit_cost), 0)::integer                    as total_value_pence,
    coalesce(sum(units) filter (where retired), 0)::integer         as retired_stock,
    coalesce(sum(units * unit_cost) filter (where retired), 0)::integer
                                                                    as retired_value_pence
  from (
    select p.stock_qty as units, p.cost_price as unit_cost, not p.is_active as retired
    from public.products p
    where not p.has_variants and (p_shop_id is null or p.shop_id = p_shop_id)

    union all

    select v.stock_qty, v.cost_price, not (p.is_active and v.is_active)
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where p.has_variants and (p_shop_id is null or p.shop_id = p_shop_id)
  ) combined;
$$;

-- ---------------------------------------------------------------------------
-- Today at the till and card-limit usage: per shop
-- ---------------------------------------------------------------------------

drop function public.pos_today_summary();
create function public.pos_today_summary(p_shop_id uuid default null)
returns table(total pence, sales_count integer)
language sql stable
as $$
  select coalesce(sum(s.total), 0)::integer, count(*)::integer
  from public.sales s
  where public.shop_day(s.created_at) = public.shop_day(now())
    and (p_shop_id is null or s.shop_id = p_shop_id);
$$;

drop function public.pos_today_report();
create function public.pos_today_report(p_shop_id uuid default null)
returns jsonb
language sql stable
as $function$
  with today_sales as (
    select s.id, s.reference, s.total, s.created_at,
           (select count(*) from public.sale_lines sl where sl.sale_id = s.id) as item_count,
           (select coalesce(sum(sl.quantity), 0) from public.sale_lines sl where sl.sale_id = s.id) as unit_count
    from public.sales s
    where public.shop_day(s.created_at) = public.shop_day(now())
      and (p_shop_id is null or s.shop_id = p_shop_id)
  ),
  sales_tender_agg as (
    select sp.tender, count(*)::integer as cnt, sum(sp.amount)::integer as tot
    from public.sale_payments sp
    join today_sales ts on ts.id = sp.sale_id
    group by sp.tender
  ),
  all_tender_agg as (
    select tender, count(*)::integer as cnt, sum(amount)::integer as tot
    from (
      select sp.tender, sp.amount, sp.created_at
      from public.sale_payments sp
      join today_sales ts on ts.id = sp.sale_id
      union all
      select jp.tender, jp.amount, jp.at as created_at
      from public.job_payments jp
      where p_shop_id is null or jp.shop_id = p_shop_id
    ) combined
    where public.shop_day(created_at) = public.shop_day(now())
    group by tender
  )
  select jsonb_build_object(
    'date', public.shop_day(now()),
    'total', coalesce((select sum(total) from today_sales), 0),
    'salesCount', (select count(*) from today_sales),
    'averageSale', case when (select count(*) from today_sales) > 0
                        then round((select sum(total) from today_sales)::numeric / (select count(*) from today_sales))
                        else 0 end,
    'lastSaleAt', (select max(created_at) from today_sales),
    'itemsSold', coalesce((select sum(unit_count) from today_sales), 0),
    'jobsCompleted', (
      select count(*)
      from public.jobs j
      where j.status in ('collected', 'sent_back')
        and public.shop_day(j.updated_at) = public.shop_day(now())
        and (p_shop_id is null or j.shop_id = p_shop_id)
    ),
    'repairTakings', coalesce((
      select sum(jp.amount)::integer
      from public.job_payments jp
      where public.shop_day(jp.at) = public.shop_day(now())
        and (p_shop_id is null or jp.shop_id = p_shop_id)
    ), 0),
    'byTender', coalesce(
      (select jsonb_agg(jsonb_build_object('tender', tender, 'count', cnt, 'total', tot) order by tot desc)
       from all_tender_agg),
      '[]'::jsonb
    ),
    'salesByTender', coalesce(
      (select jsonb_agg(jsonb_build_object('tender', tender, 'count', cnt, 'total', tot) order by tot desc)
       from sales_tender_agg),
      '[]'::jsonb
    ),
    'sales', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', ts.id,
            'reference', ts.reference,
            'at', ts.created_at,
            'total', ts.total,
            'tenders', (
              select coalesce(jsonb_agg(sp.tender order by sp.created_at), '[]'::jsonb)
              from public.sale_payments sp where sp.sale_id = ts.id
            ),
            'description', 'POS sale - ' || ts.item_count || ' item' || case when ts.item_count = 1 then '' else 's' end
          )
          order by ts.created_at desc
        )
        from today_sales ts
      ),
      '[]'::jsonb
    )
  );
$function$;

drop function public.card_payment_usage(tender_method);
create function public.card_payment_usage(p_tender tender_method, p_shop_id uuid)
returns table(daily pence, weekly pence, monthly pence)
language sql stable
as $function$
  with bounds as (
    select public.shop_day(now()) as d,
           least(
             date_trunc('week', public.shop_day(now()))::date,
             date_trunc('month', public.shop_day(now()))::date
           ) - 2 as since
  ),
  paid as (
    select sp.amount, public.shop_day(sp.created_at) as day
    from public.sale_payments sp
    join public.sales s on s.id = sp.sale_id
    where sp.tender = p_tender
      and s.shop_id = p_shop_id
      and sp.created_at >= (select since from bounds)
    union all
    select jp.amount, public.shop_day(jp.at) as day
    from public.job_payments jp
    where jp.tender = p_tender
      and jp.shop_id = p_shop_id
      and jp.at >= (select since from bounds)
  )
  select
    coalesce(sum(amount) filter (where day = (select d from bounds)), 0)::integer,
    coalesce(sum(amount) filter (
      where day >= date_trunc('week', (select d from bounds))::date
    ), 0)::integer,
    coalesce(sum(amount) filter (
      where day >= date_trunc('month', (select d from bounds))::date
    ), 0)::integer
  from paid;
$function$;

-- ---------------------------------------------------------------------------
-- Card limits live on the shop (each shop has its own machines)
-- ---------------------------------------------------------------------------

drop function public.card_limit_breach(tender_method, pence);
create function public.card_limit_breach(p_tender tender_method, p_amount pence, p_shop_id uuid)
returns text
language plpgsql stable
as $function$
declare
  s public.shops;
  u record;
  v_daily   pence;
  v_weekly  pence;
  v_monthly pence;
begin
  if p_tender not in ('pos1', 'pos2') then
    return null;
  end if;

  select * into s from public.shops where id = p_shop_id;
  if not found then
    return null;
  end if;

  if p_tender = 'pos1' then
    v_daily := s.card1_daily_limit;
    v_weekly := s.card1_weekly_limit;
    v_monthly := s.card1_monthly_limit;
  else
    v_daily := s.card2_daily_limit;
    v_weekly := s.card2_weekly_limit;
    v_monthly := s.card2_monthly_limit;
  end if;

  if v_daily is null and v_weekly is null and v_monthly is null then
    return null;
  end if;

  select * into u from public.card_payment_usage(p_tender, p_shop_id);

  if v_daily is not null and u.daily + p_amount > v_daily then
    return format(
      '%s is over its daily limit. %s already taken today, limit %s, this payment %s.',
      case p_tender when 'pos1' then 'Card 1' else 'Card 2' end,
      trim(to_char(u.daily / 100.0, 'FM£999999990.00')),
      trim(to_char(v_daily / 100.0, 'FM£999999990.00')),
      trim(to_char(p_amount / 100.0, 'FM£999999990.00'))
    );
  end if;

  if v_weekly is not null and u.weekly + p_amount > v_weekly then
    return format(
      '%s is over its weekly limit. %s already taken this week, limit %s, this payment %s.',
      case p_tender when 'pos1' then 'Card 1' else 'Card 2' end,
      trim(to_char(u.weekly / 100.0, 'FM£999999990.00')),
      trim(to_char(v_weekly / 100.0, 'FM£999999990.00')),
      trim(to_char(p_amount / 100.0, 'FM£999999990.00'))
    );
  end if;

  if v_monthly is not null and u.monthly + p_amount > v_monthly then
    return format(
      '%s is over its monthly limit. %s already taken this month, limit %s, this payment %s.',
      case p_tender when 'pos1' then 'Card 1' else 'Card 2' end,
      trim(to_char(u.monthly / 100.0, 'FM£999999990.00')),
      trim(to_char(v_monthly / 100.0, 'FM£999999990.00')),
      trim(to_char(p_amount / 100.0, 'FM£999999990.00'))
    );
  end if;

  return null;
end;
$function$;

-- The two payment tables each know their shop (a sale payment through its sale).
create or replace function public.validate_card_payment_limit()
returns trigger
language plpgsql
as $function$
declare
  v_message text;
  v_shop uuid;
begin
  if tg_table_name = 'sale_payments' then
    select shop_id into v_shop from public.sales where id = new.sale_id;
  else
    v_shop := new.shop_id;
  end if;
  v_message := public.card_limit_breach(new.tender, new.amount, v_shop);
  if v_message is not null then
    raise exception '%', v_message using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;
