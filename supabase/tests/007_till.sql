-- 007 — The till
-- Sales with real split payments, below-cost handling, and refunds that
-- know both tenders and can't exceed what was actually paid.

begin;
set local search_path to public, tap, extensions;
select plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000701', 'test-staff-007@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000000701', 'test-staff-007@example.invalid', 'Test Cashier', 'owner');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000000710', 'till-test-item', 'Till Test Item', 'cases', 1000, 400, 100),
  ('00000000-0000-0000-0000-000000000711', 'till-test-cheap', 'Till Test Cheap Item', 'cases', 300, 500, 100);

-- ---------------------------------------------------------------------------
-- Split payments must sum to the total exactly
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',900))
  )
  $$,
  null, null, 'payments summing to less than the total fails'
);
select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1100))
  )
  $$,
  null, null, 'payments summing to more than the total fails'
);
select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',999))
  )
  $$,
  null, null, 'one penny under the total fails — this is the case that actually matters'
);
select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1001))
  )
  $$,
  null, null, 'one penny over the total fails too'
);

select lives_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',1000))
  )
  $$,
  'an exact single payment succeeds'
);

-- Three-way split: 334 + 333 + 333 = 1000, cash + pos1 + pos2.
select lives_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(
      jsonb_build_object('tender','cash','amount',334),
      jsonb_build_object('tender','pos1','amount',333),
      jsonb_build_object('tender','pos2','amount',333)
    )
  )
  $$,
  'a three-way split across cash, pos1 and pos2 that sums exactly succeeds'
);
select is(
  (select count(*) from public.sale_payments sp
   join public.sales s on s.id = sp.sale_id
   where s.subtotal = 1000
   group by sp.sale_id
   having count(*) = 3
   limit 1)::integer,
  3,
  'the three-way split sale recorded exactly three payment rows'
);

-- ---------------------------------------------------------------------------
-- Below-cost sales: allowed, flagged, reason genuinely optional
-- ---------------------------------------------------------------------------

-- complete_sale() is deliberately run as its own statement here, not nested
-- inline as an argument to ok() — pgTAP's assertion functions return SETOF
-- text, and Postgres can evaluate a volatile function's arguments in
-- confusing ways when it sits in a target list alongside a set-returning
-- function. Stashing the id first sidesteps that entirely (found by hitting
-- exactly this: a real below_cost=true row existed, and ok() still reported
-- the expression as NULL, because complete_sale had effectively run in a
-- way that didn't line up with what the WHERE clause saw).
create temporary table _t007_below_cost_1 as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000711','quantity',1,'unit_price',300,'list_price',300)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',300))
  ) as id;
select ok(
  (select below_cost from public.sales where id = (select id from _t007_below_cost_1)),
  'a sale below cost (300p charged, 500p cost) succeeds and is flagged below_cost, with no reason given at all'
);

create temporary table _t007_below_cost_2 as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000711','quantity',1,'unit_price',300,'list_price',300)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',300)),
    0, 'clearing old stock, owner approved'
  ) as id;
select ok(
  (select below_cost from public.sales where id = (select id from _t007_below_cost_2)),
  'a below-cost sale with a reason also succeeds and is flagged — the reason is accepted, not required'
);

-- ---------------------------------------------------------------------------
-- Refunds: original vs refund tender, goodwill, window override, amount cap
-- ---------------------------------------------------------------------------

select public.complete_sale(
  '00000000-0000-0000-0000-000000000701'::uuid,
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
  jsonb_build_array(jsonb_build_object('tender','pos1','amount',1000))
);

do $$
declare
  v_sale_id uuid;
begin
  select id into v_sale_id from public.sales where subtotal = 1000
    and exists (select 1 from public.sale_payments where sale_id = sales.id and tender = 'pos1' and amount = 1000)
  order by created_at desc limit 1;
  perform public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000000701', p_amount => 1000, p_refund_tender => 'cash',
    p_reason => 'card machine was down, refunded as cash',
    p_sale_id => v_sale_id, p_original_tender => 'pos1'
  );
end $$;

select ok(
  exists (
    select 1 from public.refunds where original_tender = 'pos1' and refund_tender = 'cash' and reason like 'card machine%'
  ),
  'a refund records both the original tender (pos1) and the refund tender (cash), and they differ'
);

-- A "goodwill, no receipt" refund with no sale, order or job to point at is
-- no longer representable — 0013 tightened refunds to require exactly one
-- of the three (see refunds_exactly_one_link). Previously this succeeded;
-- now it's refused, and that refusal is what's being proven here.
select throws_ok(
  $$ select public.create_refund('00000000-0000-0000-0000-000000000701', 500, 'cash', 'goodwill, no receipt') $$,
  null, null,
  'a refund naming no sale, order or job at all is refused — refunds_exactly_one_link requires exactly one'
);

-- A dedicated sale for the two window-override tests below, rather than
-- picking an arbitrary earlier one — an unrelated fixture sale could be
-- below-cost (300p) or already refunded up to its cap, which would fail
-- these for the wrong reason entirely.
create temporary table _t007_window_sale as
  select public.complete_sale(
    '00000000-0000-0000-0000-000000000701'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',2,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(jsonb_build_object('tender','cash','amount',2000))
  ) as id;

select throws_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000000701', p_amount => 500, p_refund_tender => 'cash',
    p_reason => 'outside window, owner said yes', p_sale_id => (select id from _t007_window_sale),
    p_outside_window => true
  )
  $$,
  null, null,
  'outside_window = true with no authoriser is refused (the CHECK constraint from 0008 catches this)'
);
select lives_ok(
  $$
  select public.create_refund(
    p_staff_id => '00000000-0000-0000-0000-000000000701', p_amount => 500, p_refund_tender => 'cash',
    p_reason => 'outside window, owner said yes', p_sale_id => (select id from _t007_window_sale),
    p_outside_window => true, p_window_override_by => '00000000-0000-0000-0000-000000000701'
  )
  $$,
  'outside_window = true WITH an authoriser recorded succeeds'
);
select ok(
  exists (select 1 from public.refunds where outside_window and window_override_by = '00000000-0000-0000-0000-000000000701'),
  'the window-override refund is on record with who authorised it'
);

select public.complete_sale(
  '00000000-0000-0000-0000-000000000701'::uuid,
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000000710','quantity',1,'unit_price',1000,'list_price',1000)),
  jsonb_build_array(jsonb_build_object('tender','cash','amount',1000))
);
select throws_ok(
  $$
  select public.create_refund(
    '00000000-0000-0000-0000-000000000701', 1500, 'cash', 'trying to refund more than was paid',
    '[]'::jsonb,
    (select id from public.sales where subtotal = 1000
       and exists (select 1 from public.sale_payments where sale_id = sales.id and tender='cash' and amount=1000)
     order by created_at desc limit 1)
  )
  $$,
  null, null,
  'refunding more (1500p) than the sale was worth (1000p) fails'
);

-- ---------------------------------------------------------------------------
-- One float_open per trading day
-- ---------------------------------------------------------------------------

insert into public.cash_entries (trading_day, kind, amount, note, staff_id)
values ('2026-01-01', 'float_open', 15000, 'opening float', '00000000-0000-0000-0000-000000000701');

select throws_ok(
  $$
  insert into public.cash_entries (trading_day, kind, amount, note, staff_id)
  values ('2026-01-01', 'float_open', 15000, 'a second person opening the same day', '00000000-0000-0000-0000-000000000701')
  $$,
  null, null,
  'a second float_open on the same trading day fails'
);
select lives_ok(
  $$
  insert into public.cash_entries (trading_day, kind, amount, note, staff_id)
  values ('2026-01-02', 'float_open', 15000, 'opening float, next day', '00000000-0000-0000-0000-000000000701')
  $$,
  'a float_open on the next trading day succeeds'
);

-- trading_day defaults from shop_day(now()), not a value the caller has to
-- compute and can get wrong. Proven by letting both defaults (created_at and
-- trading_day) resolve from the SAME statement's now() and checking they
-- agree — the DST-boundary correctness of shop_day() itself is 002's job,
-- already proven there; this is only proving cash_entries actually wires
-- up to it.
insert into public.cash_entries (kind, amount, note, staff_id)
values ('petty_in', 500, 'default trading_day check', '00000000-0000-0000-0000-000000000701');
select is(
  (select trading_day from public.cash_entries where note = 'default trading_day check'),
  (select public.shop_day(created_at) from public.cash_entries where note = 'default trading_day check'),
  'trading_day defaults to shop_day(created_at) when not supplied — the day boundary is computed, not typed in by hand'
);

select * from finish();
rollback;
