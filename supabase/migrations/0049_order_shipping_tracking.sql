-- 0049 — shipped orders need a courier and tracking number
--
-- THE BUG (found in QA regression testing, item 10 / BUG-12 follow-up)
-- `POST /orders/id/:id/status {"status":"shipped"}` accepted the transition
-- with nothing else — no tracking number, no courier, not even a way to
-- record one. A customer's order could be marked shipped with the shop
-- itself having no record of how it actually went out.
--
-- THE FIX
-- Two nullable columns. Nullable because every OTHER status (collect orders
-- especially — 'ready'/'collected' never touches a courier at all) has no
-- courier or tracking number and never will; NOT NULL here would be wrong
-- for most rows, not just early ones. The real rule — both required the
-- moment an order actually moves to 'shipped' — is enforced in the API
-- (orders.routes.ts), the same place delivery-fee and payment-status rules
-- already live, not as a CHECK constraint: a CHECK can't see "was this
-- request's status the string 'shipped'", only the row's own columns after
-- the fact, and status and tracking arrive in the same request.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

alter table public.orders
  add column courier text,
  add column tracking_number text;

comment on column public.orders.courier is
  'Who the parcel actually went out with (e.g. "Royal Mail", "DPD"). Required by the API the moment status moves to shipped — null before then, and for collect orders always.';
comment on column public.orders.tracking_number is
  'The courier''s own tracking reference. Required alongside courier for the shipped transition — see the note on that column.';
