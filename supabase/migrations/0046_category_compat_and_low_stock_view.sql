-- 0046 — FEATURE-05 follow-up: legacy-insert compatibility + low_stock_products
--
-- THE PROBLEM (two separate consequences of 0045 making category_id NOT NULL)
--
-- 1. Every pgTAP fixture in supabase/tests/ (17 files, ~25 INSERT statements)
--    still writes `category` (the frozen enum literal, e.g. 'cases') and never
--    `category_id` — they predate this feature. 0045 made category_id NOT
--    NULL with no default, so every one of those inserts would now fail
--    outright. Rewriting 25 positional INSERT statements by hand across 17
--    files (plus a raw-SQL Node script, concurrency_stock_race.js, which
--    cannot use a Postgres-side default at all) is exactly the kind of
--    mechanical, error-prone edit likely to silently corrupt an unrelated
--    column in some other row. A BEFORE INSERT trigger fixes every caller,
--    present and future, in one place instead.
--
-- 2. low_stock_products (0043) selects `category` directly from products —
--    which is correct for the 75 products backfilled by 0045, but wrong for
--    any product created AFTER 0045: category is deliberately left NULL on
--    those (see 0045's header), so the low-stock widget would start showing
--    a blank category for every new product from here on.
--
-- THE FIX
--
-- 1. products_fill_category_id_from_legacy_category(): if a caller inserts a
--    row with category_id left NULL but category set (the old calling
--    convention), resolve category_id from it via categories.slug before the
--    row lands — the exact same slug-match the 0045 backfill itself used.
--    This is a compatibility shim for callers still using the RETIRED
--    calling convention, not a second source of truth: any caller that sets
--    category_id directly (every real route, as of the FEATURE-05 file pass)
--    is untouched by this trigger, and a category value with no matching
--    slug still fails exactly as it should — category_id's own NOT NULL
--    constraint catches it, honestly, rather than silently inventing one.
--
-- 2. low_stock_products: joins to categories via category_id instead of
--    reading the frozen category column, so it keeps working for every
--    product regardless of when it was created. Same column name and shape
--    (`category`) — every existing caller (admin.routes.ts's
--    GET /admin/products/low-stock) needs no change.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

-- ---------------------------------------------------------------------------
-- 1. Legacy-insert compatibility trigger
-- ---------------------------------------------------------------------------

create function public.fill_category_id_from_legacy_category()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is null and new.category is not null then
    select id into new.category_id from public.categories where slug = new.category::text;
  end if;
  return new;
end;
$$;

comment on function public.fill_category_id_from_legacy_category is
  'Compatibility shim (0046) for callers still using the pre-0045 calling convention (setting category, not category_id). Every real route sets category_id directly and is unaffected. A category value with no matching categories.slug leaves category_id NULL, which the NOT NULL constraint then rejects honestly.';

create trigger products_fill_category_id
  before insert on public.products
  for each row
  execute function public.fill_category_id_from_legacy_category();

-- ---------------------------------------------------------------------------
-- 2. low_stock_products — reads category_id, not the frozen category column
-- ---------------------------------------------------------------------------
-- DROP first, not CREATE OR REPLACE: the column type is changing
-- (category product_category -> category text), which Postgres refuses to
-- do in place for a view.

drop view if exists public.low_stock_products;

create view public.low_stock_products as
select p.id, p.name, c.slug as category, p.stock_qty, p.low_stock_threshold
from public.products p
join public.categories c on c.id = p.category_id
where p.is_active
  and p.low_stock_alert
  and p.stock_qty > 0
  and p.stock_qty <= p.low_stock_threshold;

comment on view public.low_stock_products is
  'Products at/below their own low_stock_threshold, alert on, still active, and still in stock (stock_qty > 0 — zero stock is "out of stock", a separate state, never counted as "low"). Matches productIsLowStock()/isLowStock() in apps/web/src/lib/data/types/inventory.ts exactly. category is resolved from category_id (0046) so it stays correct for products created after 0045, whose frozen category column is NULL.';
