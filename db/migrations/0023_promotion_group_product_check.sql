-- 0023 — Readable error when a promotion names a product that isn't there
-- ---------------------------------------------------------------------------
-- 0022's upsert_promotion_group() validates its tiers carefully but left
-- product ids to the foreign key, so naming a deleted or mistyped product
-- surfaced as:
--
--   insert or update on table "promotions" violates foreign key constraint
--   "promotions_product_id_fkey"
--
-- The transaction still rolled back correctly — nothing was half-applied —
-- but that string reaches the admin screen as the reason the promotion
-- wouldn't save. Checked up front instead, with the same wording as the rest
-- of the function's guards. The foreign key stays exactly where it is; this
-- is a better message in front of it, not a replacement for it.

create or replace function public.upsert_promotion_group(
  p_product_ids uuid[],
  p_tiers       jsonb,
  p_group_id    uuid        default null,
  p_label       text        default null,
  p_active      boolean     default true,
  p_starts_at   timestamptz default null,
  p_ends_at     timestamptz default null,
  p_created_by  uuid        default null
)
returns uuid
language plpgsql
as $$
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

  -- New in 0023: fail with something readable rather than an FK violation.
  select count(*) into v_missing
  from unnest(p_product_ids) as wanted(id)
  where not exists (select 1 from public.products p where p.id = wanted.id);
  if v_missing > 0 then
    raise exception 'This promotion names % product(s) that no longer exist.', v_missing;
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
  end loop;

  return v_group_id;
end;
$$;
