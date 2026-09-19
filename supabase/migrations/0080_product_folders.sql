-- 0080 — Product folders for the POS checkout grid
-- ---------------------------------------------------------------------------
-- RECOVERED FROM THE DATABASE, NOT WRITTEN HERE. READ THIS BEFORE TRUSTING IT.
--
-- This migration was applied to the hosted dev project (ohkvwqqtppvnxbvvdsfr)
-- on 12 September 2026 and was never committed to any branch. It was found
-- during the September change request, when numbering nine new migrations
-- against `main` collided with three numbers dev had already used. The SQL
-- below is the exact text recorded in dev's own
-- `supabase_migrations.schema_migrations.statements`, reformatted not at all.
--
-- It is committed here so the repository can rebuild dev's schema. Before
-- this file existed, `supabase db reset` produced a database missing these
-- two tables and this function, and nothing in the repo said so — the gap
-- was invisible until someone compared the two by hand.
--
-- WHAT IS STILL MISSING, AND IT IS NOT THE SCHEMA
--
-- The comments below refer to `GET /pos/folders` (pos.operate) and
-- `/admin/product-folders` (inventory.manage), and to "batch 3". None of that
-- application code exists in this repository. The tables and the function are
-- real and live on dev; the endpoints that were supposed to read and write
-- them are not here. So this file makes the SCHEMA reproducible and does not
-- make the FEATURE present. Whoever owns batch 3 still needs to land that
-- code, and until they do these two tables are simply unused.
--
-- Anything written below this line about how the feature behaves is batch 3's
-- own claim, carried across verbatim, not something verified here.

create table public.product_folders (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger product_folders_updated_at
  before update on public.product_folders
  for each row execute function public.set_updated_at();

alter table public.product_folders enable row level security;
alter table public.product_folders force row level security;

comment on table public.product_folders is
  'Admin-managed, shop-wide groupings of products for the POS checkout grid (batch 3) — e.g. "Mobile panels". Single level, no nesting. Deliberately independent of categories: see this migration''s own header for why. Read via GET /pos/folders (pos.operate); created/edited/deleted via /admin/product-folders (inventory.manage).';

create table public.product_folder_items (
  folder_id   uuid not null references public.product_folders (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (folder_id, product_id)
);

create index product_folder_items_product_idx
  on public.product_folder_items (product_id);

alter table public.product_folder_items enable row level security;
alter table public.product_folder_items force row level security;

comment on table public.product_folder_items is
  'Which products sit in which folder (batch 3) — many-to-many, same shape as staff_favourite_products: a product can be in more than one folder, a folder holds more than one product.';

create or replace function public.upsert_product_folder(
  p_label       text,
  p_product_ids uuid[]  default '{}',
  p_folder_id   uuid    default null,
  p_sort_order  integer default 0
)
returns uuid
language plpgsql
as $$
declare
  v_folder_id uuid;
  v_count     integer;
begin
  if p_label is null or btrim(p_label) = '' then
    raise exception 'Enter a folder name.';
  end if;

  if p_product_ids is not null and array_length(p_product_ids, 1) is not null then
    select count(distinct id) into v_count from unnest(p_product_ids) as id;
    if v_count <> array_length(p_product_ids, 1) then
      raise exception 'The same product is listed more than once in this folder.';
    end if;
  end if;

  if p_folder_id is null then
    insert into public.product_folders (label, sort_order)
    values (btrim(p_label), coalesce(p_sort_order, 0))
    returning id into v_folder_id;
  else
    update public.product_folders
       set label = btrim(p_label),
           sort_order = coalesce(p_sort_order, 0)
     where id = p_folder_id
     returning id into v_folder_id;
    if v_folder_id is null then
      raise exception 'Folder % not found', p_folder_id;
    end if;
    delete from public.product_folder_items where folder_id = v_folder_id;
  end if;

  if p_product_ids is not null and array_length(p_product_ids, 1) is not null then
    insert into public.product_folder_items (folder_id, product_id, sort_order)
    select v_folder_id, id, (row_number() over ()) - 1
    from unnest(p_product_ids) as id;
  end if;

  return v_folder_id;
end;
$$;

comment on function public.upsert_product_folder is
  'Creates or replaces a favourite folder and its whole product list in one transaction (batch 3) — p_folder_id null creates, set updates. Same shape as upsert_promotion_group (0022): the item list is a whole-set replace, not a diff, so a failure partway never leaves the folder pointing at half its old list and half its new one.';
