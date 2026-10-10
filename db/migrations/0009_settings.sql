-- 0009 — Settings, labels, documents
-- The dials the owner should be able to turn without a developer, the label
-- designer, and a generic private-file table for everything that isn't an
-- order verification document.

-- ---------------------------------------------------------------------------
-- Shop settings — exactly one row
-- ---------------------------------------------------------------------------
-- Enforced at the database level, not by convention: the primary key is a
-- boolean that can only ever be `true`, so a second row is a primary-key
-- violation, not a bug someone has to notice.

create table public.shop_settings (
  singleton   boolean primary key default true,
  constraint shop_settings_is_singleton check (singleton),

  -- Storefront basics
  shop_name       text not null default 'Fonology',
  shop_address    text,
  shop_phone      text,
  shop_email      citext,
  opening_hours   jsonb not null default '[]'::jsonb,   -- [{"day":"Mon","open":"09:00","close":"18:00","closed":false}, ...]
  social_links    jsonb not null default '{}'::jsonb,   -- {"instagram": "...", "tiktok": "...", "google": "..."}

  -- Delivery. Rates themselves live in 0005's delivery_rates table, keyed by
  -- zone and method — not duplicated here. This is only the one delivery
  -- number that isn't a rate: the cut-off for same-day dispatch.
  next_day_cutoff_time time not null default '14:00',

  -- Returns. This is now the ONLY place a return window is defined. The
  -- frontend has a hardcoded RETURN_WINDOW_DAYS constant driving customer
  -- copy AND a separate configurable value driving actual refund
  -- enforcement — two sources of truth for one number, and they can already
  -- disagree today. Do not add a constant anywhere that duplicates this
  -- column; every screen, receipt and policy page reads this row.
  return_window_days integer not null default 30 check (return_window_days >= 0),

  -- Till behaviour. Below-cost sales NEVER block, full stop — that's fixed,
  -- not configurable (see 0008: below_cost_reason is always optional). This
  -- only controls whether the till UI bothers to show the reason box at all;
  -- leaving it blank is always allowed either way.
  below_cost_prompts_for_reason boolean not null default true,

  -- Dashboard lock. PIN itself is per-staff (staff.pin_hash, 0002) — each
  -- person has their own code, which is strictly better than one shared PIN
  -- and already the design 0002 committed to. This is only the shared idle
  -- timeout, which is legitimately shop-wide.
  idle_lock_minutes integer not null default 5 check (idle_lock_minutes >= 1),

  -- Cash
  float_target pence not null default 15000,   -- £150.00, matches the frontend's default

  -- ID documents (plate verification, 0005)
  id_document_retention_days integer not null default 30 check (id_document_retention_days >= 1),

  -- Receipts and customer emails
  receipt_header_text text,
  receipt_footer_text text,
  customer_email_templates jsonb not null default '{}'::jsonb,   -- free-form, keyed by event ("order_confirmed", "ready_for_collection", ...)

  updated_at timestamptz not null default now()
);

insert into public.shop_settings (singleton) values (true);

create trigger shop_settings_updated_at
  before update on public.shop_settings
  for each row execute function public.set_updated_at();

comment on table public.shop_settings is
  'Exactly one row, forced by the singleton/check pair on the primary key. Read it, never insert a second one.';

-- ---------------------------------------------------------------------------
-- Label templates
-- ---------------------------------------------------------------------------
-- The label designer's barcode field and a product's real manufacturer
-- barcode (products.barcode, 0003) are unrelated strings in the frontend —
-- a template can have "a barcode" typed into it with no connection to any
-- actual product. Decided here: linked_product_id lets a template pull the
-- real barcode when it's genuinely labelling a catalogue item; barcode_value
-- stays as a manual override for templates that aren't (a generic "TESTED
-- PRE-OWNED" tag, for instance, which the frontend's own seed data has).

create table public.label_templates (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  lines             jsonb not null,   -- [{"text","size","bold"}] — small and UI-shaped, no relational need
  linked_product_id uuid references public.products (id) on delete set null,
  barcode_value     text,             -- manual override; ignored in favour of the linked product's real barcode when both are present — an API-layer rule, not enforced here
  created_by        uuid references public.staff (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger label_templates_updated_at
  before update on public.label_templates
  for each row execute function public.set_updated_at();

create index label_templates_linked_product_idx
  on public.label_templates (linked_product_id) where linked_product_id is not null;
create index label_templates_created_by_idx
  on public.label_templates (created_by) where created_by is not null;

-- ---------------------------------------------------------------------------
-- Documents — everything private that isn't an order verification document
-- ---------------------------------------------------------------------------
-- Order documents (0005) stay their own table rather than living here,
-- because the ready/shipped gate needs a fast, indexed, direct link to one
-- order and fields (kind, rejection_reason) that don't generalise. This table
-- is for looser attachments — a signed local buy-in form, or anything else
-- private that doesn't drive a status machine. related_entity_type/id is
-- deliberately loose (no foreign key) for the same reason stock_movements'
-- source_type/source_id is loose: this table shouldn't need a foreign key to
-- every table that might attach a file to it.

create type document_kind as enum ('buy_in_form', 'misc');

create table public.documents (
  id                  uuid primary key default gen_random_uuid(),
  kind                document_kind not null,
  storage_path        text not null,
  related_entity_type text,
  related_entity_id   uuid,
  status              document_approval_status not null default 'pending',
  reviewed_by         uuid references public.staff (id),
  reviewed_at         timestamptz,
  uploaded_by         uuid references public.staff (id),
  uploaded_at         timestamptz not null default now()
);

create index documents_related_idx on public.documents (related_entity_type, related_entity_id);
create index documents_reviewed_by_idx on public.documents (reviewed_by) where reviewed_by is not null;
create index documents_uploaded_by_idx on public.documents (uploaded_by) where uploaded_by is not null;

comment on table public.documents is
  'Private files with no status machine of their own — e.g. a buy-in form, where related_entity_type = ''trade_in_payout'' and related_entity_id points at the payout it was signed for. Owner-only visibility and audit-on-view are enforced by 0011 and log_document_view() below, same as order_documents.';

-- The database can see a SELECT; it cannot see a signed Storage URL being
-- minted, because that's a Storage API call, not a query against this table.
-- This function is the primitive the API must call every time it hands out
-- access to a private document — it does not happen on its own.
create or replace function public.log_document_view(
  p_document_id   uuid,
  p_document_type text,   -- 'order_document' or 'document' — which table it came from
  p_staff_id      uuid
)
returns void
language plpgsql
as $$
declare
  v_actor_label text;
begin
  select name into v_actor_label from public.staff where id = p_staff_id;

  insert into public.audit_log (actor_id, actor_label, action, entity_type, entity_id)
  values (p_staff_id, coalesce(v_actor_label, 'unknown'), 'document.view', p_document_type, p_document_id);
end;
$$;

comment on function public.log_document_view is
  'Call this every time a signed URL is issued for a private document. The database has no way to observe Storage access on its own — this is the API''s obligation, not something triggered automatically.';

-- ---------------------------------------------------------------------------
-- ID document retention
-- ---------------------------------------------------------------------------
-- Deletes the database row once an order is in a final state and past
-- shop_settings.id_document_retention_days. This removes the metadata row;
-- the underlying file in the private storage bucket needs deleting too
-- (either the same signed-URL-issuing service or a scheduled Edge Function —
-- deleting a Storage object is not guaranteed to happen just because this
-- table's row disappears).

create or replace function public.purge_expired_order_documents()
returns integer
language plpgsql
as $$
declare
  v_retention_days integer;
  v_count integer;
begin
  select id_document_retention_days into v_retention_days from public.shop_settings limit 1;

  with doomed as (
    delete from public.order_documents
    where uploaded_at < now() - make_interval(days => v_retention_days)
      and order_id in (select id from public.orders where status in ('collected', 'shipped', 'cancelled'))
    returning id
  )
  select count(*) into v_count from doomed;

  return v_count;
end;
$$;

comment on function public.purge_expired_order_documents is
  'Not scheduled automatically — pg_cron availability varies by project. Schedule from the Supabase dashboard or with: select cron.schedule(''purge-order-documents'', ''0 3 * * *'', ''select public.purge_expired_order_documents()'');';
