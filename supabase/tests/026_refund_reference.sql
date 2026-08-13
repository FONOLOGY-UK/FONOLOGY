-- 026 — Refunds have their own reference (migration 0035)
--
-- WHAT THIS PROTECTS
-- A refund receipt is a document the customer keeps. Before 0035 `refunds` was
-- the only customer-facing record with no reference of its own, and the API
-- borrowed the original sale's — so two partial refunds against one sale
-- printed the SAME number and could not be told apart on paper.
--
-- Test 4 below is the one that matters: two refunds against one sale must get
-- two different references. If somebody ever "simplifies" the trigger into
-- copying the sale's reference, that test is what stops it.
--
-- The rest pin down the things that are easy to lose in a later edit: the
-- REF- prefix (money out stays visually distinct from money in, same reasoning
-- as BUY- in 0007), the reference_registry row (the hard rule is that
-- issue_reference() is the ONLY way a reference is ever created), and the fact
-- that the trigger fires underneath create_refund() rather than needing that
-- function to remember to mint one.

begin;
set local search_path to public, tap, extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000002601', 'test-staff-026@example.invalid');

insert into public.staff (id, email, name, role)
values (
  '00000000-0000-0000-0000-000000002601',
  'test-staff-026@example.invalid',
  'Test Cashier 026',
  'owner'
);

insert into public.products (id, slug, name, category, price, cost_price, stock_qty)
values ('00000000-0000-0000-0000-000000002610', 'refund-ref-item', 'Refund Ref Item', 'cases', 6000, 2000, 100);

-- A real sale through the real function, so the refund has something to be
-- taken against and a genuine FNL- reference to be distinguished from.
create temporary table t_sale (id uuid);
insert into t_sale
select public.complete_sale(
  '00000000-0000-0000-0000-000000002601'::uuid,
  jsonb_build_array(jsonb_build_object(
    'product_id', '00000000-0000-0000-0000-000000002610',
    'quantity', 1, 'unit_price', 6000, 'list_price', 6000
  )),
  jsonb_build_array(jsonb_build_object('tender', 'cash', 'amount', 6000))
);

-- ---------------------------------------------------------------------------
-- 1–3. The column itself
-- ---------------------------------------------------------------------------

select has_column('public', 'refunds', 'reference', 'refunds has a reference column');

select col_not_null(
  'public', 'refunds', 'reference',
  'refunds.reference is NOT NULL — a refund receipt with no reference is not a document'
);

select is(
  (select count(*)::int
     from pg_indexes
    where schemaname = 'public'
      and tablename = 'refunds'
      and indexdef ilike '%unique%'
      and indexdef ilike '%(reference)%'),
  1,
  'refunds.reference is uniquely indexed, like every other reference column'
);

-- ---------------------------------------------------------------------------
-- 4. THE ONE THAT MATTERS — two refunds against one sale differ
-- ---------------------------------------------------------------------------

create temporary table t_refunds (id uuid, seq int);

insert into t_refunds
select public.create_refund(
  p_staff_id      => '00000000-0000-0000-0000-000000002601',
  p_amount        => 2000,
  p_refund_tender => 'cash',
  p_reason        => 'first partial refund',
  p_sale_id       => (select id from t_sale)
), 1;

insert into t_refunds
select public.create_refund(
  p_staff_id      => '00000000-0000-0000-0000-000000002601',
  p_amount        => 1500,
  p_refund_tender => 'cash',
  p_reason        => 'second partial refund, same sale',
  p_sale_id       => (select id from t_sale)
), 2;

select isnt(
  (select r.reference from public.refunds r join t_refunds t on t.id = r.id where t.seq = 1),
  (select r.reference from public.refunds r join t_refunds t on t.id = r.id where t.seq = 2),
  'two partial refunds against ONE sale get DIFFERENT references — the whole point of 0035'
);

-- ---------------------------------------------------------------------------
-- 5–6. The trigger fires under create_refund(), with the right prefix
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.refunds r
     join t_refunds t on t.id = r.id
    where r.reference like 'REF-%'),
  2,
  'create_refund() produces REF- references without being modified — the trigger fires underneath it'
);

select isnt(
  (select r.reference from public.refunds r join t_refunds t on t.id = r.id where t.seq = 1),
  (select s.reference from public.sales s join t_sale ts on ts.id = s.id),
  'a refund reference is not the sale reference it was taken against'
);

-- ---------------------------------------------------------------------------
-- 7–8. issue_reference() is the only source — the registry proves it
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.reference_registry rr
     join t_refunds t on t.id = rr.entity_id
    where rr.entity_type = 'refund'),
  2,
  'every refund reference is recorded in reference_registry as entity_type = refund'
);

select is(
  (select count(distinct rr.reference)::int from public.reference_registry rr
     join t_refunds t on t.id = rr.entity_id
    where rr.entity_type = 'refund'),
  2,
  'the registry holds both refund references, not one reused row'
);

-- ---------------------------------------------------------------------------
-- 9. The REF- series shares one sequence with FNL- and BUY-
-- ---------------------------------------------------------------------------
-- Not cosmetic: the whole scheme assumes a reference is globally unique across
-- entity types. A separate counter for refunds would let REF-10250 and
-- FNL-10250 both exist, and reference_registry's primary key would then be the
-- only thing stopping a collision — by rejecting a legitimate refund.
--
-- Proved by ORDER rather than by sweeping the whole registry: these refunds were
-- created after the sale, so drawing from one advancing sequence means their
-- numbers must be higher than the sale's. A sweep of every reference in the
-- database would couple this test to whatever else happens to be seeded.

select cmp_ok(
  (select split_part(r.reference, '-', 2)::bigint
     from public.refunds r join t_refunds t on t.id = r.id where t.seq = 1),
  '>',
  (select split_part(s.reference, '-', 2)::bigint
     from public.sales s join t_sale ts on ts.id = s.id),
  'a refund minted after a sale draws a HIGHER number — one shared sequence, differing only by prefix'
);

-- ---------------------------------------------------------------------------
-- 10. A caller-supplied reference is honoured, not silently renumbered
-- ---------------------------------------------------------------------------
-- The guard exists so a future data import or backfill cannot have its
-- references quietly replaced by freshly minted ones.

insert into public.refunds (id, amount, refund_tender, reason, staff_id, sale_id, reference)
values (
  '00000000-0000-0000-0000-000000002690',
  100, 'cash', 'explicit reference supplied',
  '00000000-0000-0000-0000-000000002601',
  (select id from t_sale),
  'REF-IMPORTED-1'
);

select is(
  (select reference from public.refunds where id = '00000000-0000-0000-0000-000000002690'),
  'REF-IMPORTED-1',
  'a caller-supplied reference is kept, not overwritten by the trigger'
);

-- ---------------------------------------------------------------------------
-- 11. Uniqueness is actually enforced
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.refunds (amount, refund_tender, reason, staff_id, reference)
  values (100, 'cash', 'duplicate reference', '00000000-0000-0000-0000-000000002601', 'REF-IMPORTED-1')
  $$,
  null, null,
  'a duplicate refund reference is refused'
);

rollback;
