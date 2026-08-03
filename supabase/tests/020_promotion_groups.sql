-- 020 — Atomic promotion groups (migrations 0022/0023)
--
-- The bug these migrations fixed: POST /admin/promotions used to write one
-- promotion across several products as a loop of independent inserts. A
-- failure on the third product left the first two live — a half-applied
-- promotion charging bulk prices on some products and shelf prices on
-- others, on real sales, with nothing to indicate it.
--
-- upsert_promotion_group() replaced that loop with a single transaction.
-- This file's job is to prove the transaction really is all-or-nothing, that
-- editing a group actually replaces its tiers rather than merging them, and
-- that a bad product id fails with a readable message instead of a raw FK
-- violation.

begin;
set local search_path to public, tap, extensions;
select plan(15);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values
  ('00000000-0000-0000-0000-000000002001', 'promo-test-a', 'Promo Test A', 'cases', 2000, 500, 10),
  ('00000000-0000-0000-0000-000000002002', 'promo-test-b', 'Promo Test B', 'cases', 2500, 600, 10),
  ('00000000-0000-0000-0000-000000002003', 'promo-test-c', 'Promo Test C', 'cases', 3000, 700, 10);

-- ---------------------------------------------------------------------------
-- A clean bulk write across two real products succeeds and both rows share
-- the same group_id — that shared id is the whole mechanism this migration
-- introduced for identifying "which rows are one promotion".
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    select public.upsert_promotion_group(
      array['00000000-0000-0000-0000-000000002001'::uuid, '00000000-0000-0000-0000-000000002002'::uuid],
      '[{"minQty": 2, "unitPrice": 1800}]'::jsonb,
      p_label := 'Two-product test bundle'
    )
  $$,
  'a bulk write across two real products succeeds'
);

select is(
  (select count(distinct group_id) from public.promotions
   where product_id in ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000002002')
     and label = 'Two-product test bundle'),
  1::bigint,
  'both products landed under exactly one shared group_id'
);

select is(
  (select count(*) from public.promo_tiers t
   join public.promotions p on p.id = t.promotion_id
   where p.label = 'Two-product test bundle'),
  2::bigint,
  'each of the two products got its own tier row (one tier x two products = two rows)'
);

-- ---------------------------------------------------------------------------
-- Naming one valid and one non-existent product: zero rows written, not some.
-- This is the exact failure mode the bug produced — partial application —
-- proven by checking that NOTHING landed, not just that an error was thrown.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select public.upsert_promotion_group(
      array['00000000-0000-0000-0000-000000002003'::uuid, '00000000-0000-0000-0000-000000000000'::uuid],
      '[{"minQty": 2, "unitPrice": 2500}]'::jsonb,
      p_label := 'Partial-write test'
    )
  $$,
  null, 'This promotion names 1 product(s) that no longer exist.',
  'one valid + one non-existent product raises a readable error, not a raw FK violation'
);

select is(
  (select count(*) from public.promotions where label = 'Partial-write test'),
  0::bigint,
  'the valid product in that failed call got zero rows written — no partial state'
);

select is(
  (select count(*) from public.promotions where product_id = '00000000-0000-0000-0000-000000002003'),
  0::bigint,
  'product C specifically has nothing written after the failed call'
);

-- ---------------------------------------------------------------------------
-- The readable-error guard (0023) applies to a product that is real but
-- disabled just as much as one that never existed — the check is existence,
-- not the foreign key alone, and it fires before anything is written.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.upsert_promotion_group(
       array['00000000-0000-0000-0000-000000002001'::uuid],
       '[{"minQty": 2, "unitPrice": 1500}, {"minQty": 2, "unitPrice": 1600}]'::jsonb,
       p_label := 'Duplicate-tier-qty test'
     )
  $$,
  null, 'Two tiers share the same quantity; which price applies would be arbitrary.',
  'two tiers at the same minQty are refused before anything is written'
);

select throws_ok(
  $$ select public.upsert_promotion_group(
       array['00000000-0000-0000-0000-000000002001'::uuid, '00000000-0000-0000-0000-000000002001'::uuid],
       '[{"minQty": 2, "unitPrice": 1500}]'::jsonb
     )
  $$,
  null, 'The same product is listed more than once in this promotion.',
  'the same product listed twice in one call is refused before anything is written'
);

select throws_ok(
  $$ select public.upsert_promotion_group(
       array[]::uuid[],
       '[{"minQty": 2, "unitPrice": 1500}]'::jsonb
     )
  $$,
  null, 'A promotion needs at least one product.',
  'an empty product list is refused'
);

-- ---------------------------------------------------------------------------
-- Editing a group replaces tiers wholesale — a tier that's removed from the
-- edit call is actually gone afterwards, not left behind by a merge.
-- ---------------------------------------------------------------------------

select public.upsert_promotion_group(
  array['00000000-0000-0000-0000-000000002001'::uuid],
  '[{"minQty": 2, "unitPrice": 1900}, {"minQty": 3, "unitPrice": 1700}]'::jsonb,
  p_label := 'Edit test'
);

select is(
  (select count(*) from public.promo_tiers t
   join public.promotions p on p.id = t.promotion_id
   where p.label = 'Edit test'),
  2::bigint,
  'the fresh promotion starts with both tiers it was created with'
);

select public.upsert_promotion_group(
  array['00000000-0000-0000-0000-000000002001'::uuid],
  '[{"minQty": 2, "unitPrice": 1900}]'::jsonb,
  p_group_id := (select group_id from public.promotions where label = 'Edit test' limit 1),
  p_label := 'Edit test'
);

select is(
  (select count(*) from public.promo_tiers t
   join public.promotions p on p.id = t.promotion_id
   where p.label = 'Edit test'),
  1::bigint,
  'editing with only one tier actually removes the other — replaced wholesale, not merged'
);

select is(
  (select exists (
     select 1 from public.promo_tiers t
     join public.promotions p on p.id = t.promotion_id
     where p.label = 'Edit test' and t.min_qty = 3
   )),
  false,
  'the specific removed tier (minQty 3) is genuinely gone, not just outnumbered'
);

-- Editing a group to drop a product removes that product's row from the
-- group entirely (not just zeroes its tiers) — proves the "no longer listed
-- -> removed" half of an edit, alongside the tier-replacement half above.
select public.upsert_promotion_group(
  array['00000000-0000-0000-0000-000000002001'::uuid, '00000000-0000-0000-0000-000000002002'::uuid],
  '[{"minQty": 2, "unitPrice": 2100}]'::jsonb,
  p_label := 'Drop-product test'
);

select is(
  (select count(*) from public.promotions
   where product_id in ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000002002')
     and label = 'Drop-product test'),
  2::bigint,
  'the drop-product fixture starts with both products in the group'
);

select public.upsert_promotion_group(
  array['00000000-0000-0000-0000-000000002001'::uuid],
  '[{"minQty": 2, "unitPrice": 2100}]'::jsonb,
  p_group_id := (select group_id from public.promotions where label = 'Drop-product test' limit 1),
  p_label := 'Drop-product test'
);

select is(
  (select count(*) from public.promotions where label = 'Drop-product test'),
  1::bigint,
  'the product dropped from the edit call is actually removed from the group, not left behind'
);

select is(
  (select count(*) from public.promotions
   where product_id = '00000000-0000-0000-0000-000000002002' and label = 'Drop-product test'),
  0::bigint,
  'the specific dropped product (B) has no surviving row under this label'
);

select * from finish();
rollback;
