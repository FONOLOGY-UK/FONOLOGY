-- 0058 — Pinned favourite products per staff account (Round 5 Phase 2 #3)
--
-- Per-account, not shared — each staff member pins their own products to
-- the top of their own checkout grid. A join table, not a column on
-- `products` or `staff`: a favourite is a fact about the (staff, product)
-- pair, and a member of staff can favourite many products just as a
-- product can be favourited by many staff.
create table public.staff_favourite_products (
  staff_id    uuid not null references public.staff (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (staff_id, product_id)
);

create index staff_favourite_products_staff_idx
  on public.staff_favourite_products (staff_id);

-- Same posture as every other table since 0011: force RLS, no policies.
-- The service-role client (apps/api) is the only thing that ever touches
-- this table.
alter table public.staff_favourite_products force row level security;
alter table public.staff_favourite_products enable row level security;

comment on table public.staff_favourite_products is
  'Per-staff pinned products for the POS checkout grid. Personal, not shared — see POST/DELETE /pos/favourites/:productId, both scoped to the caller''s own staff_id server-side.';
