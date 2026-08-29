-- Round 5 #17 / #12.
--
-- Three columns products.tag/compatibility/buy_in_form_path never existed.
-- apps/api/src/schemas.ts's productInputBodySchema has accepted `tag` and
-- `compatibility` in the request body since the admin form was built ("for
-- shape compliance", per its own comment, citing "the B6 report") — the
-- values were validated, then silently dropped, because there was nowhere
-- to put them. The customer-facing read path (products.routes.ts) has
-- always hardcoded `tag: null, compatibility: null` for the same reason.
-- `buy_in_form` is the identical story one field over: product-dialog.tsx
-- has required a signed buy-in form upload (when "Bought locally" is
-- ticked) since it was built, the `buy-in-forms` Storage bucket has existed
-- since 0011_security.sql, and nothing has ever linked one to the other —
-- the "upload" just produced a bare filename string with no object behind
-- it (see admin.routes.ts's own `buyInForm: null, // no column`).
--
-- `tag` stays a plain nullable string, not an enum — it's merchandising
-- copy ("Bestseller", "New in"), not a fixed set of states, matching how
-- the frontend's own Zod schema already typed it. `compatibility` likewise.
-- `buy_in_form_path` stores the Storage OBJECT PATH (never the caller's
-- filename, same reasoning as product-images), so it only means anything
-- read back through the API's own service-role client — the bucket is
-- private (`buy-in-forms`, false in storage.buckets), no public URL exists
-- for it, on purpose: a signed buy-in form can carry a supplier's name,
-- address and a signature, which is exactly the kind of thing product
-- photos (public, deliberately) are not.

alter table public.products
  add column tag                text,
  add column compatibility      text,
  add column buy_in_form_path   text;

comment on column public.products.tag is
  'Optional merchandising badge shown near the product title on the PDP, e.g. "Bestseller". Plain text, not an enum — client-editable copy, not a fixed state.';
comment on column public.products.compatibility is
  'Optional device-compatibility note shown as a list on the PDP where relevant, e.g. "iPhone 13-15". Plain text.';
comment on column public.products.buy_in_form_path is
  'Storage object path (not a public URL — buy-in-forms is a private bucket) for the signed buy-in form required when localBuying is true. Set once, on upload; the file itself is never re-processed the way product photos are.';
