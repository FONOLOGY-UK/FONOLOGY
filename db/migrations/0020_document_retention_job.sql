-- 0020 — Real ID-document retention: a due-for-deletion function the API can
-- act on, replacing purge_expired_order_documents(), which deleted the DB
-- row only and never touched the Storage object behind it — a row marked
-- gone while the actual file lingers in the bucket forever is not deletion
-- for GDPR purposes.
--
-- Postgres/PL-pgSQL cannot reach the Supabase Storage HTTP API directly, so
-- this function is deliberately SELECT-only: it returns exactly the rows
-- that are safe and due to be purged, and the API
-- (apps/api/src/lib/documentRetention.ts) does the real two-part deletion
-- (storage object + DB row) plus the audit log entry, one document at a
-- time, so a failure on one document's storage delete never silently loses
-- its DB row.
--
-- "Safe" = the same terminal order states the schema's own status machine
-- already treats as final (order_status_allowed_next() returns no further
-- moves for these three) — collected, shipped, cancelled. A document on any
-- other status (pending/paid/ready — still live, possibly still mid
-- verification) is never returned here, no matter how old.
--
-- Applied to the DEV project only, per the standing hard rule.

drop function if exists public.purge_expired_order_documents();

create or replace function public.documents_due_for_deletion()
returns table (
  id uuid,
  order_id uuid,
  reference text,
  kind order_document_kind,
  storage_path text,
  uploaded_at timestamptz,
  order_status order_status
)
language sql
stable
as $$
  select
    od.id,
    od.order_id,
    o.reference,
    od.kind,
    od.storage_path,
    od.uploaded_at,
    o.status
  from public.order_documents od
  join public.orders o on o.id = od.order_id
  cross join lateral (
    select id_document_retention_days from public.shop_settings limit 1
  ) s
  where od.uploaded_at < now() - make_interval(days => s.id_document_retention_days)
    and o.status in ('collected', 'shipped', 'cancelled');
$$;

comment on function public.documents_due_for_deletion() is
  'Every order_document past shop_settings.id_document_retention_days AND attached to an order in a terminal state (collected/shipped/cancelled). SELECT-only; the API performs the real storage + DB deletion per row and writes the audit log. Never returns a document on a live/unresolved order regardless of age.';
