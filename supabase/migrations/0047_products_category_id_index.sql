-- 0047 — products.category_id was missing its own covering index
--
-- Every foreign key column in this schema carries an index on its own
-- (referencing) side — pgTAP's 001_structure.sql proves it schema-wide, not
-- by convention alone. 0045 added products.category_id (and its FK,
-- products_category_id_fkey_restrict) but never gave it one, unlike every
-- other FK column here (products_supplier_idx, categories_parent_idx, …).
-- Also a genuine query cost, not just a test gap: every customer-facing
-- product list, the storefront's category filter (products.routes.ts), and
-- low_stock_products' join to categories (0046) all filter or join on this
-- column now.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

create index products_category_id_idx on public.products (category_id);
