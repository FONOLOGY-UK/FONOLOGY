-- 0126 — Promotions by total price, on whole categories, with Mix & Match (client changes v2,
-- November 2026, sections 2.3–2.5 and 3). Still till-only: nothing online reads these.
--
-- A tier now records what staff typed: the TOTAL for its quantity (2 for £10). The per-item rate is
-- that total ÷ the quantity and applies from that quantity up until a bigger tier takes over, so
-- with 2 for £10 and 4 for £16, 3 cost £15 and 5 cost £20. unit_price stays as the rounded rate for
-- older readers; the exact figure comes from total_price (see lib/promoPricing.ts).
--
-- mix_match on: everything the offer covers counts towards the quantity together (any variations,
-- any products in it, anything in its categories). Off: each item counts on its own, as before.
--
-- A promotions row now covers one product OR one category. A category row applies to whatever is in
-- that category or under it, including products added later, in the shops named in promotion_shops.

alter table public.promo_tiers add column total_price pence;

update public.promo_tiers set total_price = unit_price * min_qty;

comment on column public.promo_tiers.total_price is
  'What min_qty of these cost together, as entered (0126). NULL only on a row written by an older API: read as unit_price x min_qty.';

alter table public.promotions
  add column mix_match boolean not null default false,
  add column category_id uuid references public.categories (id) on delete cascade,
  alter column product_id drop not null;

alter table public.promotions
  add constraint promotions_product_or_category check (num_nonnulls(product_id, category_id) = 1),
  add constraint promotions_group_category_unique unique (group_id, category_id);

create index promotions_category_idx on public.promotions (category_id) where category_id is not null;

create function public.save_promotion_offer(
  p_product_ids  uuid[],
  p_category_ids uuid[],
  p_tiers        jsonb,
  p_shop_ids     uuid[],
  p_group_id     uuid        default null,
  p_label        text        default null,
  p_active       boolean     default true,
  p_mix_match    boolean     default false,
  p_starts_at    timestamptz default null,
  p_ends_at      timestamptz default null,
  p_created_by   uuid        default null
)
returns uuid
language plpgsql
as $$
declare
  v_group_id  uuid := coalesce(p_group_id, gen_random_uuid());
  v_products  uuid[] := coalesce(p_product_ids, '{}');
  v_cats      uuid[] := coalesce(p_category_ids, '{}');
  v_id        uuid;
  v_promo_id  uuid;
  v_tier      jsonb;
  v_min_qty   integer;
  v_total     integer;
  v_count     integer;
begin
  if cardinality(v_products) = 0 and cardinality(v_cats) = 0 then
    raise exception 'A promotion needs at least one product or category.';
  end if;
  if cardinality(coalesce(p_shop_ids, '{}')) = 0 then
    raise exception 'A promotion needs at least one shop.';
  end if;

  select count(distinct id) into v_count from unnest(v_products) as id;
  if v_count <> cardinality(v_products) then
    raise exception 'The same product is listed more than once in this promotion.';
  end if;
  select count(distinct id) into v_count from unnest(v_cats) as id;
  if v_count <> cardinality(v_cats) then
    raise exception 'The same category is listed more than once in this promotion.';
  end if;

  select count(*) into v_count
    from unnest(v_products) as wanted(id)
   where not exists (select 1 from public.products p where p.id = wanted.id);
  if v_count > 0 then
    raise exception 'This promotion names % product(s) that no longer exist.', v_count;
  end if;
  select count(*) into v_count
    from unnest(v_cats) as wanted(id)
   where not exists (select 1 from public.categories c where c.id = wanted.id);
  if v_count > 0 then
    raise exception 'This promotion names % categories that no longer exist.', v_count;
  end if;
  select count(*) into v_count
    from public.products p
   where p.id = any (v_products) and p.shop_id <> all (p_shop_ids);
  if v_count > 0 then
    raise exception 'This promotion names % product(s) from a shop it does not run in.', v_count;
  end if;

  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    raise exception 'A promotion needs at least one tier.';
  end if;
  for v_tier in select * from jsonb_array_elements(p_tiers) loop
    if v_tier->>'minQty' is null or v_tier->>'totalPrice' is null then
      raise exception 'Each tier needs a quantity and a total price.';
    end if;
    v_min_qty := (v_tier->>'minQty')::integer;
    v_total := (v_tier->>'totalPrice')::integer;
    if v_min_qty < 2 then
      raise exception 'Promotions start at 2 or more (got %).', v_min_qty;
    end if;
    if v_total < 0 then
      raise exception 'A tier price cannot be negative (got %).', v_total;
    end if;
  end loop;
  select count(distinct (t->>'minQty')::integer) into v_count
    from jsonb_array_elements(p_tiers) as t;
  if v_count <> jsonb_array_length(p_tiers) then
    raise exception 'Two tiers share the same quantity; which price applies would be arbitrary.';
  end if;

  delete from public.promotions
   where group_id = v_group_id
     and (
       (product_id is not null and product_id <> all (v_products))
       or (category_id is not null and category_id <> all (v_cats))
     );

  foreach v_id in array v_products loop
    insert into public.promotions
      (group_id, product_id, label, is_active, mix_match, starts_at, ends_at, created_by)
    values (v_group_id, v_id, p_label, p_active, p_mix_match, p_starts_at, p_ends_at, p_created_by)
    on conflict (group_id, product_id) do update
      set label = excluded.label, is_active = excluded.is_active, mix_match = excluded.mix_match,
          starts_at = excluded.starts_at, ends_at = excluded.ends_at
    returning id into v_promo_id;

    delete from public.promo_tiers where promotion_id = v_promo_id;
    insert into public.promo_tiers (promotion_id, min_qty, unit_price, total_price)
    select v_promo_id, (t->>'minQty')::integer,
           round((t->>'totalPrice')::numeric / (t->>'minQty')::integer)::integer,
           (t->>'totalPrice')::integer
      from jsonb_array_elements(p_tiers) as t;

    delete from public.promotion_shops where promotion_id = v_promo_id;
    insert into public.promotion_shops (promotion_id, shop_id)
    select v_promo_id, shop_id from public.products where id = v_id;
  end loop;

  foreach v_id in array v_cats loop
    insert into public.promotions
      (group_id, category_id, label, is_active, mix_match, starts_at, ends_at, created_by)
    values (v_group_id, v_id, p_label, p_active, p_mix_match, p_starts_at, p_ends_at, p_created_by)
    on conflict (group_id, category_id) do update
      set label = excluded.label, is_active = excluded.is_active, mix_match = excluded.mix_match,
          starts_at = excluded.starts_at, ends_at = excluded.ends_at
    returning id into v_promo_id;

    delete from public.promo_tiers where promotion_id = v_promo_id;
    insert into public.promo_tiers (promotion_id, min_qty, unit_price, total_price)
    select v_promo_id, (t->>'minQty')::integer,
           round((t->>'totalPrice')::numeric / (t->>'minQty')::integer)::integer,
           (t->>'totalPrice')::integer
      from jsonb_array_elements(p_tiers) as t;

    delete from public.promotion_shops where promotion_id = v_promo_id;
    insert into public.promotion_shops (promotion_id, shop_id)
    select v_promo_id, unnest(p_shop_ids);
  end loop;

  return v_group_id;
end;
$$;

comment on function public.save_promotion_offer is
  'Creates or replaces one whole offer (its products, categories, tiers and shops) in one transaction (0126). Replaces upsert_promotion_group, which stays only so an API from before 0126 still runs.';
