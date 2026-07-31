-- 0027 — Attach a new customer's guest orders to their account
--
-- The schema was built for this: `orders.customer_id` is nullable and
-- `orders.guest_email` holds the address a guest checked out with, so a guest
-- order can be adopted later without changing its shape.
--
-- SECURITY: this is only ever safe on an email the AUTH PROVIDER has verified.
-- Matching on a self-asserted address would let anyone register with a
-- stranger's email and inherit their order history — names, addresses,
-- postcodes, everything they have bought. So the caller is responsible for
-- establishing verification, and the API only calls this on the OAuth path,
-- where Google has confirmed the address. See apps/api/src/routes/auth.routes.ts.
--
-- Only genuinely unowned orders are adopted (`customer_id is null`). An order
-- already belonging to an account is never reassigned, so this cannot move a
-- record between customers however it is called.
--
-- Additive: new function only.

create or replace function public.link_guest_orders(
  p_customer_id uuid,
  p_email       citext
)
returns integer
language plpgsql
as $$
declare
  v_linked integer;
begin
  if p_customer_id is null or p_email is null then
    return 0;
  end if;

  -- Must be a real customer profile; never attach orders to an id that isn't one.
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'No customer profile for %', p_customer_id;
  end if;

  update public.orders
     set customer_id = p_customer_id
   where customer_id is null
     and guest_email = p_email;

  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

comment on function public.link_guest_orders(uuid, citext) is
  'Adopts unowned guest orders matching a verified email into a customer account. Only rows with customer_id IS NULL are touched, so an order can never move between accounts. CALLER MUST have verified the email with the auth provider — see 0027.';
