-- 016 — Document retention
-- The mechanism already existed (purge_expired_order_documents(), written
-- alongside shop_settings.id_document_retention_days in 0009) but had never
-- actually been run against real rows — this proves it does what its own
-- comment claims: deletes a document once its order is resolved AND past
-- the retention window, and nothing else.
--
-- Not scheduled from inside Postgres itself (pg_cron availability varies by
-- Supabase project tier) — see supabase/tests/README.md and the function's
-- own comment for the exact schedule a deployment should wire up.

begin;
set local search_path to public, tap, extensions;
select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001601', 'test-staff-016@example.invalid');
insert into public.staff (id, email, name, role) values ('00000000-0000-0000-0000-000000001601', 'test-staff-016@example.invalid', 'Test Purger', 'owner');

-- Retention window is 30 days by default (shop_settings.id_document_retention_days).
select is(
  (select id_document_retention_days from public.shop_settings),
  30,
  'sanity check: the default retention window really is 30 days, matching what this file tests against'
);

-- ---------------------------------------------------------------------------
-- Fixtures: three orders, three documents, three different fates
-- ---------------------------------------------------------------------------

insert into public.products (id, slug, name, category, price, cost_price, stock_qty) values
  ('00000000-0000-0000-0000-000000001610', 'retention-test-item', 'Retention Test Item', 'cases', 1000, 400, 100);

-- A: resolved (collected) and past the window — should be purged.
create temporary table _t016_order_a as
  select public.create_order(
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001610','quantity',1)),
    'collect'::delivery_method, p_guest_email => 'retention-a@example.invalid'
  ) as id;
update public.orders set status = 'paid' where id = (select id from _t016_order_a);
update public.orders set status = 'collected' where id = (select id from _t016_order_a);

insert into public.order_documents (id, order_id, kind, storage_path, uploaded_at)
values ('00000000-0000-0000-0000-000000001620', (select id from _t016_order_a), 'v5c', 'id-documents/retention-a.pdf', now() - interval '40 days');

-- B: resolved (collected) but still within the window — should survive.
create temporary table _t016_order_b as
  select public.create_order(
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001610','quantity',1)),
    'collect'::delivery_method, p_guest_email => 'retention-b@example.invalid'
  ) as id;
update public.orders set status = 'paid' where id = (select id from _t016_order_b);
update public.orders set status = 'collected' where id = (select id from _t016_order_b);

insert into public.order_documents (id, order_id, kind, storage_path, uploaded_at)
values ('00000000-0000-0000-0000-000000001621', (select id from _t016_order_b), 'v5c', 'id-documents/retention-b.pdf', now() - interval '5 days');

-- C: past the window, but the order is still 'paid' — not resolved yet, so
-- its document should survive regardless of age. An order awaiting
-- collection can't have its verification paperwork vanish out from under it.
create temporary table _t016_order_c as
  select public.create_order(
    jsonb_build_array(jsonb_build_object('product_id','00000000-0000-0000-0000-000000001610','quantity',1)),
    'collect'::delivery_method, p_guest_email => 'retention-c@example.invalid'
  ) as id;
update public.orders set status = 'paid' where id = (select id from _t016_order_c);

insert into public.order_documents (id, order_id, kind, storage_path, uploaded_at)
values ('00000000-0000-0000-0000-000000001622', (select id from _t016_order_c), 'v5c', 'id-documents/retention-c.pdf', now() - interval '40 days');

-- ---------------------------------------------------------------------------
-- Run the purge
-- ---------------------------------------------------------------------------

create temporary table _t016_purge_result as
  select public.purge_expired_order_documents() as deleted_count;

select is(
  (select deleted_count from _t016_purge_result),
  1,
  'exactly one document was selected for deletion — the resolved, past-window one'
);
select is(
  (select count(*)::integer from public.order_documents where id = '00000000-0000-0000-0000-000000001620'),
  0,
  'the resolved order''s document, uploaded 40 days ago against a 30-day window, is gone'
);
select is(
  (select count(*)::integer from public.order_documents where id = '00000000-0000-0000-0000-000000001621'),
  1,
  'the resolved order''s document uploaded only 5 days ago survives — still within the window'
);
select is(
  (select count(*)::integer from public.order_documents where id = '00000000-0000-0000-0000-000000001622'),
  1,
  'the still-paid (unresolved) order''s document survives even though it is 40 days old — age alone is not enough, the order has to be resolved first'
);

select is(
  (select count(*)::integer from public.orders where id in ((select id from _t016_order_a), (select id from _t016_order_b), (select id from _t016_order_c))),
  3,
  'purging documents never touches the orders themselves — all three still exist'
);

select * from finish();
rollback;
