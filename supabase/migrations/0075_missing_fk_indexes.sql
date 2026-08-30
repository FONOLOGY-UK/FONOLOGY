-- 0075 — Two foreign key columns missing their covering index
-- ---------------------------------------------------------------------------
-- pgTAP finding (001_structure.sql test 6, first real run of the suite),
-- which queries the catalog directly for any FK column lacking a covering
-- index — not a maintained list, so a table added later without one is
-- exactly what it's designed to catch.
--
-- reviews.created_by (0053): a nullable FK, staff member who typed a
-- review in — null for every review that predates the table (Tanoli's
-- original transcription) or wasn't attributed. Partial index, `where
-- created_by is not null`, matching this schema's existing convention for
-- a nullable FK that's usually null (e.g. refunds_window_override_by_idx,
-- 0008) — indexing every null row would be pure overhead for a column that
-- is rarely populated.
--
-- staff_favourite_products.product_id (0058): the table's primary key is
-- the composite (staff_id, product_id), which only 0058 indexed the
-- leading column of on its own (staff_favourite_products_staff_idx) — the
-- composite PK's own index can't efficiently serve a lookup filtering by
-- product_id alone (it's not the leading column), so this genuinely had no
-- covering index for that direction. Not partial — product_id is never
-- null (not-null FK), so a plain index is the right shape, matching
-- product_variants_product_idx (0060) and every other required-FK index in
-- this schema.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only, per the standing
-- hard rule.

create index reviews_created_by_idx
  on public.reviews (created_by)
  where created_by is not null;

create index staff_favourite_products_product_idx
  on public.staff_favourite_products (product_id);
