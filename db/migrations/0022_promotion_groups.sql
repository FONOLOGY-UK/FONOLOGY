-- 0022 — One promotion across many products, applied atomically
-- ---------------------------------------------------------------------------
-- `promotions` is one row per product. The admin screen models one promotion
-- covering several products, so creating or editing one touches several rows
-- at once — and `POST /admin/promotions` did that as a loop of independent
-- inserts. A failure on the third product left the first two live: a
-- half-applied promotion charging bulk prices on some products and shelf
-- prices on others, on real sales, with nothing to indicate it.
--
-- Two things are needed to fix that properly:
--
--   1. A way to say which rows are the same promotion. There wasn't one:
--      `label` is nullable and non-unique, so "all the rows with this label"
--      can't identify a promotion, and an unlabelled one can't be identified
--      at all. `group_id` makes it explicit. Every existing row backfills to
--      its own fresh group, which is exactly what it already is — a
--      single-product promotion.
--
--   2. One function that does the whole edit. A function body is a single
--      transaction, so either every product's rows end up right or none of
--      them change. A loop of calls from the API is not a transaction, no
--      matter how the calls are ordered.
--
-- Bulk tiers stay per-product (the client-confirmed rule): a tier lives on one
-- promotions row, so "2 or more" always means two of the SAME product. Nothing
-- here creates a mixed-basket rule.

alter table public.promotions
  add column group_id uuid not null default gen_random_uuid();

comment on column public.promotions.group_id is
  'Which promotion this row belongs to. Rows sharing a group_id are one '
  'promotion covering several products. Defaults to its own new group, so a '
  'row created directly is a single-product promotion.';

-- A product can only appear once in a given promotion; without this the
-- upsert below has no key to conflict on and a repeated product id would
-- quietly create duplicate rows with duplicate tiers.
alter table public.promotions
  add constraint promotions_group_product_unique unique (group_id, product_id);

create index promotions_group_idx on public.promotions (group_id);

-- ---------------------------------------------------------------------------
-- upsert_promotion_group
-- ---------------------------------------------------------------------------
-- Creates or replaces every row for one promotion, in one transaction.
--
-- p_group_id null  -> a new promotion; the new group id is returned.
-- p_group_id given -> that promotion is edited in place: products no longer
--                     listed are removed from it, new ones added, and every
--                     surviving row's tiers replaced with p_tiers.
--
-- p_tiers is the frontend's own shape, camelCase as it sends it:
--   [{"minQty": 2, "unitPrice": 1200}, ...]
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
begin
  if p_product_ids is null or array_length(p_product_ids, 1) is null then
    raise exception 'A promotion needs at least one product.';
  end if;

  -- A repeated product id would otherwise hit the unique constraint halfway
  -- through and roll the whole edit back with a constraint error rather than
  -- something a person can read.
  select count(distinct id) into v_count from unnest(p_product_ids) as id;
  if v_count <> array_length(p_product_ids, 1) then
    raise exception 'The same product is listed more than once in this promotion.';
  end if;

  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) = 0 then
    raise exception 'A promotion needs at least one bulk tier.';
  end if;

  -- Validate every tier before writing anything, so a bad tier on the last
  -- product doesn't depend on statement ordering to be caught.
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

  -- Editing: drop the products that are no longer part of this promotion.
  -- promo_tiers cascades from promotions, so their tiers go with them.
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

    -- Tiers are replaced wholesale rather than merged: the edit screen sends
    -- the complete tier set it wants, and a merge would silently keep a tier
    -- the user had just removed.
    delete from public.promo_tiers where promotion_id = v_promo_id;

    insert into public.promo_tiers (promotion_id, min_qty, unit_price)
    select v_promo_id, (t->>'minQty')::integer, (t->>'unitPrice')::integer
    from jsonb_array_elements(p_tiers) as t;
  end loop;

  return v_group_id;
end;
$$;

comment on function public.upsert_promotion_group is
  'Creates or replaces every promotions/promo_tiers row for one promotion in a '
  'single transaction. Partial application is impossible: any failure rolls the '
  'whole promotion back.';
