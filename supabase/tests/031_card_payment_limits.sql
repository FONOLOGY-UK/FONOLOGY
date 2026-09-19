-- 031 — Card machine spending limits
-- Change request item 5 / migration 0086.
--
-- What matters here is the shape of the rule, not one arithmetic case:
-- a null limit must not block anything, a limit must count REPAIR card
-- payments as well as sale payments (they go through the same terminal),
-- and the two machines must be independent of each other.

begin;
set local search_path to public, tap, extensions;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000b01', 'test-staff-031@example.invalid');
insert into public.staff (id, email, name, role)
values ('00000000-0000-0000-0000-000000000b01', 'test-staff-031@example.invalid', 'Test Cards', 'owner');

-- No limits configured anywhere: the default state of the shop.
select is(
  public.card_limit_breach('pos1', 100000),
  null,
  'with no limit set, nothing breaches — a shop that never configured one does not have one'
);

select is(
  public.card_limit_breach('cash', 100000),
  null,
  'cash can never breach a card limit'
);

update public.shop_settings set card1_daily_limit = 10000;

select is(
  public.card_limit_breach('pos1', 10000),
  null,
  'a payment exactly at the limit is allowed — the rule is "not over", not "under"'
);

select isnt(
  public.card_limit_breach('pos1', 10001),
  null,
  'a payment one penny over the limit breaches'
);

select is(
  public.card_limit_breach('pos2', 10001),
  null,
  'Card 2 is unaffected by Card 1''s limit — the six numbers are independent'
);

-- A REPAIR card payment counts towards the machine's limit. This is the case
-- most likely to be missed: record_job_payment() writes to job_payments and
-- creates no sale at all, but the money went through the same terminal.
insert into public.jobs (id, source, customer_name, device_description, problem_description, quoted_price)
values ('00000000-0000-0000-0000-000000000b10', 'walk_in', 'Card Limit Customer', 'Test Phone', 'Screen', 20000);

do $$ begin
  perform public.record_job_payment('00000000-0000-0000-0000-000000000b10', 'deposit', 6000, 'pos1', '00000000-0000-0000-0000-000000000b01');
end $$;

select isnt(
  public.card_limit_breach('pos1', 5000),
  null,
  'a £60 repair deposit on Card 1 leaves only £40 of a £100 daily limit — a £50 sale breaches'
);

-- And the trigger actually refuses the write, not just the function reporting it.
select throws_ok(
  $$ do $inner$ begin
       perform public.record_job_payment('00000000-0000-0000-0000-000000000b10', 'balance', 5000, 'pos1', '00000000-0000-0000-0000-000000000b01');
     end $inner$ $$,
  null, null,
  'the trigger refuses the payment, so a limit cannot be bypassed by ignoring the screen'
);

select * from finish();
rollback;
