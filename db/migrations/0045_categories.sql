-- 0045 — Product categories become a real, admin-editable table (FEATURE-05)
--
-- THE PROBLEM
-- `product_category` was a fixed 7-value Postgres enum: cases, power, audio,
-- protection, mounts, vape, plates. Client wants admins to create, rename,
-- and delete categories (and subcategories) from the product management UI —
-- and an enum fundamentally cannot do that. It can only gain a value through
-- its own migration (see 0012 — a new value can't even be REFERENCED in the
-- same transaction that adds it), and it can never lose or rename one without
-- recreating the type. This migration replaces it with a real table.
--
-- WHY products.category (the enum) IS NOT DROPPED
-- Every migration in this project stays additive. Dropping the column would
-- lose nothing today — the backfill below copies every value across first —
-- but it would foreclose ever needing the historical enum reading again, for
-- a change this large, on a whim. Instead:
--   - products.category stays exactly as it is today, frozen — see the
--     column comment at the end of this file. Nothing reads or writes it
--     after this migration; it is not the source of truth for anything.
--   - products.category_id is added as the new, real source of truth,
--     backfilled from category, and is what every function/view/route uses
--     from here on.
--   - products.category's NOT NULL is relaxed (not dropped, not renamed) so
--     that going forward, a product created against a genuinely NEW
--     admin-created category — one with no enum equivalent, which is the
--     entire point of this feature — doesn't need a fabricated enum value it
--     has no honest one for. Loosening a constraint touches zero existing
--     rows; every one of today's 75 products keeps its real value untouched.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

-- ---------------------------------------------------------------------------
-- 1. The categories table
-- ---------------------------------------------------------------------------
-- parent_id makes subcategories possible (one level is all that's asked for,
-- but nothing here stops a deeper tree — the UI is what should decide to
-- keep it flat, not the schema). ON DELETE RESTRICT on parent_id: a category
-- with children under it can't be deleted out from under them, matching this
-- schema's standing rule that RESTRICT protects real dependents (see
-- stock_movements, 0004). products.category_id below gets the same
-- protection for the same reason — a category with real products assigned
-- can't silently vanish either.

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  slug        text not null unique,
  parent_id   uuid references public.categories (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index categories_parent_idx on public.categories (parent_id);

create trigger categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- Same posture as products/suppliers (0011): force RLS, no policies. Only a
-- role with BYPASSRLS — the API's service-role connection — can touch this
-- table at all. Nothing here is customer- or even generally staff-facing
-- (category management is inventory.manage, gated at the API layer).
alter table public.categories enable row level security;
alter table public.categories force row level security;

comment on table public.categories is
  'Product categories and subcategories, admin-editable (FEATURE-05). Replaces the fixed product_category enum, which could not represent a category an admin creates at runtime. parent_id makes one level of subcategory possible; NULL parent_id is a top-level category.';

-- ---------------------------------------------------------------------------
-- 2. Seed the 7 existing categories, matching the enum's own values exactly
-- ---------------------------------------------------------------------------
-- slug is deliberately identical to the enum's text value — the backfill
-- below joins on it, so this list has to stay a faithful copy of
-- product_category's 7 values or the backfill silently misses rows. Labels
-- match CATEGORY_LABELS / CATEGORY_OPTIONS / CATEGORIES, already identical
-- across products.routes.ts, admin's product-dialog.tsx and reports.routes.ts
-- before this migration — one real source now instead of three copies.

insert into public.categories (label, slug) values
  ('Cases', 'cases'),
  ('Power', 'power'),
  ('Audio', 'audio'),
  ('Protection', 'protection'),
  ('Mounts', 'mounts'),
  ('Vaping', 'vape'),
  ('Number Plates', 'plates');

-- ---------------------------------------------------------------------------
-- 3. products.category_id — added, backfilled, then verified before NOT NULL
-- ---------------------------------------------------------------------------

alter table public.products
  add column category_id uuid references public.categories (id);

update public.products p
set category_id = c.id
from public.categories c
where c.slug = p.category::text;

-- Hard stop, not a hope: every one of today's products has to have
-- backfilled correctly before this migration is allowed to proceed to the
-- NOT NULL constraint below. If even one row failed to match (a category
-- value here that isn't one of the 7 seeded above), this raises and the
-- whole migration rolls back rather than silently leaving that product
-- uncategorised.
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing from public.products where category_id is null;
  if v_missing > 0 then
    raise exception '% product(s) did not backfill a category_id — aborting before NOT NULL is applied', v_missing;
  end if;
end $$;

alter table public.products
  alter column category_id set not null;

-- Same protection stock_movements gives products, and categories.parent_id
-- gives itself above: a category with real products under it can't
-- disappear. A category delete only ever succeeds once nothing references
-- it — reassign the products (or the subcategories) first.
alter table public.products
  add constraint products_category_id_fkey_restrict
  foreign key (category_id) references public.categories (id) on delete restrict;

-- Loosens the constraint only — every existing row's real value is
-- untouched. See the file header for why this has to happen: a product
-- filed under a brand-new admin-created category has no honest enum value
-- to put here, and inventing one would be worse than leaving it null.
alter table public.products
  alter column category set default null,
  alter column category drop not null;

comment on column public.products.category is
  'FROZEN as of migration 0045 — a historical snapshot of this product''s category at the moment categories became a real table. Not read or written by any code after this migration; category_id is the only source of truth for a product''s category going forward. Kept (not dropped) because this project''s migrations are additive-only, not because anything still depends on it.';

comment on column public.products.category_id is
  'The product''s category — references categories.id. The only source of truth for category, as of 0045 (see products.category''s own comment for what that column used to be and why it is frozen, not dropped).';

-- ---------------------------------------------------------------------------
-- 4. restock_trade_in() — takes a real category_id now, not an enum value
-- ---------------------------------------------------------------------------
-- A restocked device is a genuinely new product row (0007); it should be
-- filable under any category that exists today, including one an admin only
-- just created — which an enum parameter could never accept. category is
-- deliberately left NULL on rows created through this path from here on,
-- same as any other new product — see the file header.
--
-- DROP first, not CREATE OR REPLACE: the parameter list is changing
-- (p_category product_category -> p_category_id uuid), which Postgres treats
-- as a different function, not a replacement — CREATE OR REPLACE would have
-- left both overloads defined side by side, ambiguous for every caller.

drop function if exists public.restock_trade_in(uuid, text, product_category, pence, product_kind, uuid);

create function public.restock_trade_in(
  p_payout_id     uuid,
  p_name          text,
  p_category_id   uuid,
  p_resale_price  pence,
  p_kind          product_kind default 'accessory',
  p_staff_id      uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_payout    public.trade_in_payouts;
  v_unit_cost pence;
  v_product_id uuid;
  v_slug      text;
begin
  select * into v_payout from public.trade_in_payouts where id = p_payout_id;
  if not found then
    raise exception 'Trade-in payout % not found', p_payout_id;
  end if;
  if v_payout.restocked then
    raise exception 'Payout % has already been restocked', p_payout_id;
  end if;

  v_unit_cost := -v_payout.amount;
  v_slug := public.slugify(p_name) || '-' || p_payout_id::text;

  insert into public.products (slug, name, kind, category_id, price, cost_price, stock_qty)
  values (v_slug, p_name, p_kind, p_category_id, p_resale_price, v_unit_cost, 0)
  returning id into v_product_id;

  perform public.stock_receive(
    v_product_id, 1, v_unit_cost, 'buy_in',
    'trade_in_payout', p_payout_id, p_staff_id
  );

  update public.trade_in_payouts
     set restocked = true, resale_price = p_resale_price, restocked_product_id = v_product_id
   where id = p_payout_id;

  return v_product_id;
end;
$$;

comment on function public.restock_trade_in is
  'Turns a trade-in payout into a real, sellable product (0007). p_category_id references categories.id — changed from an enum parameter in 0045 so a restocked device can be filed under any category, including one created after this function was first written.';

-- ---------------------------------------------------------------------------
-- 5. revenue_by_category() — returns the real category, joined, not an enum
-- ---------------------------------------------------------------------------
-- Previously returned the enum value itself and left the API
-- (reports.routes.ts's CATEGORY_LABELS) to turn it into a display label —
-- a second, hand-maintained copy of the same 7 labels already seeded into
-- categories.label above. Returning the label directly from here removes
-- that duplication; CATEGORY_LABELS is deleted in the same pass that reads
-- this migration.
--
-- DROP first, not CREATE OR REPLACE: the return row shape is changing
-- (category product_category -> category_id uuid, category_label text),
-- which Postgres refuses to do in place for a RETURNS TABLE function.

drop function if exists public.revenue_by_category(date, date);

create function public.revenue_by_category(p_from date, p_to date)
returns table (category_id uuid, category_label text, revenue pence, units integer)
language sql
stable
as $$
  select c.id, c.label, sum(combined.revenue)::integer as revenue, sum(combined.units)::integer as units
  from (
    select p.category_id, sl.line_total as revenue, sl.quantity as units, s.created_at as at
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    join public.products p on p.id = sl.product_id

    union all

    select p.category_id, ol.line_total, ol.quantity, o.paid_at as at
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.paid_at is not null
    join public.products p on p.id = ol.product_id
  ) combined
  join public.categories c on c.id = combined.category_id
  where public.shop_day(combined.at) between p_from and p_to
  group by c.id, c.label
  order by revenue desc;
$$;

comment on function public.revenue_by_category is
  'Revenue and units per category for a date range, for the Reports "What sells" breakdown. Returns category_id and its label directly (joined from categories) as of 0045 — previously returned the raw product_category enum value and left the caller to map it to a display label from its own hand-maintained copy of the same list.';
