-- 0119 — Each staff member's default till tab (client changes, October 2026, #6).
--
-- The till opens on "All" for everyone. Now each person can pick a favourite folder (0080) the
-- till opens on for them, on any till, until they pick another. NULL = "All". Deleting the
-- folder puts them back on "All". Set only by the person themselves (POST /staff/me/till-folder).

alter table public.staff
  add column pos_default_folder_id uuid references public.product_folders (id) on delete set null;

comment on column public.staff.pos_default_folder_id is
  'The favourite folder the till opens on for this person (0119). NULL = All products.';
