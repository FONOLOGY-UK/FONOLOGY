-- 0078 — Hard-lock in_store_only for the Vape category (legal requirement)
--
-- THE PROBLEM
-- Client decision: vapes must be hidden from the storefront entirely, not
-- listed-but-unbuyable as they are today. in_store_only (0044) is what
-- controls storefront visibility (GET /products and GET /products/:slug both
-- filter on it), but it is currently a free, unforced boolean — nothing ties
-- it to category, and the admin checkbox is plain and uncheckable-in-neither-
-- direction. kind='vape' (also category-derived, 0064's derive_product_kind)
-- already keeps a vape product OUT of the cart/checkout path
-- (isPurchasable/order_lines_reject_vape/product_is_purchasable_online) — but
-- that only ever blocked the *sale*, never the *listing*. This migration
-- closes the listing gap the same way 0064 closed the sale one: server-side,
-- derived from category, unconditionally.
--
-- SHAPE, COPIED FROM derive_product_kind() (0064)
-- Same trigger moment, same one-level parent walk (categories are only ever
-- one level deep — 0045's own comment), same "the database is the
-- enforcement point" posture. Deliberately NOT merged into
-- derive_product_kind() itself: that function's job is computing kind, this
-- one's job is forcing a visibility flag, and 0064's own comment already
-- promises every existing reader of kind that its shape won't change under
-- them — piling a second, unrelated side effect into it would break that
-- promise for no reason.
--
-- ONE-DIRECTIONAL ON PURPOSE
-- This trigger only ever forces in_store_only TRUE when the resolved
-- category is Vape (or a Vape subcategory). It never forces it false for
-- anything else — in_store_only stays exactly what 0044 made it everywhere
-- outside Vape: a free, independent, admin-set flag with no relationship to
-- category. Moving a product OUT of Vape does not un-hide it automatically;
-- that is a deliberate admin decision the trigger has no business making for
-- them.
--
-- WHY "OR update of in_store_only" TOO, NOT JUST category_id
-- derive_product_kind() only needs `update of category_id` — kind has no
-- other writer. in_store_only does: PUT /admin/products/:id sets it directly
-- from the form on every save, in the same UPDATE statement as category_id
-- (so `update of category_id` alone would already catch every request this
-- app currently makes) — but "must not be uncheckable" is a legal
-- requirement, not a UX nicety, and the correctness of that promise shouldn't
-- depend on every future caller remembering to also touch category_id in the
-- same statement. Listing in_store_only here too means ANY update that tries
-- to flip it — through this route, a future one, or a hand-run SQL edit that
-- isn't a delete-and-recreate — gets re-checked against the product's actual
-- category before it lands.
--
-- BACKFILL
-- Same pattern as 0064's kind backfill: existing vape products get
-- in_store_only forced true directly, in this migration, rather than relying
-- on the next unrelated edit to trip the trigger.

create or replace function public.derive_in_store_only()
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
    new.in_store_only := true;
  end if;

  return new;
end;
$$;

create trigger products_derive_in_store_only
  before insert or update of category_id, in_store_only on public.products
  for each row execute function public.derive_in_store_only();

comment on function public.derive_in_store_only is
  'Forces products.in_store_only to true when category_id (or its parent) resolves to the Vape category (0078, legal requirement — vapes hidden from the storefront entirely). One-directional: never forces it false for anything else, matching in_store_only''s existing free-flag behaviour outside Vape. Fires on category_id or in_store_only being touched, so neither a re-categorise nor a direct attempt to uncheck the flag can bypass it. Same shape as derive_product_kind (0064), kept separate because the two functions have unrelated jobs.';

comment on column public.products.in_store_only is
  'True = sellable at the till (POS) but absent from the customer-facing storefront (GET /products, GET /products/:slug) entirely. Independent of is_active (retired — hidden everywhere) and free for any product EXCEPT Vape (or a Vape subcategory), where products_derive_in_store_only (0078) forces it true and keeps it there — a legal requirement, not a preference. Was independent of kind=''vape'' as of 0044; that changed in 0078, which is why this comment is being re-set rather than left as 0044 wrote it.';

update public.products
   set in_store_only = true
 where in_store_only = false
   and (
     category_id = (select id from public.categories where slug = 'vape')
     or category_id in (
          select id from public.categories
           where parent_id = (select id from public.categories where slug = 'vape')
        )
   );
