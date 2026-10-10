-- 0100 — per-shop references and multi-shop promotions (stage 3, multi-shop, step 4).
--
-- 1. REFERENCES. Receipts, jobs, refunds and trade-in payouts made at a shop other than the hub
--    carry that shop's code in front — S2-FNL-10421, S2-JOB-1013, S2-REF-77, S2-BUY-9 — so
--    paper from two tills can never be mistaken for one another. The hub shop (Shop 1) keeps the
--    bare prefixes, and every number already issued is untouched. Counters stay shared (so
--    uniqueness is unconditional); the client has asked for the final numbering scheme to be
--    reviewed and unified before launch, and this is the placeholder until then. Online orders,
--    bookings and trade-in requests belong to the hub shop and keep their prefixes.
--
-- 2. PROMOTIONS in several shops. A promotion is still a set of rows, one per product copy; one
--    running in Shop 1 and Shop 2 now holds each shop's own copy of the product (found through
--    the master list). upsert_promotion_group() takes the set of shops it may cover.

create function public.shop_ref_prefix(p_shop_id uuid, p_base text) returns text
language sql stable
as $$
  select case when s.is_fulfilment_hub then p_base else s.code || '-' || p_base end
    from public.shops s
   where s.id = p_shop_id
$$;

comment on function public.shop_ref_prefix is
  'The reference prefix for a shop: the hub keeps the bare prefix, any other shop gets its code in front. Temporary numbering until the client settles one scheme.';

create or replace function public.sales_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('sale', new.id, public.shop_ref_prefix(new.shop_id, 'FNL'));
  return new;
end;
$$;

create or replace function public.trade_in_payouts_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('trade_in_payout', new.id, public.shop_ref_prefix(new.shop_id, 'BUY'));
  return new;
end;
$$;

create or replace function public.refunds_set_reference() returns trigger
language plpgsql
as $$
begin
  -- Only when the caller has not supplied one (a future backfill or import must not be renumbered).
  if new.reference is null then
    new.reference := public.issue_reference('refund', new.id, public.shop_ref_prefix(new.shop_id, 'REF'));
  end if;
  return new;
end;
$$;

create function public.issue_job_reference(p_job_id uuid, p_shop_id uuid) returns text
language plpgsql
as $$
declare
  v_reference text;
begin
  v_reference := public.shop_ref_prefix(p_shop_id, 'JOB') || '-' || nextval('public.job_reference_seq')::text;

  insert into public.reference_registry (reference, entity_type, entity_id)
  values (v_reference, 'job', p_job_id);

  return v_reference;
end;
$$;

create or replace function public.jobs_set_reference() returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_job_reference(new.id, new.shop_id);
  return new;
end;
$$;

drop function public.upsert_promotion_group(uuid[], jsonb, uuid, text, boolean, timestamptz, timestamptz, uuid, uuid);
create function public.upsert_promotion_group(
  p_product_ids uuid[], p_tiers jsonb, p_group_id uuid default null, p_label text default null,
  p_active boolean default true, p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_created_by uuid default null, p_shop_id uuid default null,
  p_shop_ids uuid[] default null)
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

  -- Which shops the products may belong to: one shop (p_shop_id), a chosen set
  -- (p_shop_ids — a promotion running in several shops covers each shop's own copies), or, with
  -- neither, exactly one shop (the older single-shop behaviour).
  if p_shop_id is not null then
    select count(*) into v_missing
    from public.products p
    where p.id = any (p_product_ids) and p.shop_id <> p_shop_id;
    if v_missing > 0 then
      raise exception 'This promotion names % product(s) from another shop.', v_missing;
    end if;
  elsif p_shop_ids is not null then
    select count(*) into v_missing
    from public.products p
    where p.id = any (p_product_ids) and p.shop_id <> all (p_shop_ids);
    if v_missing > 0 then
      raise exception 'This promotion names % product(s) from a shop it does not run in.', v_missing;
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
