-- 0044 — In-store-only products (FEATURE-06)
--
-- A product can now be hidden from the storefront while staying fully sellable
-- at the till. This is NOT the same thing as `is_active` (retired — hidden
-- everywhere, no longer sold anywhere) and NOT the same thing as `kind = 'vape'`
-- (still listed on the storefront, just excluded from cart/checkout logic —
-- see product.ts's own comment). in_store_only is a third, independent state:
-- absent from the customer-facing catalogue entirely, present everywhere staff
-- look (admin inventory, POS till, barcode scan).
--
-- Default false so every existing product's visibility is unchanged by this
-- migration — additive only.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

alter table public.products
  add column in_store_only boolean not null default false;

comment on column public.products.in_store_only is
  'True = sellable at the till (POS) but absent from the customer-facing storefront (GET /products, GET /products/:slug) entirely. Independent of is_active (retired — hidden everywhere) and kind=''vape'' (still listed, just excluded from cart logic). Admin- and POS-facing product reads (GET /admin/products, GET /admin/products/barcode/:code) never filter on this — staff must always be able to find and sell these.';
