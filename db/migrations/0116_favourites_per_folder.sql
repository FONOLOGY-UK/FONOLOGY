-- 0116 — A pinned (starred) product belongs to the folder it was starred in (VPS testing report,
-- FON-006). It used to be one flag per (staff, product), so starring a product inside a folder also
-- starred it in "All products" and in every other folder.
--
-- folder_id NULL means the "All products" view. Existing pins were made before folders could be told
-- apart; they stay as "All products" pins and do not appear starred inside any folder.
alter table public.staff_favourite_products
  add column folder_id uuid references public.product_folders (id) on delete cascade;

alter table public.staff_favourite_products
  drop constraint if exists staff_favourite_products_pkey;

-- One pin per staff member, product and place. NULL folders compare equal through the coalesce.
create unique index staff_favourite_products_scope_idx
  on public.staff_favourite_products (
    staff_id, product_id, coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on column public.staff_favourite_products.folder_id is
  'The favourite folder this pin belongs to; NULL = the All products view. A pin never leaks between places.';
