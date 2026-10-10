-- 0064 — Client decision #14: hardcoded mandatory categories, replacing
-- the standalone "Kind" field
--
-- THE DECISION
-- Vape, Number Plates and Mobiles become permanent, undeletable, unrenamable
-- top-level categories. Admins can still add other top-level categories
-- freely, and add/delete subcategories under ANY category — including these
-- three. Two of the three already existed as ordinary categories since 0045
-- ('vape' / label "Vaping", and 'plates' / label "Number Plates") — this
-- migration marks those two protected (and corrects "Vaping" to "Vape", the
-- exact name asked for) and adds the third ("Mobiles") fresh.
--
-- WHAT ACTUALLY DRIVES COMPLIANCE — THE IMPORTANT ENGINEERING CALL
-- products.kind (the accessory/vape/plate enum) is NOT dropped. Everywhere
-- that already keys off it correctly — product_is_purchasable_online(),
-- order_lines_reject_vape(), the frontend's isPurchasable()/
-- requiresVerification(), the homepage "kit" section filter, the checkout
-- document-upload gate — is proven, tested code and stays completely
-- untouched. What changes is WHERE kind's value comes from: a new trigger
-- (derive_product_kind, below) computes it automatically from category_id
-- every time a product is created or re-categorised, and admins never set
-- it by hand again — "Kind" is removed from the product form because it is
-- no longer an independent decision, category IS the decision. This is a
-- deliberately narrow, low-risk way to satisfy "compliance behaviour must
-- move onto categories and keep working end to end": the mechanism that
-- already works is reused byte-for-byte; only its INPUT changes.
--
-- MIGRATING EXISTING PRODUCTS
-- Every product currently kind='vape' moves to the Vape category; every
-- kind='plate' product moves to the Number Plates category. kind='accessory'
-- products are untouched — they keep whatever real category they already
-- had (cases, power, audio, ...), which was never in question. The trigger
-- installed below then recomputes kind from the category on the way through,
-- so the end state is: category is now the source of truth, and kind is
-- left exactly where it needs to be for every existing compliance check to
-- keep reading it correctly.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

-- ---------------------------------------------------------------------------
-- 1. is_protected
-- ---------------------------------------------------------------------------

alter table public.categories
  add column is_protected boolean not null default false;

comment on column public.categories.is_protected is
  'True for exactly the three mandatory categories (Vape, Number Plates, Mobiles) — see 0064. Protected rows can never be deleted, renamed, re-slugged, or re-parented (categories_protect_mandatory trigger); subcategories under them can still be freely added and removed.';

-- ---------------------------------------------------------------------------
-- 2. The three mandatory categories — idempotent, works whether 'vape' and
--    'plates' already exist (they have, since 0045) or dev data has since
--    been wiped and they don't.
-- ---------------------------------------------------------------------------

insert into public.categories (label, slug, parent_id, is_protected)
values
  ('Vape', 'vape', null, true),
  ('Number Plates', 'plates', null, true),
  ('Mobiles', 'mobiles', null, true)
on conflict (slug) do update
  set label = excluded.label,
      parent_id = null,
      is_protected = true;

-- ---------------------------------------------------------------------------
-- 3. Protection trigger — delete, rename, re-slug, or re-parent all refused
-- ---------------------------------------------------------------------------
-- Subcategories underneath a protected category are NOT protected
-- themselves (only these three specific rows are) — an admin can still add
-- and delete a "Disposables" subcategory under Vape freely; this trigger
-- only ever fires for the mandatory row itself.

create or replace function public.categories_protect_mandatory()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_protected then
      raise exception 'The "%" category is permanent and cannot be deleted', old.label;
    end if;
    return old;
  end if;

  -- UPDATE
  if old.is_protected then
    if new.label <> old.label then
      raise exception 'The "%" category is permanent and cannot be renamed', old.label;
    end if;
    if new.slug <> old.slug then
      raise exception 'The "%" category''s slug cannot be changed', old.label;
    end if;
    if new.parent_id is not null then
      raise exception 'The "%" category must stay a top-level category', old.label;
    end if;
    -- is_protected itself can never be unset once true — closes the one
    -- obvious bypass (rename by first flipping the flag off).
    if not new.is_protected then
      raise exception 'The "%" category''s protection cannot be removed', old.label;
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_protect_mandatory
  before update or delete on public.categories
  for each row execute function public.categories_protect_mandatory();

comment on trigger categories_protect_mandatory on public.categories is
  'Blocks delete/rename/re-slug/re-parent/unprotect on the three mandatory categories (0064). Subcategories underneath them are unaffected — only rows with is_protected=true are ever refused.';

-- ---------------------------------------------------------------------------
-- 4. Derive products.kind from category — the actual compliance wiring
-- ---------------------------------------------------------------------------
-- Fires on INSERT always, and on UPDATE only when category_id actually
-- changes — a plain re-price or rename doesn't need to re-derive anything.
-- Walks up ONE level (category's own id, or its parent's id) because
-- categories are only ever one level deep (0045's own comment) — a product
-- filed under a subcategory of Vape is still a vape for compliance purposes.

create or replace function public.derive_product_kind()
returns trigger
language plpgsql
as $$
declare
  v_slug        text;
  v_parent_slug text;
begin
  select c.slug, p.slug
    into v_slug, v_parent_slug
    from public.categories c
    left join public.categories p on p.id = c.parent_id
   where c.id = new.category_id;

  if v_slug = 'vape' or v_parent_slug = 'vape' then
    new.kind := 'vape';
  elsif v_slug = 'plates' or v_parent_slug = 'plates' then
    new.kind := 'plate';
  else
    new.kind := 'accessory';
  end if;

  return new;
end;
$$;

create trigger products_derive_kind
  before insert or update of category_id on public.products
  for each row execute function public.derive_product_kind();

comment on function public.derive_product_kind is
  'Computes products.kind from category_id (0064, client decision #14) — Vape/Number Plates category or a direct subcategory of either sets kind accordingly, everything else is "accessory". kind itself is unchanged in shape or meaning; every existing compliance check that reads it (product_is_purchasable_online, order_lines_reject_vape, the storefront''s isPurchasable/requiresVerification) keeps working exactly as before, now fed automatically instead of hand-picked on the product form.';

-- ---------------------------------------------------------------------------
-- 5. Migrate existing products: kind='vape'/'plate' move to the matching
--    mandatory category. kind='accessory' products are untouched — their
--    real category was never in question.
-- ---------------------------------------------------------------------------

update public.products
   set category_id = (select id from public.categories where slug = 'vape')
 where kind = 'vape';

update public.products
   set category_id = (select id from public.categories where slug = 'plates')
 where kind = 'plate';
