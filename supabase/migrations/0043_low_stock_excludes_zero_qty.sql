-- 0043 — low_stock_products must agree with the client's own definition of "low"
--
-- THE PROBLEM
-- productIsLowStock() / isLowStock() (apps/web/src/lib/data/types/inventory.ts)
-- is documented as "the one to use everywhere now": a product is only "low"
-- when it still has stock (stockQty > 0) AND sits at/below its threshold.
-- Zero stock is a separate state — "out of stock entirely" — not "low stock".
--
-- low_stock_products (0010_views.sql) never had that stockQty > 0 guard. Its
-- WHERE clause was `is_active and low_stock_alert and stock_qty <= threshold`,
-- which a zero-stock product with its alert on satisfies too. Harmless while
-- nothing read this view — it's about to gain its first real caller (the
-- Overview dashboard's low-stock widget, previously computing this client-side
-- and separately, incorrectly, never excluding retired products either — see
-- the BUG-04 investigation). Wiring the widget to this view as-is would have
-- made a zero-stock, alert-on product count in BOTH "X low on stock" and
-- "X out of stock entirely" at once — a new, confusing overlap that didn't
-- exist before, and not what was asked for.
--
-- THE FIX
-- Add stock_qty > 0, matching isLowStock() exactly. is_active and low_stock_alert
-- stay as they were — those were already correct.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

create or replace view public.low_stock_products as
select id, name, category, stock_qty, low_stock_threshold
from public.products
where is_active
  and low_stock_alert
  and stock_qty > 0
  and stock_qty <= low_stock_threshold;

comment on view public.low_stock_products is
  'Products at/below their own low_stock_threshold, alert on, still active, and still in stock (stock_qty > 0 — zero stock is "out of stock", a separate state, never counted as "low"). Matches productIsLowStock()/isLowStock() in apps/web/src/lib/data/types/inventory.ts exactly, which is the canonical definition used everywhere else. Read by GET /admin/products/low-stock, which the Overview dashboard widget calls (0043) instead of recomputing this client-side, which is how the widget used to leak retired products into the count.';
