-- 0099 — the master list (stage 3, multi-shop, step 3).
--
-- A master product links the copies of one product that different shops stock. Each shop keeps
-- its own copy — own price, own stock, own barcode — and the website sells the master:
--
--   * ONE listing per master. Its content comes from the representative copy (the lowest
--     shop sort order that stocks it, so Shop 1's when it has one); its URL is the master's
--     slug, which never changes.
--   * The price is the HIGHEST price any shop's copy asks (per variant).
--   * Stock is COMBINED across shops. An order the shops can only meet together is allowed.
--   * An order is split into one order line per shop copy, taking Shop 1's stock first, then
--     the other shops in sort order. Paying, cancelling and restocking therefore already work
--     per shop: they act on the copy each line names.
--
-- A product with no master is till-only: it is never listed, priced or sold online.
-- Every product the hub shop already had is given a master of its own here, so the website
-- keeps exactly what it sells today.
--
-- Variants are matched across copies by their options (e.g. {"Colour":"Black"}).

create table public.master_products (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  created_at timestamptz not null default now()
);
alter table public.master_products enable row level security;
alter table public.master_products force row level security;

alter table public.products add column master_product_id uuid references public.master_products(id);
create index products_master_idx on public.products (master_product_id) where master_product_id is not null;
create unique index products_one_copy_per_shop_idx
  on public.products (shop_id, master_product_id) where master_product_id is not null;

-- Everything the hub shop already stocks becomes a master of its own (slug kept, so URLs hold).
with created as (
  insert into public.master_products (slug)
  select slug from public.products where shop_id = public.default_shop_id()
  returning id, slug
)
update public.products p
   set master_product_id = created.id
  from created
 where created.slug = p.slug and p.shop_id = public.default_shop_id();

-- A new product joins the master list by default (the "Add to Master List" box is ticked); the
-- API unticks it with unlink_product_from_master() when staff ask for a till-only product.
-- A copy made from a master arrives already linked, so the trigger leaves it alone.
create function public.products_auto_master() returns trigger
language plpgsql
as $$
begin
  if new.master_product_id is null then
    insert into public.master_products (slug) values (new.slug) returning id into new.master_product_id;
  end if;
  return new;
end
$$;

create trigger products_auto_master
  before insert on public.products
  for each row execute function public.products_auto_master();

-- ---------------------------------------------------------------------------
-- What the website can see
-- ---------------------------------------------------------------------------

-- The copies that count online: live, not in-store-only, in an open shop.
create view public.online_copies as
select p.id as product_id, p.master_product_id as master_id, p.shop_id, s.sort_order,
       p.price, p.cost_price, p.stock_qty, p.has_variants, p.created_at
  from public.products p
  join public.shops s on s.id = p.shop_id
 where p.master_product_id is not null
   and p.is_active and not p.in_store_only and s.is_active;

-- One row per master: the representative copy's content, the master's slug, the highest price.
create view public.online_products as
select rep.id, m.slug, rep.name, rep.sub, rep.description, rep.category_id, rep.kind,
       (select max(c.price) from public.online_copies c where c.master_id = m.id)::integer as price,
       rep.created_at, rep.tag, rep.compatibility, rep.has_variants, rep.free_delivery,
       true as is_active, false as in_store_only, m.id as master_id
  from public.master_products m
  join lateral (
    select p.*
      from public.online_copies c
      join public.products p on p.id = c.product_id
     where c.master_id = m.id
     order by c.sort_order, c.created_at
     limit 1
  ) rep on true;

create function public.online_master_of(p_product_id uuid) returns uuid
language sql stable
as $$ select master_product_id from public.products where id = p_product_id $$;

-- The price a customer pays: the highest among the copies (variant: price + its adjustment).
create function public.online_unit_price(p_product_id uuid, p_variant_id uuid default null)
returns pence
language sql stable
as $$
  select max(c.price + coalesce(v.price_adjustment, 0))::integer::pence
    from public.online_copies c
    left join public.product_variants v
           on v.product_id = c.product_id and v.is_active and p_variant_id is not null
          and v.options = (select options from public.product_variants where id = p_variant_id)
   where c.master_id = public.online_master_of(p_product_id)
     and (p_variant_id is null or v.id is not null);
$$;

-- Combined units on the shelves of every shop.
create function public.online_available_qty(p_product_id uuid, p_variant_id uuid default null)
returns integer
language sql stable
as $$
  select coalesce(sum(case when p_variant_id is null then c.stock_qty else v.stock_qty end), 0)::integer
    from public.online_copies c
    left join public.product_variants v
           on v.product_id = c.product_id and v.is_active and p_variant_id is not null
          and v.options = (select options from public.product_variants where id = p_variant_id)
   where c.master_id = public.online_master_of(p_product_id)
     and (p_variant_id is null or v.id is not null);
$$;

-- The customer-facing three-state status, over every shop (never a count).
create function public.online_stock_status(p_product_id uuid)
returns stock_status
language sql stable
as $$
  with m as (select public.online_master_of(p_product_id) as id)
  select case
    when (select id from m) is null then public.stock_status_for(p_product_id)
    when exists (
      select 1 from public.online_copies c
       where c.master_id = (select id from m)
         and ((not c.has_variants and c.stock_qty > 0)
              or (c.has_variants and exists (
                    select 1 from public.product_variants v
                     where v.product_id = c.product_id and v.is_active and v.stock_qty > 0)))
    ) then 'in-stock'::stock_status
    when exists (
      select 1 from public.stock_movements mv
        join public.online_copies c on c.product_id = mv.product_id
       where c.master_id = (select id from m)
         and mv.kind = 'receipt' and mv.created_at > now() - interval '30 days'
    ) then 'restocking'::stock_status
    else 'out-of-stock'::stock_status
  end;
$$;

create function public.online_stock_status(p_product_id uuid, p_variant_id uuid)
returns stock_status
language sql stable
as $$
  select case
    when p_variant_id is null then public.online_stock_status(p_product_id)
    when public.online_available_qty(p_product_id, p_variant_id) > 0 then 'in-stock'::stock_status
    when exists (
      select 1 from public.stock_movements mv
        join public.product_variants v on v.id = mv.variant_id
        join public.online_copies c on c.product_id = v.product_id
       where c.master_id = public.online_master_of(p_product_id)
         and v.options = (select options from public.product_variants where id = p_variant_id)
         and mv.kind = 'receipt' and mv.created_at > now() - interval '30 days'
    ) then 'restocking'::stock_status
    else 'out-of-stock'::stock_status
  end;
$$;

create function public.online_stock_status_many(p_product_ids uuid[])
returns table(product_id uuid, status stock_status)
language sql stable
as $$
  select p.id, public.online_stock_status(p.id)
    from public.products p
   where p.id = any (p_product_ids);
$$;

-- Plan which shop's copy meets an online order: Shop 1 first, then the others in sort order.
-- Returns one row per copy used. Raises when the shops together cannot cover the quantity.
create function public.allocate_online_stock(p_product_id uuid, p_variant_id uuid, p_qty integer)
returns table(product_id uuid, variant_id uuid, qty integer)
language plpgsql stable
as $$
declare
  v_left    integer := p_qty;
  v_master  uuid := public.online_master_of(p_product_id);
  v_options jsonb;
  v_avail   integer;
  v_variant uuid;
  v_take    integer;
  r         record;
begin
  if p_qty <= 0 then
    raise exception 'Quantity must be positive, got %', p_qty;
  end if;
  if v_master is null then
    raise exception 'Product % cannot be sold online', p_product_id;
  end if;
  if p_variant_id is not null then
    select options into v_options from public.product_variants where id = p_variant_id;
  end if;

  for r in
    select c.product_id as pid, c.stock_qty
      from public.online_copies c
     where c.master_id = v_master
     order by c.sort_order, c.created_at
  loop
    if p_variant_id is null then
      v_avail := r.stock_qty;
      v_variant := null;
    else
      select v.id, v.stock_qty into v_variant, v_avail
        from public.product_variants v
       where v.product_id = r.pid and v.is_active and v.options = v_options;
      if not found then
        continue;
      end if;
    end if;

    v_take := least(v_left, greatest(v_avail, 0));
    if v_take > 0 then
      product_id := r.pid;
      variant_id := v_variant;
      qty := v_take;
      return next;
      v_left := v_left - v_take;
    end if;
    exit when v_left = 0;
  end loop;

  if v_left > 0 then
    raise exception 'Not enough stock for product %', p_product_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_order: online orders sell the master, split across shops
-- ---------------------------------------------------------------------------

create or replace function public.create_order(
  p_lines jsonb, p_delivery_method delivery_method, p_customer_id uuid default null,
  p_guest_email citext default null, p_recipient_name text default null,
  p_address_line1 text default null, p_address_line2 text default null, p_city text default null,
  p_county text default null, p_postcode text default null, p_discount pence default 0,
  p_phone text default null, p_payment_provider text default null)
returns uuid
language plpgsql
as $function$
declare
  v_order_id     uuid;
  v_line         jsonb;
  v_rep          public.online_products;
  v_variant_id   uuid;
  v_unit_price   pence;
  v_subtotal     pence := 0;
  v_zone_id      uuid;
  v_delivery_fee pence := 0;
  v_zone_code    text;
  v_alloc        record;
  v_copy         public.products;
  v_copy_variant public.product_variants;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one line';
  end if;

  if p_payment_provider is not null and p_payment_provider not in ('stripe', 'clearpay') then
    raise exception 'Unknown payment provider %', p_payment_provider;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_rep from public.online_products
     where master_id = public.online_master_of((v_line ->> 'product_id')::uuid);
    if not found then
      raise exception 'Product % cannot be sold online', v_line ->> 'product_id';
    end if;
    if v_rep.kind = 'vape' then
      raise exception 'Product % cannot be sold online', v_line ->> 'product_id';
    end if;

    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
    if v_variant_id is not null then
      if not exists (
        select 1 from public.product_variants v
          join public.online_copies c on c.product_id = v.product_id
         where v.id = v_variant_id and v.is_active and c.master_id = v_rep.master_id
      ) then
        raise exception 'Variant % cannot be sold online', v_variant_id;
      end if;
    end if;

    v_unit_price := public.online_unit_price((v_line ->> 'product_id')::uuid, v_variant_id);
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

  -- One order line per shop copy that supplies the customer's line, all at the one price.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_rep from public.online_products
     where master_id = public.online_master_of((v_line ->> 'product_id')::uuid);
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
    v_unit_price := public.online_unit_price((v_line ->> 'product_id')::uuid, v_variant_id);

    for v_alloc in
      select * from public.allocate_online_stock(
        (v_line ->> 'product_id')::uuid, v_variant_id, (v_line ->> 'quantity')::integer)
    loop
      select * into v_copy from public.products where id = v_alloc.product_id;
      if v_alloc.variant_id is not null then
        select * into v_copy_variant from public.product_variants where id = v_alloc.variant_id;
      end if;

      insert into public.order_lines (order_id, product_id, variant_id, name, unit_price, cost_price, quantity)
      values (
        v_order_id, v_alloc.product_id, v_alloc.variant_id,
        case when v_alloc.variant_id is not null then
          v_rep.name || ' — ' || (select string_agg(value::text, ', ') from jsonb_each_text(v_copy_variant.options))
        else v_rep.name end,
        v_unit_price,
        case when v_alloc.variant_id is not null then v_copy_variant.cost_price else v_copy.cost_price end,
        v_alloc.qty
      );
    end loop;
  end loop;

  return v_order_id;
end;
$function$;

-- A review is allowed to someone who bought ANY shop's copy of the product.
create or replace function public.customer_purchased_product(p_customer_id uuid, p_product_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
      from public.order_lines ol
      join public.orders o on o.id = ol.order_id
      join public.products bought on bought.id = ol.product_id
      join public.products asked on asked.id = p_product_id
     where o.customer_id = p_customer_id
       and (bought.id = asked.id
            or (bought.master_product_id is not null
                and bought.master_product_id = asked.master_product_id))
       and o.status not in ('pending', 'cancelled')
  );
$$;

-- ---------------------------------------------------------------------------
-- Staff operations on the master list
-- ---------------------------------------------------------------------------

-- Put a product on the master list as a new master (its slug becomes the public URL).
create function public.create_master_for_product(p_product_id uuid) returns uuid
language plpgsql
as $$
declare
  v_product public.products;
  v_master  uuid;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product % not found', p_product_id;
  end if;
  if v_product.master_product_id is not null then
    return v_product.master_product_id;
  end if;
  insert into public.master_products (slug) values (v_product.slug) returning id into v_master;
  update public.products set master_product_id = v_master where id = p_product_id;
  return v_master;
end;
$$;

-- Link a product to an existing master. A shop can only have one copy of a master.
create function public.link_product_to_master(p_product_id uuid, p_master_id uuid) returns void
language plpgsql
as $$
declare
  v_product public.products;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product % not found', p_product_id;
  end if;
  if not exists (select 1 from public.master_products where id = p_master_id) then
    raise exception 'That master product no longer exists';
  end if;
  if exists (
    select 1 from public.products
     where shop_id = v_product.shop_id and master_product_id = p_master_id and id <> p_product_id
  ) then
    raise exception 'This shop already has a copy of that master product';
  end if;
  update public.products set master_product_id = p_master_id where id = p_product_id;
end;
$$;

-- Take a product off the master list (it becomes till-only). An emptied master is removed.
create function public.unlink_product_from_master(p_product_id uuid) returns void
language plpgsql
as $$
declare
  v_master uuid;
begin
  select master_product_id into v_master from public.products where id = p_product_id for update;
  update public.products set master_product_id = null where id = p_product_id;
  if v_master is not null
     and not exists (select 1 from public.products where master_product_id = v_master) then
    delete from public.master_products where id = v_master;
  end if;
end;
$$;

-- "Add Product from Master List": copy a master product into a shop. Content comes from the
-- representative copy; price starts at the online price; cost and stock start at zero (each
-- shop counts its own). The copy's barcode and variant options carry across.
create function public.copy_master_to_shop(p_master_id uuid, p_shop_id uuid, p_staff_id uuid default null)
returns uuid
language plpgsql
as $$
declare
  v_src      public.online_products;
  v_rep      public.products;
  v_new      uuid;
  v_variant  public.product_variants;
begin
  select * into v_src from public.online_products where master_id = p_master_id;
  if not found then
    -- Not currently sold online (e.g. every copy is retired): fall back to any copy.
    select * into v_rep from public.products where master_product_id = p_master_id order by created_at limit 1;
    if not found then
      raise exception 'That master product no longer exists';
    end if;
  else
    select * into v_rep from public.products where id = v_src.id;
  end if;

  if exists (select 1 from public.products where shop_id = p_shop_id and master_product_id = p_master_id) then
    raise exception 'This shop already has a copy of that master product';
  end if;

  insert into public.products (
    slug, name, sub, description, category_id, price, cost_price, stock_qty, barcode, supplier_id,
    low_stock_alert, low_stock_threshold, in_store_only, tag, compatibility, has_variants,
    free_delivery, shop_id, master_product_id
  ) values (
    v_rep.slug || '-' || substr(gen_random_uuid()::text, 1, 8),
    v_rep.name, v_rep.sub, v_rep.description, v_rep.category_id,
    coalesce(v_src.price, v_rep.price), 0, 0, v_rep.barcode, null,
    v_rep.low_stock_alert, v_rep.low_stock_threshold, v_rep.in_store_only, v_rep.tag,
    v_rep.compatibility, v_rep.has_variants, v_rep.free_delivery, p_shop_id, p_master_id
  )
  returning id into v_new;

  insert into public.product_images (product_id, url, position)
  select v_new, url, position from public.product_images where product_id = v_rep.id;

  if v_rep.has_variants then
    for v_variant in select * from public.product_variants where product_id = v_rep.id and is_active loop
      insert into public.product_variants (product_id, options, sku, barcode, price_adjustment, cost_price, stock_qty,
                                           low_stock_alert, low_stock_threshold, is_active)
      values (v_new, v_variant.options, v_variant.sku, v_variant.barcode, v_variant.price_adjustment, 0, 0,
              v_variant.low_stock_alert, v_variant.low_stock_threshold, true);
    end loop;
  end if;

  return v_new;
end;
$$;

-- An online order's lines go back to the shop copy they were taken from, whichever shop
-- processes the refund (a till refund still only restocks its own shop's products).
CREATE OR REPLACE FUNCTION public.create_refund(p_staff_id uuid, p_amount pence, p_refund_tender tender_method, p_reason text, p_lines jsonb DEFAULT '[]'::jsonb, p_sale_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_job_id uuid DEFAULT NULL::uuid, p_original_tender tender_method DEFAULT NULL::tender_method, p_outside_window boolean DEFAULT false, p_window_override_by uuid DEFAULT NULL::uuid, p_stripe_refund_id text DEFAULT NULL::text, p_stripe_refund_status text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
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
       and p_order_id is null
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
