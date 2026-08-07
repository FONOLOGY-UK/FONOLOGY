-- 024 — Payment provenance on sale_payments (migration 0030)
--
-- 0030 adds confirmed_by / provider_reference / source to sale_payments so a
-- card leg stops being an unattributed assertion that money arrived.
--
-- The assertion that matters most here is the LAST one: the deferred
-- exact-sum trigger must still hold with the new columns populated. The whole
-- reason provenance went onto sale_payments instead of into a parallel table
-- is that legs outside that trigger are legs the sum rule cannot check — so
-- this file proves the rule survived the change.

begin;
set local search_path to public, tap, extensions;
select plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000241', 'test-staff-024@example.invalid');

insert into public.staff (id, email, name, role)
values (
  '00000000-0000-0000-0000-000000000241',
  'test-staff-024@example.invalid',
  'Test Cashier 024',
  'employee'
);

-- No product or stock fixture: the deferred sum trigger reads sales.total and
-- sale_payments only. Inserting sales directly keeps this file about
-- provenance and the sum rule, nothing else.

-- ---------------------------------------------------------------------------
-- Columns exist, with the shapes the design depends on
-- ---------------------------------------------------------------------------

select has_column('public', 'sale_payments', 'confirmed_by', 'sale_payments.confirmed_by exists');
select has_column('public', 'sale_payments', 'provider_reference', 'sale_payments.provider_reference exists');
select has_column('public', 'sale_payments', 'source', 'sale_payments.source exists');

-- Optional on purpose: staff under pressure will skip the receipt reference,
-- and a required field would either block a completed sale or train people to
-- type junk into it.
select col_is_null(
  'public', 'sale_payments', 'provider_reference',
  'provider_reference is nullable — a missing slip reference must never block a sale'
);

-- Every payment recorded before 0030 was manually taken at the counter, so
-- the default is both convenient and true.
select col_has_default('public', 'sale_payments', 'source', 'source has a default');
select col_default_is('public', 'sale_payments', 'source', 'manual', 'source defaults to manual');

-- ---------------------------------------------------------------------------
-- source is constrained to the two real values
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.sales (id, reference, staff_id, subtotal, discount, cost)
  values ('00000000-0000-0000-0000-0000000002c9', 'TST-0249', '00000000-0000-0000-0000-000000000241', 2000, 0, 800);
  insert into public.sale_payments (sale_id, tender, amount, source)
  values ('00000000-0000-0000-0000-0000000002c9', 'pos1', 2000, 'guessed')
  $$,
  '23514',
  null,
  'an unknown source value is refused — only manual and auto exist'
);

-- ---------------------------------------------------------------------------
-- A manually-confirmed card leg records who said so, and off which slip
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
  insert into public.sales (id, reference, staff_id, subtotal, discount, cost)
  values ('00000000-0000-0000-0000-0000000002c1', 'TST-0241', '00000000-0000-0000-0000-000000000241', 2000, 0, 800);
  insert into public.sale_payments (sale_id, tender, amount, confirmed_by, provider_reference, source)
  values ('00000000-0000-0000-0000-0000000002c1', 'pos1', 2000,
          '00000000-0000-0000-0000-000000000241', 'AUTH 004521', 'manual')
  $$,
  'a manually-confirmed card leg stores the confirming staff member and the slip reference'
);

-- A future Stripe/Dojo confirmation writes the SAME row shape, distinguished
-- only by source. No schema change, and — critically — still inside the sum
-- trigger's reach.
select lives_ok(
  $$
  insert into public.sales (id, reference, staff_id, subtotal, discount, cost)
  values ('00000000-0000-0000-0000-0000000002c2', 'TST-0242', '00000000-0000-0000-0000-000000000241', 2000, 0, 800);
  insert into public.sale_payments (sale_id, tender, amount, provider_reference, source)
  values ('00000000-0000-0000-0000-0000000002c2', 'pos2', 2000, 'pi_3Nx...', 'auto')
  $$,
  'an automated confirmation writes the same row with source=auto — no second table, no schema change'
);

-- ---------------------------------------------------------------------------
-- THE ONE THAT MATTERS: the deferred exact-sum trigger still holds
-- ---------------------------------------------------------------------------
--
-- A split whose legs carry full provenance but do NOT sum to the sale total
-- must still fail at COMMIT. This is the guarantee that justified extending
-- sale_payments rather than adding a parallel payment-leg table.

-- `set constraints all immediate` forces the deferred trigger to fire now
-- rather than at COMMIT. A literal commit cannot be used here: pgTAP runs
-- these through EXECUTE, which refuses transaction control statements, and
-- the whole test file is itself one transaction that ends in rollback.
select throws_ok(
  $$
  do $inner$
  begin
    insert into public.sales (id, reference, staff_id, subtotal, discount, cost)
    values ('00000000-0000-0000-0000-0000000002c3', 'TST-0243', '00000000-0000-0000-0000-000000000241', 2000, 0, 800);
    insert into public.sale_payments (sale_id, tender, amount, confirmed_by, provider_reference, source)
    values ('00000000-0000-0000-0000-0000000002c3', 'pos1', 1200,
            '00000000-0000-0000-0000-000000000241', 'AUTH 111', 'manual');
    insert into public.sale_payments (sale_id, tender, amount, confirmed_by, provider_reference, source)
    values ('00000000-0000-0000-0000-0000000002c3', 'pos2', 500,
            '00000000-0000-0000-0000-000000000241', 'AUTH 222', 'manual');
    set constraints all immediate;
  end
  $inner$
  $$,
  'P0001',
  null,
  'a fully-provenanced split that does not sum to the total is still refused'
);

-- And the balancing case still commits: 1200 + 800 = 2000.
-- Same forcing, opposite expectation: this one must survive the check.
select lives_ok(
  $$
  do $inner$
  begin
    insert into public.sales (id, reference, staff_id, subtotal, discount, cost)
    values ('00000000-0000-0000-0000-0000000002c4', 'TST-0244', '00000000-0000-0000-0000-000000000241', 2000, 0, 800);
    insert into public.sale_payments (sale_id, tender, amount, confirmed_by, provider_reference, source)
    values ('00000000-0000-0000-0000-0000000002c4', 'pos1', 1200,
            '00000000-0000-0000-0000-000000000241', 'AUTH 333', 'manual');
    insert into public.sale_payments (sale_id, tender, amount, confirmed_by, source)
    values ('00000000-0000-0000-0000-0000000002c4', 'pos2', 800,
            '00000000-0000-0000-0000-000000000241', 'manual');
    set constraints all immediate;
  end
  $inner$
  $$,
  'a split across both machines that DOES sum, one leg with no slip reference, is accepted'
);

select * from finish();
rollback;
