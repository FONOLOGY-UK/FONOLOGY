-- 0014 — Relax the delivery-address CHECK to match what checkout actually collects
-- Found building B3 (checkout/orders): orders_delivery_address_present requires
-- address_line1 AND city AND postcode for any non-collect order. The real
-- checkout form (apps/web OrderInput) only ever collects ONE free-text address
-- line plus a separate postcode — there is no distinct city field anywhere in
-- the frontend contract, and inventing one by parsing the address blob would be
-- guessing at data that was never actually captured. Postcode alone is what
-- resolves the delivery zone (delivery_zone_for) and is standard-sufficient for
-- UK courier labels; address_line1 carries whatever the customer typed,
-- including any city name they included. city stays a real, nullable column —
-- useful if a future structured-address form fills it in — just no longer
-- required to place an order today.
--
-- Applied to the DEV project only. Not applied to production as part of this
-- phase — deliberately, per the standing hard rule that production only ever
-- changes through a reviewed, deliberate promotion, not silently alongside
-- application work.

alter table public.orders
  drop constraint orders_delivery_address_present;

alter table public.orders
  add constraint orders_delivery_address_present check (
    delivery_method = 'collect'
    or (address_line1 is not null and postcode is not null)
  );
