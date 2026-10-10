-- 0059 — Link repair bookings to a customer account (Round 5 Phase 3 #22)
--
-- `orders.customer_id` (0005) has always existed — a logged-in customer's
-- checkout already attributes the order to their account. `bookings`
-- (0006) never got the same column: a mail-in repair booking is pure
-- contact-details, with no way to know it belongs to a signed-in customer
-- even when one placed it. That is the actual gap behind the "repair
-- history" half of the account dashboard — there is nothing to query.
--
-- Nullable, `on delete set null` — identical shape to `orders.customer_id`
-- — because a booking is placed the same way an order is: no account
-- required (BUSINESS RULE, apps/web/src/lib/data/types/auth.ts). A guest
-- booking simply has `customer_id is null`, same as a guest order.
alter table public.bookings
  add column customer_id uuid references public.customers (id) on delete set null;

create index bookings_customer_idx on public.bookings (customer_id) where customer_id is not null;
