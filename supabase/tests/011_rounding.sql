-- 011 — Rounding
-- Every place this schema does arithmetic on money, checked for the same
-- failure mode: a fraction of a penny appearing anywhere, or a whole being
-- split into parts that don't sum back to the whole. Two real bugs of
-- exactly this shape were found and fixed in 0010 while writing this file
-- (see its own comments) — cost was being prorated across payment tenders
-- with round() applied per row, which doesn't guarantee the rows sum to the
-- truth. This file is what proves that's actually fixed, not just changed.

begin;
set local search_path to public, tap, extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001101', 'test-staff-011@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001101', 'test-staff-011@example.invalid', 'Test Rounder', 'owner');

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001110', 'rounding-split-sale-item', 'Rounding Split Sale Item', 'cases', 1000, 700, 100),
  ('00000000-0000-0000-0000-000000001120', 'rounding-job-part-item', 'Rounding Job Part Item', 'cases', 2000, 1000, 100);

-- ---------------------------------------------------------------------------
-- No money column anywhere can even hold a fraction of a penny
-- ---------------------------------------------------------------------------
-- Catalog-driven, same principle as 001: this is checked against the actual
-- column types in public, not against a list of tables someone has to keep
-- up to date. devices.price_multiplier is the one documented exception — a
-- ratio, not money, called out in its own migration comment.

select is_empty(
  $$
  select table_name || '.' || column_name
  from information_schema.columns
  where table_schema = 'public'
    and data_type in ('numeric', 'real', 'double precision')
    and not (table_name = 'devices' and column_name = 'price_multiplier')
  $$,
  'the only non-integer-typed column anywhere in public is devices.price_multiplier — every money column is the integer pence domain, which cannot hold a fraction of a penny by construction'
);

select throws_ok(
  $$
  insert into public.products (slug, name, category, price, cost_price, stock_qty)
  values ('rounding-fraction-literal', 'x', 'cases', '10.50', 0, 0)
  $$,
  null, null,
  'a price literal with a decimal point is refused at the type level before any business logic runs — pence is an integer domain, not a numeric one that happens to round'
);

-- ---------------------------------------------------------------------------
-- Repair quote pricing: base x multiplier, always whole pounds
-- ---------------------------------------------------------------------------
-- A 33%-ish multiplier against a base price that doesn't divide evenly is
-- exactly the shape the brief asked to stress. The function rounds to whole
-- pounds by design (0006) — proving that here means proving the result is
-- always a multiple of 100p, not just an integer (which pence already
-- guarantees trivially).

insert into public.devices (id, name, brand, price_multiplier) values
  ('00000000-0000-0000-0000-000000001150', 'Rounding Test Device', 'TestBrand', 1.33);
insert into public.repair_types (id, name, base_price_original, base_price_oem, base_price_copy) values
  ('00000000-0000-0000-0000-000000001151', 'Rounding Test Repair', 3333, 3333, 3333);

select is(
  public.repair_quote_price('00000000-0000-0000-0000-000000001151', '00000000-0000-0000-0000-000000001150', 'original') % 100,
  0,
  'a 33% multiplier (1.33) against a base price that does not divide evenly (3333p) still produces a price that is a whole number of pounds, never a fraction'
);

-- ---------------------------------------------------------------------------
-- Weighted-average stock cost rounds to a single whole penny, matching its
-- own formula exactly — not truncated, not drifted
-- ---------------------------------------------------------------------------
-- 1 unit already on the shelf at 100p, receiving 1 more at 101p: the true
-- average is 100.5p, which cannot be stored (pence is an integer). What's
-- being proved is that the stored value is round(100.5) — i.e. the
-- migration's own rounding rule — not some other number.

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001160', 'rounding-avg-cost-item', 'Rounding Avg Cost Item', 'cases', 500, 100, 1);

do $$ begin
  perform public.stock_receive('00000000-0000-0000-0000-000000001160', 1, 101);
end $$;

select is(
  (select cost_price::integer from public.products where id = '00000000-0000-0000-0000-000000001160'),
  (round((100::numeric * 1 + 101::numeric * 1) / 2))::integer,
  'weighted-average cost after an unevenly-dividing receipt (100p x1, 101p x1) lands on round(100.5), matching the migration''s own formula exactly'
);

-- ---------------------------------------------------------------------------
-- A three-way split of an odd total: the naive equal split is refused, the
-- correct one (with the odd penny somewhere) is accepted
-- ---------------------------------------------------------------------------
-- 1000p split three ways "equally" is 333.33 each — not expressible in
-- pence. A caller that rounds each share to 333 and stops is a penny short.
-- The schema doesn't silently absorb that penny; it refuses the sale.

select throws_ok(
  $$
  select public.complete_sale(
    '00000000-0000-0000-0000-000000001101'::uuid,
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001110','quantity',1,'unit_price',1000,'list_price',1000)),
    jsonb_build_array(
      jsonb_build_object('tender','cash','amount',333),
      jsonb_build_object('tender','pos1','amount',333),
      jsonb_build_object('tender','pos2','amount',333)
    )
  )
  $$,
  null, null,
  'a naive equal three-way split of 1000p (333+333+333=999) is refused — the missing penny is not silently absorbed'
);

create temporary table t_split_sale as
select public.complete_sale(
  '00000000-0000-0000-0000-000000001101'::uuid,
  jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001110','quantity',1,'unit_price',1000,'list_price',1000)),
  jsonb_build_array(
    jsonb_build_object('tender','cash','amount',334),
    jsonb_build_object('tender','pos1','amount',333),
    jsonb_build_object('tender','pos2','amount',333)
  )
) as id;

select is(
  (select coalesce(sum(amount), 0)::integer from public.sale_payments where sale_id = (select id from t_split_sale)),
  1000,
  'a corrected three-way split that puts the odd penny somewhere (334+333+333=1000) is accepted and sums exactly to the total'
);

-- ---------------------------------------------------------------------------
-- The split-payment sale's ledger row: one row, exact cost, no tender
-- ---------------------------------------------------------------------------
-- This is the assertion the brief specifically asked for: cost is not
-- fragmented across the three tenders above. There is exactly one ledger
-- row for this sale, its cost is sales.cost exactly (not a proportional
-- slice of it), and it carries no single tender, because it doesn't have one.

select is(
  (select count(*)::integer from public.transactions where reference = (select reference from public.sales where id = (select id from t_split_sale))),
  1,
  'the split-payment sale produces exactly one ledger row, not one per payment tender'
);
select is(
  (
    (select cost from public.transactions where reference = (select reference from public.sales where id = (select id from t_split_sale)))
    = (select cost from public.sales where id = (select id from t_split_sale))
  ),
  true,
  'that one ledger row''s cost is sales.cost exactly — not a proportional slice, because there is nothing left to prorate across'
);

-- ---------------------------------------------------------------------------
-- A repair job cost that would lose a penny under proportional rounding: it
-- doesn't, because cost isn't prorated across payments any more
-- ---------------------------------------------------------------------------
-- Job costs 1000p (one part), priced at 3000p, paid in three equal 1000p
-- installments. The old design rounded each row's share independently:
-- round(1000 x 1000 / 3000) = round(333.33) = 333, three times = 999 — a
-- penny short of the truth, for no reason. Fixed by attaching the job's
-- real cost once, to the payment that completes it, instead. Payments are
-- inserted directly (not via record_job_payment) so their `at` values can
-- be spaced apart — every payment in this same test transaction shares one
-- now(), and the view's ordering needs distinct timestamps to be meaningful.

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000001130', 'walk_in', 'Rounding Test Customer', 'Test device', 'Test problem', 3000);

do $$ begin
  perform public.add_job_part('00000000-0000-0000-0000-000000001130', '00000000-0000-0000-0000-000000001120', 1, '00000000-0000-0000-0000-000000001101');
end $$;

insert into public.job_payments (id, job_id, kind, amount, tender, staff_id, at) values
  ('00000000-0000-0000-0000-000000001131', '00000000-0000-0000-0000-000000001130', 'deposit', 1000, 'cash', '00000000-0000-0000-0000-000000001101', now()),
  ('00000000-0000-0000-0000-000000001132', '00000000-0000-0000-0000-000000001130', 'balance', 1000, 'pos1', '00000000-0000-0000-0000-000000001101', now() + interval '1 minute'),
  ('00000000-0000-0000-0000-000000001133', '00000000-0000-0000-0000-000000001130', 'balance', 1000, 'pos2', '00000000-0000-0000-0000-000000001101', now() + interval '2 minutes');

select is(
  (select coalesce(sum(cost), 0)::integer from public.transactions where reference = (select reference from public.jobs where id = '00000000-0000-0000-0000-000000001130')),
  1000,
  'the job''s three ledger rows sum to exactly 1000p of cost — the real figure, not 999p, the amount proportional rounding used to lose'
);
select is(
  (select count(*)::integer from public.transactions where reference = (select reference from public.jobs where id = '00000000-0000-0000-0000-000000001130') and cost > 0),
  1,
  'exactly one of the job''s three ledger rows carries the cost — attached once, at the payment that completed the job, not fragmented across all three'
);

-- ---------------------------------------------------------------------------
-- A job that never gets fully paid never has cost attributed at all
-- ---------------------------------------------------------------------------
-- Deliberate, not a gap: cost is attached at the moment a job's economics
-- are actually settled. A deposit alone doesn't settle them.

insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000001140', 'walk_in', 'Rounding Test Customer 2', 'Test device 2', 'Test problem 2', 3000);

do $$ begin
  perform public.add_job_part('00000000-0000-0000-0000-000000001140', '00000000-0000-0000-0000-000000001120', 1, '00000000-0000-0000-0000-000000001101');
end $$;

insert into public.job_payments (id, job_id, kind, amount, tender, staff_id, at) values
  ('00000000-0000-0000-0000-000000001141', '00000000-0000-0000-0000-000000001140', 'deposit', 1000, 'cash', '00000000-0000-0000-0000-000000001101', now());

select is(
  (select coalesce(sum(cost), 0)::integer from public.transactions where reference = (select reference from public.jobs where id = '00000000-0000-0000-0000-000000001140')),
  0,
  'a job with only a deposit paid, never reaching its quoted price, contributes zero cost to the ledger — its economics were never settled'
);

select * from finish();
rollback;
