-- 0011 — Security
-- The frontend talks to its own API, never to Supabase directly. So the API
-- connects with the service role (which bypasses RLS by design) and does its
-- own permission checks with staff_can(). Everything in this file is a
-- second line of defence: if a key ever leaks, or something ends up querying
-- with the anon or authenticated role by mistake, the database still hands
-- over nothing.
--
-- Read that twice before adding a policy here later: RLS in this project is
-- not where permission logic lives. permissions.config.ts's replacement is
-- staff_can() (0002), enforced by the API. A policy added here to "make a
-- screen work" is almost certainly the wrong fix — the wrong fix is usually
-- the API not calling staff_can() before it queries, not a missing policy.

-- ---------------------------------------------------------------------------
-- Deny by default, everywhere, including things created after this file
-- ---------------------------------------------------------------------------
-- Revokes both what exists today and what future migrations create — ALTER
-- DEFAULT PRIVILEGES applies to objects that don't exist yet. A table added
-- in a 0012 with no equivalent line here still starts from zero, not from
-- whatever Postgres/Supabase's own defaults happen to be.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grant the service role what it needs to actually work
-- ---------------------------------------------------------------------------
-- rolbypassrls only skips the RLS layer — it does not imply a base table
-- grant. Found by checking directly: service_role had BYPASSRLS set but no
-- SELECT grant at all on an ordinary table, which would have meant the API
-- couldn't read anything the moment it went live. Explicit, and covers
-- future tables the same way the revokes above cover future anon/
-- authenticated access.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security — every table, no policies
-- ---------------------------------------------------------------------------
-- Enabling RLS with zero policies is itself the deny-all: Postgres shows a
-- table with RLS on and no matching policy exactly nothing. FORCE extends
-- that to the table owner too, so connecting as the owner (rather than
-- service_role, which bypasses RLS by an entirely separate mechanism) still
-- sees nothing by default. No policies are added in this migration on
-- purpose — a policy is a promise that a non-service-role connection should
-- see something, and today nothing should.

-- 0001 — foundation
alter table public.reference_registry force row level security;
alter table public.reference_registry enable row level security;
alter table public.audit_log force row level security;
alter table public.audit_log enable row level security;

-- 0002 — identity
alter table public.customers force row level security;
alter table public.customers enable row level security;
alter table public.customer_addresses force row level security;
alter table public.customer_addresses enable row level security;
alter table public.staff force row level security;
alter table public.staff enable row level security;
alter table public.staff_permissions force row level security;
alter table public.staff_permissions enable row level security;
alter table public.staff_sessions force row level security;
alter table public.staff_sessions enable row level security;

-- 0003 — catalog
alter table public.suppliers force row level security;
alter table public.suppliers enable row level security;
alter table public.products force row level security;
alter table public.products enable row level security;
alter table public.product_images force row level security;
alter table public.product_images enable row level security;
alter table public.promotions force row level security;
alter table public.promotions enable row level security;
alter table public.promo_tiers force row level security;
alter table public.promo_tiers enable row level security;

-- 0004 — inventory
alter table public.stock_movements force row level security;
alter table public.stock_movements enable row level security;

-- 0005 — orders
alter table public.delivery_zones force row level security;
alter table public.delivery_zones enable row level security;
alter table public.delivery_postcode_prefixes force row level security;
alter table public.delivery_postcode_prefixes enable row level security;
alter table public.delivery_rates force row level security;
alter table public.delivery_rates enable row level security;
alter table public.orders force row level security;
alter table public.orders enable row level security;
alter table public.order_lines force row level security;
alter table public.order_lines enable row level security;
alter table public.order_documents force row level security;
alter table public.order_documents enable row level security;

-- 0006 — repairs
alter table public.devices force row level security;
alter table public.devices enable row level security;
alter table public.repair_types force row level security;
alter table public.repair_types enable row level security;
alter table public.repair_part_tiers force row level security;
alter table public.repair_part_tiers enable row level security;
alter table public.repair_enquiries force row level security;
alter table public.repair_enquiries enable row level security;
alter table public.bookings force row level security;
alter table public.bookings enable row level security;
alter table public.jobs force row level security;
alter table public.jobs enable row level security;
alter table public.job_parts force row level security;
alter table public.job_parts enable row level security;
alter table public.job_payments force row level security;
alter table public.job_payments enable row level security;

-- 0007 — sell / trade-in
alter table public.sell_requests force row level security;
alter table public.sell_requests enable row level security;
alter table public.sell_request_photos force row level security;
alter table public.sell_request_photos enable row level security;
alter table public.sell_request_acceptance_tokens force row level security;
alter table public.sell_request_acceptance_tokens enable row level security;
alter table public.trade_in_payouts force row level security;
alter table public.trade_in_payouts enable row level security;

-- 0008 — till
alter table public.sales force row level security;
alter table public.sales enable row level security;
alter table public.sale_lines force row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_payments force row level security;
alter table public.sale_payments enable row level security;
alter table public.refunds force row level security;
alter table public.refunds enable row level security;
alter table public.refund_lines force row level security;
alter table public.refund_lines enable row level security;
alter table public.cash_entries force row level security;
alter table public.cash_entries enable row level security;
alter table public.day_close force row level security;
alter table public.day_close enable row level security;

-- 0009 — settings, labels, documents
alter table public.shop_settings force row level security;
alter table public.shop_settings enable row level security;
alter table public.label_templates force row level security;
alter table public.label_templates enable row level security;
alter table public.documents force row level security;
alter table public.documents enable row level security;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Four buckets. Three are private with no policies — same deny-all-by-
-- omission logic as the tables above, since storage.objects already ships
-- with RLS enabled by Supabase. Product images are the one deliberate
-- exception: they're customer-facing photos on the storefront, and proxying
-- every image byte through the API would be wasteful for no security benefit
-- — there is nothing private about a case photo. This is the only public-read
-- policy in the entire file; everything else stays at zero.

insert into storage.buckets (id, name, public)
values
  ('id-documents',        'id-documents',        false),
  ('buy-in-forms',        'buy-in-forms',         false),
  ('sell-request-photos', 'sell-request-photos',  false),
  ('product-images',      'product-images',       true)
on conflict (id) do nothing;

-- CREATE POLICY requires ownership of the table it's attached to.
-- storage.objects is owned by Supabase's internal storage role, not by the
-- connection this migration normally runs as (confirmed by trying to apply
-- this file directly: every other statement here succeeded, this one alone
-- failed with "must be owner of relation objects"). The Supabase CLI's own
-- migration pipeline runs with a role that does have this, so `supabase db
-- push` should apply it cleanly — but a plain Postgres connection to the
-- project (exactly what a generic `postgres` role connection is) will not.
-- Wrapped so that difference surfaces as a NOTICE instead of aborting every
-- other statement in this file, which is not a difference anyone should be
-- able to miss.
do $$
begin
  create policy "product images are public to read"
    on storage.objects for select
    using (bucket_id = 'product-images');

  comment on policy "product images are public to read" on storage.objects is
    'The one deliberate exception to deny-by-default in this file. Every other bucket, and every other operation on this one, has no policy at all.';
exception
  when insufficient_privilege then
    raise notice 'Skipped: product-images storage policy needs storage.objects ownership, which this connection does not have. Apply via the Supabase CLI/dashboard, which runs with a role that has it — see supabase/tests/README.md.';
end;
$$;

-- No insert/update/delete policy for product-images either — uploads go
-- through the API's service-role connection, which bypasses RLS. A public
-- bucket means public reads, not public writes.
