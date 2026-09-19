-- 0079 — Inventory tab totals: total stock and total inventory value
--
-- Client decisions, built to exactly:
--   - Cost basis, not retail — "inventory value" is stock on hand at cost.
--   - Excludes retired products (is_active = false), matching every other
--     count already on the Inventory tab (lowCount/outCount there filter the
--     same way — see inventory-view.tsx's own `isRetired`/`live`).
--   - Includes in_store_only stock — real owned stock regardless of
--     storefront visibility. Deliberately NOT filtered on here: every vape
--     product is in_store_only as of 0078, and it is very much still stock
--     the shop is holding.
--   - Whole catalogue, not the active filter — a stable "what the shop is
--     holding" figure, not a property of the current search.
--
-- WHY A SQL FUNCTION, NOT A CLIENT-SIDE REDUCE
-- product_variants carries its OWN stock_qty/cost_price once a product has
-- has_variants = true (0060) — the parent's own values are frozen and unused
-- at that point (0060's own comment on the column). The admin products list
-- (GET /admin/products, toAdminProduct in admin.routes.ts) never fetches
-- variant rows at all, so a client-side sum over what that page already has
-- would silently under-count every variant-enabled product. This has to be
-- computed where both tables are in reach: the database.
--
-- SHAPE
-- Same style as revenue_by_category() (0045) for the SQL, and same
-- active-filtering precedent as low_stock_products' variant union (0060,
-- `where p.is_active and not p.has_variants` / `where p.is_active and
-- v.is_active`) — a retired variant of a live product isn't counted as stock
-- on hand any more than a retired product is, for the same reason.

create or replace function public.inventory_summary()
returns table (total_stock integer, total_value_pence pence)
language sql
stable
as $$
  select
    coalesce(sum(units), 0)::integer as total_stock,
    coalesce(sum(units * unit_cost), 0)::integer as total_value_pence
  from (
    -- Non-variant products: their own stock_qty/cost_price. in_store_only is
    -- deliberately not filtered on — this is stock the shop holds regardless
    -- of storefront visibility (client decision; see file header).
    select p.stock_qty as units, p.cost_price as unit_cost
    from public.products p
    where p.is_active
      and not p.has_variants

    union all

    -- Variant-enabled products: each variant's own stock_qty/cost_price —
    -- the parent's are frozen and unused once has_variants is true (0060).
    select v.stock_qty, v.cost_price
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where p.is_active
      and v.is_active
  ) combined;
$$;

comment on function public.inventory_summary is
  'Total stock (units) and total inventory value (pence, at cost) across the whole catalogue — Inventory tab only (0079). Excludes retired products/variants (is_active), includes in_store_only stock. Sums products.stock_qty/cost_price for non-variant products, product_variants.stock_qty/cost_price for variant-enabled ones — see the file header for why this can''t be a client-side reduce over the admin products list.';
