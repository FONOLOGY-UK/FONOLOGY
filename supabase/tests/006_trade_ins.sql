-- 006 — Trade-ins
-- Sell requests, the guest acceptance token, and payouts that must never
-- read as revenue.

begin;
set local search_path to public, tap, extensions;
select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000601', 'test-staff-006@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000000601', 'test-staff-006@example.invalid', 'Test Buyer', 'owner');

insert into public.devices (id, name, brand, price_multiplier)
values ('00000000-0000-0000-0000-000000000610', 'Trade-in Test Device', 'apple', 1.0);

-- ---------------------------------------------------------------------------
-- Status flow — no skipping straight to paid
-- ---------------------------------------------------------------------------

insert into public.sell_requests (id, name, phone, email, preferred_contact, device_id, condition)
values (
  '00000000-0000-0000-0000-000000000620', 'Sell Test Customer', '07700900000', 'sell-test@example.invalid', 'email',
  '00000000-0000-0000-0000-000000000610',
  '{"storage":"128GB","screen":"good","body":"good","powers_on":true,"network":"unlocked","accessories":[]}'::jsonb
);

select is(
  (select status from public.sell_requests where id = '00000000-0000-0000-0000-000000000620')::text,
  'submitted',
  'a new sell request starts at submitted'
);

select throws_ok(
  $$ update public.sell_requests set status = 'paid' where id = '00000000-0000-0000-0000-000000000620' $$,
  null, null,
  'a sell request cannot skip straight from submitted to paid'
);
select throws_ok(
  $$ update public.sell_requests set status = 'accepted' where id = '00000000-0000-0000-0000-000000000620' $$,
  null, null,
  'a sell request cannot skip straight from submitted to accepted either — quoted has to happen first'
);

update public.sell_requests
   set quoted_amount = 15000, quoted_by = '00000000-0000-0000-0000-000000000601', quoted_at = now(), status = 'quoted'
 where id = '00000000-0000-0000-0000-000000000620';

-- ---------------------------------------------------------------------------
-- Acceptance token: single use, expiry respected, only the hash is stored
-- ---------------------------------------------------------------------------

insert into public.sell_request_acceptance_tokens (sell_request_id, token_hash, expires_at)
values ('00000000-0000-0000-0000-000000000620', 'test-hash-single-use-aaaa', now() + interval '7 days');

select is(
  public.redeem_sell_acceptance_token('test-hash-single-use-aaaa'),
  '00000000-0000-0000-0000-000000000620'::uuid,
  'redeeming a valid token returns the sell_request id'
);
select is(
  (select status from public.sell_requests where id = '00000000-0000-0000-0000-000000000620')::text,
  'accepted',
  'redeeming the token also moved the request to accepted'
);
select ok(
  public.redeem_sell_acceptance_token('test-hash-single-use-aaaa') is null,
  'redeeming the same token a second time fails (returns null, nothing to redeem)'
);

insert into public.sell_requests (id, name, phone, email, preferred_contact, device_id, condition, status, quoted_amount, quoted_by, quoted_at)
values (
  '00000000-0000-0000-0000-000000000621', 'Expiry Test Customer', '07700900001', 'expiry-test@example.invalid', 'email',
  '00000000-0000-0000-0000-000000000610',
  '{"storage":"128GB","screen":"good","body":"good","powers_on":true,"network":"unlocked","accessories":[]}'::jsonb,
  'quoted', 12000, '00000000-0000-0000-0000-000000000601', now()
);
insert into public.sell_request_acceptance_tokens (sell_request_id, token_hash, expires_at)
values ('00000000-0000-0000-0000-000000000621', 'test-hash-expired-bbbb', now() - interval '1 hour');

select ok(
  public.redeem_sell_acceptance_token('test-hash-expired-bbbb') is null,
  'an expired token cannot be redeemed'
);
select is(
  (select status from public.sell_requests where id = '00000000-0000-0000-0000-000000000621')::text,
  'quoted',
  'the expired-token attempt left the request status untouched'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sell_request_acceptance_tokens'
      and column_name ilike '%token%' and column_name <> 'token_hash'
  ),
  'the acceptance-token table has no plaintext token column — only token_hash exists'
);

-- ---------------------------------------------------------------------------
-- Payouts: negative amount, BUY- reference, never revenue
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
  insert into public.trade_in_payouts (sell_request_id, device_label, customer_name, amount, method, staff_id)
  values ('00000000-0000-0000-0000-000000000620', 'Trade-in Test Device', 'Sell Test Customer', 15000, 'cash', '00000000-0000-0000-0000-000000000601')
  $$,
  null, null,
  'a positive payout amount is rejected — payouts must be negative'
);

with revenue_before as (
  select coalesce(sum(amount), 0)::integer as total from public.transactions where amount > 0
)
select ok(
  (select total from revenue_before) is not null,
  'sanity: revenue-before figure captured'
);

insert into public.trade_in_payouts (id, sell_request_id, device_label, customer_name, amount, method, staff_id)
values ('00000000-0000-0000-0000-000000000630', '00000000-0000-0000-0000-000000000620', 'Trade-in Test Device', 'Sell Test Customer', -15000, 'cash', '00000000-0000-0000-0000-000000000601');

select ok(
  (select reference from public.trade_in_payouts where id = '00000000-0000-0000-0000-000000000630') like 'BUY-%',
  'the payout got its own BUY- reference, not an FNL- one'
);
select is(
  (select status from public.sell_requests where id = '00000000-0000-0000-0000-000000000620')::text,
  'paid',
  'recording the payout moved the linked sell request to paid'
);

select is(
  (select coalesce(sum(amount), 0) from public.transactions where amount > 0)::integer,
  0,
  'the money ledger''s revenue total is unaffected by the payout just recorded — nothing else in this file has produced positive revenue, so it should read exactly zero, not -15000 and not +15000'
);

-- ---------------------------------------------------------------------------
-- Restocking
-- ---------------------------------------------------------------------------

select public.restock_trade_in(
  '00000000-0000-0000-0000-000000000630', 'Trade-in Test Device Resale', 'cases', 24900, 'accessory', '00000000-0000-0000-0000-000000000601'
);

select ok(
  exists (
    select 1 from public.stock_movements sm
    join public.trade_in_payouts tip on tip.restocked_product_id = sm.product_id
    where tip.id = '00000000-0000-0000-0000-000000000630'
      and sm.kind = 'buy_in' and sm.unit_cost = 15000
  ),
  'restocking created a buy_in movement whose unit cost is exactly what was paid (15000p)'
);

-- Two restocks of the same device label produce different slugs.
insert into public.sell_requests (id, name, phone, email, preferred_contact, device_id, condition, status, quoted_amount, quoted_by, quoted_at)
values (
  '00000000-0000-0000-0000-000000000622', 'Second Sell Customer', '07700900002', 'second-sell@example.invalid', 'email',
  '00000000-0000-0000-0000-000000000610',
  '{"storage":"128GB","screen":"good","body":"good","powers_on":true,"network":"unlocked","accessories":[]}'::jsonb,
  'accepted', 15000, '00000000-0000-0000-0000-000000000601', now()
);
insert into public.trade_in_payouts (id, sell_request_id, device_label, customer_name, amount, method, staff_id)
values ('00000000-0000-0000-0000-000000000631', '00000000-0000-0000-0000-000000000622', 'Trade-in Test Device', 'Second Sell Customer', -15000, 'cash', '00000000-0000-0000-0000-000000000601');

select lives_ok(
  $$ select public.restock_trade_in('00000000-0000-0000-0000-000000000631', 'Trade-in Test Device Resale', 'cases', 24900, 'accessory', '00000000-0000-0000-0000-000000000601') $$,
  'restocking a second device with the identical label as an earlier restock succeeds — no unique-constraint collision'
);
select isnt(
  (select slug from public.products where id = (select restocked_product_id from public.trade_in_payouts where id = '00000000-0000-0000-0000-000000000630')),
  (select slug from public.products where id = (select restocked_product_id from public.trade_in_payouts where id = '00000000-0000-0000-0000-000000000631')),
  'the two restocked products got different slugs despite sharing a name'
);

select * from finish();
rollback;
