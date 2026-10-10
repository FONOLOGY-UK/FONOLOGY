-- 0030 — Payment provenance: who confirmed a card payment, and off which slip
-- ---------------------------------------------------------------------------
-- Both in-store card machines are MANUAL ENTRY, and the client has signed off
-- on that flow: staff key the amount into the machine, the customer pays,
-- staff read the machine's own result, staff confirm it in our UI. Neither
-- machine drives a payment from our server, and the Stripe Terminal / WisePOS
-- plan is cancelled — no reader is being bought.
--
-- So a card leg needs to record WHO said it was paid and WHAT the machine's
-- slip said, because right now a `pos1` payment row is an unattributed
-- assertion that money arrived.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD
--
-- 1. No `provider` column. `tender` is already pos1/pos2 and pos1/pos2ARE the
--    machines, so a separate provider column would make
--    (tender='pos1', provider='dojo') representable — two contradictory
--    statements of one fact, in a money table. The tender→machine mapping
--    lives in shop_settings instead (below), where swapping a card provider
--    is an owner's settings edit rather than a migration and a deploy. The
--    shop has already changed provider once.
--
-- 2. No `confirmed_at`. In the manual flow the row is INSERTed at the moment
--    of confirmation, so it would always equal created_at. Note the reason is
--    not the one that first looks obvious: a pending leg would in fact
--    survive the deferred sum trigger, because that trigger sums `amount` and
--    never looks at confirmation state. What actually rules it out is the
--    till itself — a sale cannot be completed until every portion is
--    approved, so no unconfirmed leg is ever written. If an
--    async-confirmation flow is ever built, this column can be added then,
--    additively, with a real meaning.
--
-- 3. No payment_provider_events table. That is online-only and Stripe is
--    blocked on the client's account; building it now means guessing at the
--    shape reconciliation needs. NOTE FOR WHOEVER BUILDS IT: a raw Stripe
--    payload contains customer PII (name, email, address, card last4). This
--    schema already runs a 30-day purge for ID documents (0020); webhook
--    payloads need either the same treatment or extracted-fields-only
--    storage. Do not store raw payloads indefinitely.

alter table public.sale_payments
  -- From the session, never from the request body — same rule as every other
  -- staff attribution in this schema.
  add column confirmed_by uuid references public.staff (id),
  -- Whatever the staff member typed off the machine's receipt slip.
  -- DELIBERATELY OPTIONAL: staff under pressure will skip it, and a required
  -- field would either block a completed sale or train people to type junk.
  add column provider_reference text,
  -- 'manual' = a human read the machine and said yes. 'auto' = a provider
  -- confirmed it (a future Stripe webhook, or Dojo if API access is ever
  -- granted). Defaulted so every existing row stays valid and truthful:
  -- every payment recorded before today was manually taken at the counter.
  add column source text not null default 'manual'
    check (source in ('manual', 'auto'));

comment on column public.sale_payments.confirmed_by is
  'Staff member who confirmed this leg, from their session. Null on legs recorded before 0030, and on cash/transfer legs where there is no machine to confirm against.';
comment on column public.sale_payments.provider_reference is
  'Reference typed off the card machine''s receipt slip. Always optional — a missing reference must never block a sale.';
comment on column public.sale_payments.source is
  'How the confirmation arrived: manual (a person read the machine) or auto (a provider API/webhook). An automated confirmation writes the same row with source=auto — it does not get its own table, so the deferred exact-sum trigger still sees every leg.';

create index sale_payments_confirmed_by_idx
  on public.sale_payments (confirmed_by)
  where confirmed_by is not null;

-- ---------------------------------------------------------------------------
-- Which machine is which — settings, not schema
-- ---------------------------------------------------------------------------
-- Today pos1 is Shift4 and pos2 is a Dojo PAX A920, but that is a fact about
-- this month's contract, not about the data model. Kept in the singleton
-- shop_settings row, exactly like next_day_cutoff_time and
-- id_document_retention_days, so changing provider is an edit and not a
-- deploy.
--
-- Read at DISPLAY time. See the 0030 note in NOTES.md for the argument about
-- whether the label should instead be frozen onto each payment row for
-- historical reconciliation — that is a real consideration and is NOT settled
-- by this migration; nothing here blocks adding a frozen snapshot later.

alter table public.shop_settings
  add column if not exists card_machine_labels jsonb not null
    default '{"pos1": "Shift4", "pos2": "Dojo PAX A920"}'::jsonb;

comment on column public.shop_settings.card_machine_labels is
  'Display label per card tender, keyed by tender_method value ("pos1"/"pos2"). Reporting metadata resolved at read time; never stored on a payment row. Change this when the shop changes card provider.';

-- ---------------------------------------------------------------------------
-- complete_sale: carry provenance through, in the same transaction
-- ---------------------------------------------------------------------------
-- The provenance has to be written BY complete_sale, not patched on afterwards.
-- complete_sale inserts the legs itself, so a follow-up UPDATE would have to
-- match rows back to the caller's array — and with two legs on the same tender
-- (a bill split across POS 1 twice, or POS 1 and POS 2 at the same amount)
-- there is nothing to match on. Writing them inline keeps the association
-- exact, and keeps provenance inside the same transaction as the money.
--
-- p_payments gains one optional key per element:
--   {"tender", "amount", "reference"}
-- `reference` is what staff typed off the machine's receipt slip. Absent,
-- empty, or JSON null all mean "not given", which is a normal, supported case.
--
-- confirmed_by is the staff member completing the sale — from the session, via
-- p_staff_id, never from a request body. source is 'manual' because that is
-- what this path IS: a person read the machine and said yes. A future
-- automated confirmation writes source='auto' through its own path, into these
-- same columns.
--
-- Nothing here can affect an amount, so the deferred exact-sum trigger is
-- untouched — see test 024, which asserts exactly that with the new columns
-- populated.

create or replace function public.complete_sale(
  p_staff_id  uuid,
  p_lines     jsonb,   -- [{"product_id", "quantity", "unit_price", "list_price", "tier_applied"}]
  p_payments  jsonb,   -- [{"tender", "amount", "reference"?}]
  p_discount  pence default 0,
  p_below_cost_reason text default null
)
returns uuid
language plpgsql
as $$
declare
  v_sale_id  uuid;
  v_subtotal pence := 0;
  v_cost     pence := 0;
  v_line     jsonb;
  v_payment  jsonb;
  v_product  public.products;
  v_below_cost boolean;
  v_reference text;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line';
  end if;
  if jsonb_array_length(p_payments) = 0 then
    raise exception 'A sale needs at least one payment';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;
    v_subtotal := v_subtotal + (v_line ->> 'unit_price')::integer * (v_line ->> 'quantity')::integer;
    v_cost     := v_cost + v_product.cost_price * (v_line ->> 'quantity')::integer;
  end loop;

  v_below_cost := (v_subtotal - p_discount) <= v_cost;

  insert into public.sales (staff_id, subtotal, discount, cost, below_cost, below_cost_reason)
  values (p_staff_id, v_subtotal, p_discount, v_cost, v_below_cost, p_below_cost_reason)
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;

    insert into public.sale_lines (sale_id, product_id, name, quantity, unit_price, list_price, cost_price, tier_applied)
    values (
      v_sale_id, v_product.id, v_product.name,
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      coalesce((v_line ->> 'list_price')::integer, (v_line ->> 'unit_price')::integer),
      v_product.cost_price,
      coalesce((v_line ->> 'tier_applied')::boolean, false)
    );

    perform public.stock_consume(
      v_product.id, (v_line ->> 'quantity')::integer, 'sale',
      'sale', v_sale_id, p_staff_id
    );
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    -- Blank and whitespace-only collapse to NULL: "they left it empty" and
    -- "they typed a space" are the same fact, and an empty string masquerading
    -- as a reference is worse than an honest null.
    v_reference := nullif(btrim(coalesce(v_payment ->> 'reference', '')), '');

    insert into public.sale_payments (
      sale_id, tender, amount, confirmed_by, provider_reference, source
    )
    values (
      v_sale_id,
      (v_payment ->> 'tender')::tender_method,
      (v_payment ->> 'amount')::integer,
      p_staff_id,
      v_reference,
      'manual'
    );
  end loop;

  -- Unchanged from 0008, and the reasoning there still applies verbatim:
  -- force the deferred check to fire HERE so the caller gets the error from
  -- this call rather than from an unrelated COMMIT later, then put it straight
  -- back to deferred so a later split sale in the same transaction is still
  -- checked once rather than row by row.
  set constraints public.sale_payments_sum_matches_total immediate;
  set constraints public.sale_payments_sum_matches_total deferred;

  return v_sale_id;
end;
$$;

comment on function public.complete_sale is
  'The only way a till sale should be created. Stock is consumed line by line inside the same transaction as the payment rows, so if the deferred payments-equal-total check fails at commit, the stock movements roll back with it — nothing is left half-applied. Each payment may carry an optional "reference" (the card machine''s slip reference); every leg records who confirmed it and that the confirmation was manual.';

-- ---------------------------------------------------------------------------
-- create_order: stop orders.payment_provider being null on every single order
-- ---------------------------------------------------------------------------
-- orders.payment_provider and orders.provider_reference were added in 0005
-- and have NEVER been written by anything — verified by grep across the whole
-- repo. The API's checkout schema even accepts a paymentMethod and then
-- silently discards it, because create_order was never given anywhere to put
-- it. That is a plain data bug, independent of any payment integration.
--
-- provider_reference is deliberately NOT a parameter here: at create time the
-- order is `pending` and no provider has issued a reference yet. It is filled
-- in when payment is actually confirmed.
--
-- The parameter is appended last with a default, so every existing call site
-- keeps working untouched. Signature changes shape, so the old one is dropped
-- explicitly — CREATE OR REPLACE would otherwise leave two overloads and make
-- an unqualified reference ambiguous (the same trap 0013 hit with
-- create_refund).

drop function if exists public.create_order(
  jsonb, delivery_method, uuid, citext, text, text, text, text, text, text, pence, text
);

create or replace function public.create_order(
  p_lines           jsonb,
  p_delivery_method delivery_method,
  p_customer_id     uuid default null,
  p_guest_email     citext default null,
  p_recipient_name  text default null,
  p_address_line1   text default null,
  p_address_line2   text default null,
  p_city            text default null,
  p_county          text default null,
  p_postcode        text default null,
  p_discount        pence default 0,
  p_phone           text default null,
  p_payment_provider text default null
)
returns uuid
language plpgsql
as $$
declare
  v_order_id     uuid;
  v_line         jsonb;
  v_product      public.products;
  v_subtotal     pence := 0;
  v_zone_id      uuid;
  v_delivery_fee pence := 0;
  v_zone_code    text;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one line';
  end if;

  -- The orders.payment_provider CHECK already restricts the value; failing
  -- here instead gives a readable message rather than a raw constraint error
  -- surfacing at the checkout screen.
  if p_payment_provider is not null and p_payment_provider not in ('stripe', 'clearpay') then
    raise exception 'Unknown payment provider %', p_payment_provider;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;
    if not public.product_is_purchasable_online(v_product.id) then
      raise exception 'Product % cannot be sold online', v_product.id;
    end if;
    v_subtotal := v_subtotal + v_product.price * (v_line ->> 'quantity')::integer;
  end loop;

  select q.delivery_fee, q.zone_code
    into v_delivery_fee, v_zone_code
    from public.delivery_quote(p_lines, p_delivery_method, p_postcode) q;

  if p_delivery_method <> 'collect' then
    select id into v_zone_id from public.delivery_zones where code = v_zone_code;
  end if;

  insert into public.orders (
    customer_id, guest_email, delivery_method, delivery_zone_id,
    recipient_name, address_line1, address_line2, city, county, postcode, phone,
    subtotal, delivery_fee, discount, payment_provider
  ) values (
    p_customer_id, p_guest_email, p_delivery_method, v_zone_id,
    p_recipient_name, p_address_line1, p_address_line2, p_city, p_county, p_postcode, p_phone,
    v_subtotal, v_delivery_fee, p_discount, p_payment_provider
  )
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    insert into public.order_lines (order_id, product_id, name, unit_price, cost_price, quantity)
    values (
      v_order_id, v_product.id, v_product.name, v_product.price, v_product.cost_price,
      (v_line ->> 'quantity')::integer
    );
  end loop;

  return v_order_id;
end;
$$;

comment on function public.create_order(jsonb, delivery_method, uuid, citext, text, text, text, text, text, text, pence, text, text) is
  'The only way an order should be created. Computes subtotal, zone and delivery fee from the lines actually inserted — nothing is trusted from the caller. p_payment_provider records which provider the customer chose; provider_reference is filled in later, when payment is confirmed.';
