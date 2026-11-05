-- 0125 — Categories at any depth, a Show on Website switch, and categories as the till's folders
-- (client changes v2, November 2026, section 4).
--
-- Until now categories were assumed to be one level deep, and the compliance triggers relied on it:
-- derive_product_kind (0064) and derive_in_store_only (0078) looked at a category and its parent
-- only. With Vape > Disposable > Brand, that would have filed a vape as an accessory and listed it
-- online. Both now walk every ancestor. Moving a category re-derives everything filed under it.

-- ---------------------------------------------------------------------------
-- 1. Walking the tree
-- ---------------------------------------------------------------------------

create function public.category_is_under(p_category_id uuid, p_slug text) returns boolean
language sql stable
as $$
  with recursive up as (
    select id, slug, parent_id, 1 as depth from public.categories where id = p_category_id
    union all
    select c.id, c.slug, c.parent_id, up.depth + 1
      from public.categories c
      join up on c.id = up.parent_id
     where up.depth < 100
  )
  select exists (select 1 from up where slug = p_slug)
$$;

comment on function public.category_is_under is
  'True when the category is p_slug or sits anywhere beneath it (0125).';

create or replace function public.derive_product_kind()
returns trigger
language plpgsql
as $$
begin
  if public.category_is_under(new.category_id, 'vape') then
    new.kind := 'vape';
  elsif public.category_is_under(new.category_id, 'plates') then
    new.kind := 'plate';
  else
    new.kind := 'accessory';
  end if;
  return new;
end;
$$;

create or replace function public.derive_in_store_only()
returns trigger
language plpgsql
as $$
begin
  if public.category_is_under(new.category_id, 'vape') then
    new.in_store_only := true;
  end if;
  return new;
end;
$$;

-- A category inside itself would send every walk round in a circle.
create function public.categories_no_cycle() returns trigger
language plpgsql
as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id or exists (
    with recursive up as (
      select id, parent_id, 1 as depth from public.categories where id = new.parent_id
      union all
      select c.id, c.parent_id, up.depth + 1
        from public.categories c
        join up on c.id = up.parent_id
       where up.depth < 100
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'A category can''t go inside itself or one of its own subcategories';
  end if;
  return new;
end;
$$;

create trigger categories_no_cycle
  before insert or update of parent_id on public.categories
  for each row execute function public.categories_no_cycle();

-- Moving a category moves its compliance: touching category_id fires both derive triggers.
create function public.categories_rederive_products() returns trigger
language plpgsql
as $$
begin
  if new.parent_id is distinct from old.parent_id then
    with recursive subtree as (
      select new.id as id
      union all
      select c.id from public.categories c join subtree s on c.parent_id = s.id
    )
    update public.products p
       set category_id = p.category_id
      from subtree s
     where p.category_id = s.id;
  end if;
  return null;
end;
$$;

create trigger categories_rederive_products
  after update of parent_id on public.categories
  for each row execute function public.categories_rederive_products();

-- ---------------------------------------------------------------------------
-- 2. Show on Website
-- ---------------------------------------------------------------------------

alter table public.categories
  add column show_on_website boolean not null default true;

comment on column public.categories.show_on_website is
  'Off hides this category, everything under it, and their products from the storefront (0125). They still sell at the till. Vape and everything under it are always hidden, whatever this says.';

-- Worked out from the category, never copied onto products: in_store_only is a separate choice per
-- product, and re-ticking a category must not un-hide a product someone hid on purpose.
create view public.categories_hidden_online as
with recursive hidden as (
  select id from public.categories where not show_on_website or slug = 'vape'
  union
  select c.id from public.categories c join hidden h on c.parent_id = h.id
)
select id from hidden;

-- online_copies is the one place the website's listing, prices and stock all read from.
create or replace view public.online_copies as
select p.id as product_id, p.master_product_id as master_id, p.shop_id, s.sort_order,
       p.price, p.cost_price, p.stock_qty, p.has_variants, p.created_at
  from public.products p
  join public.shops s on s.id = p.shop_id
 where p.master_product_id is not null
   and p.is_active and not p.in_store_only and s.is_active
   and not exists (select 1 from public.categories_hidden_online h where h.id = p.category_id);

-- ---------------------------------------------------------------------------
-- 3. Categories are the till's folders (replacing product_folders, which stay in the database
--    unused, so nothing is lost)
-- ---------------------------------------------------------------------------

alter table public.staff
  add column pos_default_category_id uuid references public.categories (id) on delete set null;

comment on column public.staff.pos_default_category_id is
  'The category the till opens on for this person (0125). NULL = All products.';

alter table public.staff_favourite_products
  add column category_id uuid references public.categories (id) on delete cascade;

comment on column public.staff_favourite_products.category_id is
  'The category this pin belongs to (0125). NULL with a NULL folder_id = the All products view.';

drop index public.staff_favourite_products_scope_idx;

create unique index staff_favourite_products_scope_idx
  on public.staff_favourite_products (
    staff_id, product_id,
    coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
