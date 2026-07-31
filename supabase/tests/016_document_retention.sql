-- 016 — Document retention
--
-- This file used to call `purge_expired_order_documents()` (0009), which
-- migration 0020 DROPPED on purpose: it deleted the `order_documents` row and
-- never touched the Storage object behind it, so the file lingered in the
-- bucket forever. A row marked gone while the actual ID document survives is
-- not deletion in any sense that matters for GDPR.
--
-- 0020 replaced it with `documents_due_for_deletion()`, which is deliberately
-- SELECT-only: Postgres cannot reach the Supabase Storage HTTP API, so the
-- database's job is to decide WHICH documents are safe and due, and the API
-- (apps/api/src/lib/documentRetention.ts) does the real two-part deletion —
-- storage object first, then the row, then an audit_log entry, one document at
-- a time so a storage failure never silently orphans a row.
--
-- So this file proves the half the database is actually responsible for: the
-- selection is exactly right, it hands over the storage_path the API needs to
-- delete the real file, and calling it deletes nothing by itself. The API-side
-- half needs a live Storage bucket and is covered there, not here.
--
-- Not scheduled from inside Postgres (pg_cron availability varies by Supabase
-- project tier) — see supabase/tests/README.md.

begin;
set local search_path to public, tap, extensions;
select plan(9);

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
-- Ask the database which documents are due
-- ---------------------------------------------------------------------------

create temporary table _t016_due as
  select * from public.documents_due_for_deletion();

select is(
  (select count(*)::integer from _t016_due
    where id in ('00000000-0000-0000-0000-000000001620',
                 '00000000-0000-0000-0000-000000001621',
                 '00000000-0000-0000-0000-000000001622')),
  1,
  'exactly one of this file''s three documents is due for deletion'
);
select is(
  (select count(*)::integer from _t016_due where id = '00000000-0000-0000-0000-000000001620'),
  1,
  'the resolved order''s document, uploaded 40 days ago against a 30-day window, IS due'
);
select is(
  (select count(*)::integer from _t016_due where id = '00000000-0000-0000-0000-000000001621'),
  0,
  'the resolved order''s document uploaded only 5 days ago is NOT due — still within the window'
);
select is(
  (select count(*)::integer from _t016_due where id = '00000000-0000-0000-0000-000000001622'),
  0,
  'the still-paid (unresolved) order''s document is NOT due even though it is 40 days old — age alone is not enough, the order has to be resolved first'
);

-- The storage_path is the entire reason 0009's version was replaced: without
-- it the API cannot delete the actual file, only the row pointing at it.
select is(
  (select storage_path from _t016_due where id = '00000000-0000-0000-0000-000000001620'),
  'id-documents/retention-a.pdf',
  'the due row carries the storage_path, so the API can delete the real file and not just the row'
);
select is(
  (select order_status::text from _t016_due where id = '00000000-0000-0000-0000-000000001620'),
  'collected',
  'and the order status it was judged on, for the audit entry'
);

-- SELECT-only. This is the property that makes the API responsible for the
-- two-part delete: if this function quietly removed rows, a storage failure
-- afterwards would leave the file orphaned with nothing left pointing at it.
select is(
  (select count(*)::integer from public.order_documents
    where id in ('00000000-0000-0000-0000-000000001620',
                 '00000000-0000-0000-0000-000000001621',
                 '00000000-0000-0000-0000-000000001622')),
  3,
  'asking which documents are due DELETES NOTHING — all three rows survive the call'
);

select is(
  (select count(*)::integer from public.orders where id in ((select id from _t016_order_a), (select id from _t016_order_b), (select id from _t016_order_c))),
  3,
  'and never touches the orders themselves — all three still exist'
);

select * from finish();
rollback;
