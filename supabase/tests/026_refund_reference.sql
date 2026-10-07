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
-- REF prefix (money out stays visually distinct from money in, same reasoning
-- as PAY for payouts), the reference_registry row (the hard rule is that
-- issue_shop_reference() is the ONLY way a reference is ever created, 0106), and the fact
-- that the trigger fires underneath create_refund() rather than needing that
-- function to remember to mint one.

begin;
set local search_path to public, tap, extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.user_accounts (id, email)
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
    where r.reference ~ '^F01-REF-[0-9]{9}$'),
  2,
  'create_refund() produces F01-REF- references without being modified — the trigger fires underneath it'
);

select isnt(
  (select r.reference from public.refunds r join t_refunds t on t.id = r.id where t.seq = 1),
  (select s.reference from public.sales s join t_sale ts on ts.id = s.id),
  'a refund reference is not the sale reference it was taken against'
);

-- ---------------------------------------------------------------------------
-- 7–8. issue_shop_reference() is the only source — the registry proves it
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
-- 9. Refunds count in their own series (0106)
-- ---------------------------------------------------------------------------
-- Each shop has a REF series per day, separate from its sales: the second
-- refund is the next REF number, whatever the sale before it was numbered.

select is(
  (select substr(split_part(r.reference, '-', 3), 7)::int
     from public.refunds r join t_refunds t on t.id = r.id where t.seq = 2),
  (select substr(split_part(r.reference, '-', 3), 7)::int + 1
     from public.refunds r join t_refunds t on t.id = r.id where t.seq = 1),
  'the second refund is the next number in the shop''s REF series for the day'
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
