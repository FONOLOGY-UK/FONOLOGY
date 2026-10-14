-- 0117 — An IMEI on every mobile phone variation (VPS testing report, FON-007).
--
-- A handset's IMEI identifies one physical phone, so it is stored on the variation itself (the
-- products.imei column of 0092 is for a single trade-in handset). The API requires it for every
-- variation of a mobile-phone product (a product in the Mobiles category or one under it) and leaves
-- every other product alone, so the column stays NULL for accessories.
--
-- One live variation per IMEI: the same handset cannot be listed twice. Removed variations (soft
-- delete, removed_at set) free their IMEI.
alter table public.product_variants add column imei text;

alter table public.product_variants
  add constraint product_variants_imei_digits check (imei is null or imei ~ '^[0-9]{15}$');

create unique index product_variants_live_imei_idx
  on public.product_variants (imei)
  where imei is not null and removed_at is null;

comment on column public.product_variants.imei is
  'The handset''s 15-digit IMEI. Required by the API for variations of mobile-phone products; staff-only, never sent to the storefront.';
