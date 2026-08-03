-- 022 — Guest-order linking (migration 0027)
--
-- link_guest_orders() adopts a new customer's past guest orders on sign-in.
-- The whole safety of this function rests on one thing: it must only ever
-- touch orders that are genuinely unowned (customer_id IS NULL). If it could
-- reassign an order that already belongs to someone else, this would be a way
-- to steal another customer's order history by simply knowing their email.
--
-- NOTE ON SCOPE: whether the CALLER actually verified the email with the auth
-- provider before calling this (Google only, never password signup — see
-- apps/api/src/routes/auth.routes.ts's verifiedProviderEmail()) is
-- TypeScript logic, not SQL, and cannot be exercised from pgTAP. The
-- function's own doc comment is explicit that this is the caller's
-- responsibility, not something it can enforce itself — a bare SQL function
-- has no way to know whether Google or a self-asserted signup email produced
-- the string it was given. That gate is covered by reading auth.routes.ts
-- directly, not by a test here. What IS a database-level guarantee, and what
-- this file proves, is the ownership rule below.

begin;
set local search_path to public, tap, extensions;
select plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000002201', 'guest-link-new@example.invalid'),
  ('00000000-0000-0000-0000-000000002202', 'guest-link-existing-owner@example.invalid');

insert into public.customers (id, email, name)
values
  ('00000000-0000-0000-0000-000000002201', 'guest-link-new@example.invalid', 'New Customer'),
  ('00000000-0000-0000-0000-000000002202', 'guest-link-existing-owner@example.invalid', 'Existing Owner');

-- Two genuinely unowned guest orders on the address about to sign in.
insert into public.orders
  (id, reference, customer_id, guest_email, delivery_method, subtotal, delivery_fee, discount)
values
  ('00000000-0000-0000-0000-000000002211', 'FNL-TEST2211', null, 'guest-link-new@example.invalid', 'collect', 2000, 0, 0),
  ('00000000-0000-0000-0000-000000002212', 'FNL-TEST2212', null, 'guest-link-new@example.invalid', 'collect', 3000, 0, 0);

-- An order on the SAME email that already belongs to a different customer —
-- this must never move, no matter what link_guest_orders is called with.
insert into public.orders
  (id, reference, customer_id, guest_email, delivery_method, subtotal, delivery_fee, discount)
values
  ('00000000-0000-0000-0000-000000002213', 'FNL-TEST2213', '00000000-0000-0000-0000-000000002202', 'guest-link-new@example.invalid', 'collect', 4000, 0, 0);

-- An unrelated guest order on a different email, to prove the match is
-- genuinely scoped to the email given, not "every unowned order".
insert into public.orders
  (id, reference, customer_id, guest_email, delivery_method, subtotal, delivery_fee, discount)
values
  ('00000000-0000-0000-0000-000000002214', 'FNL-TEST2214', null, 'someone-else@example.invalid', 'collect', 1000, 0, 0);

-- ---------------------------------------------------------------------------
-- The call itself: adopts exactly the two genuinely-unowned orders on this
-- email, and reports the count it touched.
-- ---------------------------------------------------------------------------

select is(
  (select public.link_guest_orders(
     '00000000-0000-0000-0000-000000002201'::uuid,
     'guest-link-new@example.invalid'::citext
   )),
  2,
  'link_guest_orders reports exactly 2 rows linked — the two genuinely unowned orders on this email'
);

select is(
  (select customer_id from public.orders where id = '00000000-0000-0000-0000-000000002211'),
  '00000000-0000-0000-0000-000000002201'::uuid,
  'the first unowned order is now attached to the signing-in customer'
);

select is(
  (select customer_id from public.orders where id = '00000000-0000-0000-0000-000000002212'),
  '00000000-0000-0000-0000-000000002201'::uuid,
  'the second unowned order is now attached to the signing-in customer'
);

-- ---------------------------------------------------------------------------
-- The order already owned by someone else, on the exact same email, is
-- untouched — proving the ownership guard actually holds even when it would
-- be easy to match on email alone.
-- ---------------------------------------------------------------------------

select is(
  (select customer_id from public.orders where id = '00000000-0000-0000-0000-000000002213'),
  '00000000-0000-0000-0000-000000002202'::uuid,
  'an order already belonging to a different customer, on the SAME email, was never reassigned'
);

-- ---------------------------------------------------------------------------
-- The unrelated order on a different email was never touched — proves the
-- match is scoped by email, not "adopt every orphaned order in the table".
-- ---------------------------------------------------------------------------

select is(
  (select customer_id from public.orders where id = '00000000-0000-0000-0000-000000002214'),
  null,
  'an unowned order on a DIFFERENT email is untouched — the match is scoped to the email given'
);

-- ---------------------------------------------------------------------------
-- Calling it again is a genuine no-op: nothing left to adopt, so it reports
-- zero and changes nothing (idempotent, not "adopt the same orders twice").
-- ---------------------------------------------------------------------------

select is(
  (select public.link_guest_orders(
     '00000000-0000-0000-0000-000000002201'::uuid,
     'guest-link-new@example.invalid'::citext
   )),
  0,
  'calling it again with nothing left to adopt reports 0, not a repeat of the same 2'
);

-- ---------------------------------------------------------------------------
-- Guard rails: null inputs are inert, and an id that isn't a real customer
-- profile is refused rather than silently doing nothing.
-- ---------------------------------------------------------------------------

select is(
  (select public.link_guest_orders(null, 'guest-link-new@example.invalid'::citext)),
  0,
  'a null customer id is a no-op, not an error and not a match on email alone'
);

select is(
  (select public.link_guest_orders('00000000-0000-0000-0000-000000002201'::uuid, null)),
  0,
  'a null email is a no-op'
);

select throws_ok(
  $$ select public.link_guest_orders('00000000-0000-0000-0000-000000000000'::uuid, 'guest-link-new@example.invalid'::citext) $$,
  null, 'No customer profile for 00000000-0000-0000-0000-000000000000',
  'an id with no real customer profile is refused, not silently accepted'
);

select * from finish();
rollback;
