-- 0092 — inventory_summary(): count the stock the shop actually holds
--
-- Fixes 0079, which is frozen: it is on main and has been applied, so the
-- mistake is corrected by a new migration rather than an edit to that file
-- (supabase/migrations/README.md's own rule).
--
-- WHAT WAS WRONG
-- 0079 filtered on is_active, dropping every retired product and every
-- variant of one. On the dev catalogue that was 68 of 71 products: the
-- Inventory tab showed 113 units / £1,219.00 against 1,370 units /
-- £12,808.04 actually on the shelf. An order of magnitude, which makes the
-- whole tile untrustworthy rather than merely imprecise.
--
-- WHY RETIRED STOCK COUNTS
-- "Retired" is a soft delete: the DELETE route sets is_active = false
-- because a product with sale history cannot be removed outright (see
-- inventory-view.tsx's own comment on isRetired). It means "we have stopped
-- listing this", NOT "these units are gone" — nothing about retiring a
-- product touches stock_qty.
--
-- So a VALUATION has to count them. The question this figure answers is
-- "what is the stock in my shop worth", not "what can I still sell". 0079
-- matched the low/out counts on the same tab, and that was the mistake:
-- those ask "what do I need to reorder", which genuinely is a question
-- about sellable lines only. Same screen, different question.
--
-- Because a retired line holding stock is either a real asset or a sign of
-- stale data, the retired portion is returned SEPARATELY as well, so the tab
-- can show what the headline is made of rather than asking anyone to take a
-- single number on trust.
--
-- ALSO FIXED HERE
-- The two branches are now exact complements — `not p.has_variants` against
-- `p.has_variants` — so every product is counted through exactly one of them
-- and no unit can be double counted, even if a parent were ever flipped back
-- to has_variants = false while variant rows still existed. 0079 joined
-- variants without that guard.
--
-- The return type gains two columns, so the function must be dropped and
-- recreated rather than replaced in place.

drop function if exists public.inventory_summary();

create or replace function public.inventory_summary()
returns table (
  total_stock          integer,
  total_value_pence    pence,
  retired_stock        integer,
  retired_value_pence  pence
)
language sql
stable
as $$
  select
    coalesce(sum(units), 0)::integer                                as total_stock,
    coalesce(sum(units * unit_cost), 0)::integer                    as total_value_pence,
    coalesce(sum(units) filter (where retired), 0)::integer         as retired_stock,
    coalesce(sum(units * unit_cost) filter (where retired), 0)::integer
                                                                    as retired_value_pence
  from (
    -- Non-variant products: their own stock_qty/cost_price. Neither
    -- is_active nor in_store_only is filtered on — this is stock the shop
    -- holds regardless of whether it is still listed or ever appeared on
    -- the storefront (see the file header).
    select p.stock_qty as units, p.cost_price as unit_cost, not p.is_active as retired
    from public.products p
    where not p.has_variants

    union all

    -- Variant-enabled products: each variant's own stock_qty/cost_price —
    -- the parent's are frozen and unused once has_variants is true (0060).
    -- A variant counts as retired if it is retired itself OR its parent is;
    -- either way the units are still on the shelf and still counted.
    select v.stock_qty, v.cost_price, not (p.is_active and v.is_active)
    from public.product_variants v
    join public.products p on p.id = v.product_id
    where p.has_variants
  ) combined;
$$;

comment on function public.inventory_summary is
  'Total stock (units) and total inventory value (pence, at cost) across the whole catalogue, plus how much of each sits on retired lines — Inventory tab only (0079, corrected in 0092). Counts every unit on hand: retired products and variants are INCLUDED (retiring is a soft delete that never touches stock_qty, and a valuation asks what the shop holds, not what it can still sell), as is in_store_only stock. Sums products.stock_qty/cost_price for non-variant products, product_variants.stock_qty/cost_price for variant-enabled ones — see 0092''s header for why this rule deliberately differs from the low/out counts on the same tab.';
