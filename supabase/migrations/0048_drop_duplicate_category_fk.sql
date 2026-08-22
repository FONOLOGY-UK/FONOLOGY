-- 0048 — products.category_id had two foreign keys to categories, not one
--
-- THE BUG (found live, not by inspection — the storefront's product list
-- returned 500s the moment it actually tried to embed categories)
-- 0045's `alter table products add column category_id uuid references
-- public.categories (id)` implicitly created its own unnamed FK
-- (products_category_id_fkey). The same migration then separately added
-- `products_category_id_fkey_restrict` — the ON DELETE RESTRICT constraint
-- that was actually intended — without ever dropping the first one. Both
-- reference products(category_id) -> categories(id); nothing enforced them
-- differently in practice (RESTRICT is Postgres's own default for a FK with
-- no ON DELETE clause), so this went unnoticed until PostgREST tried to
-- embed categories into a products query and refused, with two equally
-- valid relationships to choose between (PGRST201).
--
-- THE FIX
-- Drop the redundant, unnamed one. products_category_id_fkey_restrict stays
-- — it is the one whose name actually documents its own ON DELETE behaviour.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

alter table public.products
  drop constraint products_category_id_fkey;
