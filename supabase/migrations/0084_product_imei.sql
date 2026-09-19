-- 0084 - IMEI on a bought-in handset, never shown to a customer
-- ---------------------------------------------------------------------------
-- Change request item 11 (the doc's A10).
--
-- SCOPE, WHICH WAS THE OPEN QUESTION
--
-- The doc says "adding a phone to inventory", and there is no "phone" in this
-- catalogue: product_kind is only ('accessory','vape','plate') and is DERIVED
-- from category_id by derive_product_kind() (0064), with Kind deliberately
-- removed from the admin form because the category IS the classification.
-- Phones live in `devices`, which is a repair/sell-in catalogue and not
-- sellable stock.
--
-- Confirmed scope: the trade-in restock path. restock_trade_in() already
-- creates a real product row for a handset the shop has bought in, and that
-- row is the only "phone in inventory" this system has ever had. This adds
-- the IMEI to it. Not a new product kind, not a phone-specific category, not
-- a field on every case and vape.
--
-- WHY THE COLUMN IS ON products AND NOT ON trade_in_payouts
--
-- The IMEI identifies the HANDSET, which is what the product row represents
-- and what is eventually sold. A payout is a money record. Putting it on the
-- payout would mean the thing on the shelf could not answer "which handset is
-- this", which is the entire question an IMEI exists for — and a second-hand
-- phone's IMEI is what a police request or a blacklist check is about.
--
-- NULLABLE AND UNCONSTRAINED IN FORMAT
--
-- Most products are not phones and will never have one. No CHECK on length or
-- Luhn: a staff member reading a number off a battery bay under a counter
-- light gets it wrong sometimes, and a constraint that refuses the save means
-- the number ends up in a notes field or nowhere. A 15-digit format hint on
-- the form is the right place for that, not a constraint that loses the data.
--
-- NOT UNIQUE, deliberately. A returned-then-resold handset legitimately comes
-- back through as a second product row, and a unique index would refuse the
-- restock at the counter with no way forward.
--
-- HOW "NEVER DISPLAYED TO CUSTOMERS" IS ACTUALLY ENFORCED
--
-- Not by remembering. The public product responses in apps/api select their
-- columns BY NAME and imei is not among them, exactly the pattern
-- buildShelfLabel already relies on for cost and stock. The protection is
-- that the value is never loaded on a public path, not that some renderer
-- remembers to skip it. The one public read that used `select *` is narrowed
-- in the same change.

alter table public.products add column imei text;

comment on column public.products.imei is
  'Change request item 11. The handset identifier for a phone bought in through the trade-in flow and put on the shelf. NULL for everything that is not a phone, which is almost everything. Deliberately unconstrained in format (a mistyped IMEI recorded is worth more than a correct one refused) and deliberately NOT unique (a handset returned and resold is legitimately a second row). STAFF-ONLY: no public product response selects this column, and that is the enforcement — it is never loaded on a customer-facing path, rather than being loaded and then skipped.';

-- Finding a handset by its IMEI is the whole reason to store it — a police
-- request, a warranty claim, a customer asking whether their old phone is
-- still in the shop. Partial, because almost every row is null.
create index products_imei_idx on public.products (imei) where imei is not null;

-- ---------------------------------------------------------------------------
-- restock_trade_in() takes an IMEI
-- ---------------------------------------------------------------------------
-- Layered on 0045's body (the current one — p_category_id uuid, not the
-- original product_category enum), confirmed before writing.
--
-- DROP first, exactly as 0045 had to, and NOT `create or replace`.
--
-- The first version of this migration used `create or replace` on the
-- reasoning that a new parameter added at the END with a default leaves the
-- existing call signature resolving fine. That is wrong, and it failed on
-- the first real run: Postgres treats the ARGUMENT LIST as part of a
-- function's identity, so adding a parameter — defaulted or not — creates a
-- second overload rather than replacing anything. The file aborted on its
-- own `comment on function` with "function name is not unique", and had it
-- somehow got past that it would have left two overloads behind, making
-- every existing six-argument call ambiguous and failing at the counter.
--
-- Dropping by full signature and recreating is the only thing that actually
-- replaces a function whose parameter list is changing.

drop function if exists public.restock_trade_in(uuid, text, uuid, pence, product_kind, uuid);

create function public.restock_trade_in(
  p_payout_id     uuid,
  p_name          text,
  p_category_id   uuid,
  p_resale_price  pence,
  p_kind          product_kind default 'accessory',
  p_staff_id      uuid default null,
  p_imei          text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payout    public.trade_in_payouts;
  v_unit_cost pence;
  v_product_id uuid;
  v_slug      text;
  v_imei      text;
begin
  select * into v_payout from public.trade_in_payouts where id = p_payout_id;
  if not found then
    raise exception 'Trade-in payout % not found', p_payout_id;
  end if;
  if v_payout.restocked then
    raise exception 'Payout % has already been restocked', p_payout_id;
  end if;

  v_unit_cost := -v_payout.amount;
  v_slug := public.slugify(p_name) || '-' || p_payout_id::text;

  -- Spaces and dashes stripped: an IMEI is written on boxes and screens in
  -- half a dozen groupings, and a lookup that only matches the grouping
  -- somebody happened to type is a lookup that does not work. Empty becomes
  -- null so "" and "no IMEI" are not two different states.
  v_imei := nullif(regexp_replace(coalesce(p_imei, ''), '[^0-9A-Za-z]', '', 'g'), '');

  insert into public.products (slug, name, kind, category_id, price, cost_price, stock_qty, imei)
  values (v_slug, p_name, p_kind, p_category_id, p_resale_price, v_unit_cost, 0, v_imei)
  returning id into v_product_id;

  perform public.stock_receive(
    v_product_id, 1, v_unit_cost, 'buy_in',
    'trade_in_payout', p_payout_id, p_staff_id
  );

  update public.trade_in_payouts
     set restocked = true, resale_price = p_resale_price, restocked_product_id = v_product_id
   where id = p_payout_id;

  return v_product_id;
end;
$$;

comment on function public.restock_trade_in is
  'The only way a trade-in becomes sellable stock. One call, one product, one buy_in movement at what the shop actually paid. Refuses to run twice on the same payout. Since 0084 it also records the handset IMEI (change request item 11), normalised to digits and letters only so a lookup is not defeated by whichever spacing the number was written in.';
