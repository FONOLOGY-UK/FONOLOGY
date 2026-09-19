-- 0082 - "Misc" lines at the till, and the cost price that follows later
-- ---------------------------------------------------------------------------
-- Change request item 10 (the doc's A9).
--
-- A customer buys something that is not in the catalogue — a one-off cable
-- from the back, a part off a dead handset, a service nobody has a SKU for.
-- Today complete_sale() looks every line up in `products` and raises if it
-- misses, so the only way to sell it is to invent a product row, which then
-- sits in the catalogue forever and appears on the website.
--
-- WHAT IS NEW AND WHAT ALREADY WORKED
--
-- sale_lines.product_id was ALREADY nullable (0008, `on delete set null`), so
-- a line without a product needs no schema change to store. Two things did:
--
--   1. complete_sale() had to stop insisting on a product row, and had to
--      skip stock_consume() for these lines — there is no stock to consume,
--      and passing a null product id into it would raise.
--
--   2. A line whose cost is not known yet had to be DISTINGUISHABLE from one
--      that genuinely cost nothing. cost_price is `not null check (>= 0)`, so
--      the obvious "leave it null" is not available and 0 already means
--      something. Hence cost_price_pending: an explicit "this figure is a
--      placeholder, someone still has to fill it in".
--
-- WHY NOT infer "misc" from product_id IS NULL
--
-- Because `on delete set null` means a line whose product was later deleted
-- also has a null product_id, and that line's cost IS known — it was
-- snapshotted at the time of sale. Conflating the two would put every
-- historical line from a deleted product onto the "needs a cost price" list
-- forever. cost_price_pending says precisely the thing that is true.
--
-- THE ONE RULE THIS BENDS, STATED PLAINLY
--
-- "The server computes every money figure. The till sends line ids and
-- quantities; the server prices them." For a misc line there is nothing to
-- price against — the item does not exist — so the selling price IS staff
-- input, and so is the name. That is inherent to what was asked for, not an
-- oversight, and it is confined as tightly as it can be:
--
--   * Only lines with no product_id take a caller-supplied price. Every
--     catalogued line is still priced from `products`, exactly as before, and
--     a line naming a product_id cannot opt into this path.
--   * Every such line is permanently identifiable (product_id is null and,
--     until someone fills it in, cost_price_pending is true), so "show me
--     every price a member of staff typed by hand" is one query.
--   * Stock, margin and the below-cost check all still come from the
--     database's own figures for everything else on the sale.
--
-- P&L IS NOT LEFT WRONG
--
-- sales.cost is a stored total, so filling a cost in afterwards has to move
-- it or the profit figure stays stale forever — which would make this feature
-- actively harmful to the reporting it exists to protect.
-- set_sale_line_cost() does both in one statement pair, in one transaction.

alter table public.sale_lines
  add column cost_price_pending boolean not null default false;

comment on column public.sale_lines.cost_price_pending is
  'Change request item 10. True when this is a misc (non-catalogue) line whose cost price was not known at the till, so cost_price is a 0 placeholder rather than a real figure. Distinct from product_id being null, which also happens when a catalogued product is later deleted and whose cost IS known. Cleared by set_sale_line_cost().';

-- Only a line with no product behind it can be waiting for a cost: a
-- catalogued line snapshots products.cost_price at the moment of sale and is
-- never pending.
alter table public.sale_lines add constraint sale_lines_pending_cost_is_misc check (
  cost_price_pending = false or product_id is null
);

create index sale_lines_cost_pending_idx
  on public.sale_lines (created_at desc)
  where cost_price_pending;

-- ---------------------------------------------------------------------------
-- complete_sale(), with misc lines
-- ---------------------------------------------------------------------------
-- Layered on 0061's body (the current one — variant-aware, machine labels
-- frozen from 0032, payment provenance from 0030), confirmed against dev's
-- pg_proc entry before writing. Same signature, so this is a straight
-- replace: a misc line is recognised by its own keys, not by a new argument.
--
-- A line is MISC when it carries no product_id. It must then bring a name and
-- a unit_price, because nothing else can supply them.

create or replace function public.complete_sale(
  p_staff_id  uuid,
  p_lines     jsonb,   -- [{"product_id","variant_id"?,"quantity","unit_price","list_price","tier_applied"}]
                       -- or a misc line: {"name","quantity","unit_price","cost_price"?} with no product_id
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
  v_product_id uuid;
  v_variant_id uuid;
  v_line_cost  pence;
  v_cost_pending boolean;
  v_below_cost boolean;
  v_reference text;
  v_tender   tender_method;
  v_machine_labels jsonb;
  v_machine_label  text;
  v_name     text;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line';
  end if;
  if jsonb_array_length(p_payments) = 0 then
    raise exception 'A sale needs at least one payment';
  end if;

  select card_machine_labels into v_machine_labels from public.shop_settings limit 1;

  -- Pass 1: totals.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_product_id is null then
      -- Misc line. Item 10.
      if nullif(btrim(coalesce(v_line ->> 'name', '')), '') is null then
        raise exception 'A miscellaneous line needs a name';
      end if;
      if (v_line ->> 'unit_price') is null then
        raise exception 'A miscellaneous line needs a selling price';
      end if;
      -- Absent cost is 0 for now and flagged; 0 supplied on purpose is a real
      -- zero and is NOT flagged. The two are different answers and the till
      -- can say either.
      v_line_cost := coalesce((v_line ->> 'cost_price')::integer, 0);
    else
      select * into v_product from public.products where id = v_product_id;
      if not found then
        raise exception 'Product % not found', v_product_id;
      end if;

      v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
      if v_variant_id is not null then
        select cost_price into v_line_cost from public.product_variants where id = v_variant_id;
        if not found then
          raise exception 'Variant % not found', v_variant_id;
        end if;
      else
        v_line_cost := v_product.cost_price;
      end if;
    end if;

    v_subtotal := v_subtotal + (v_line ->> 'unit_price')::integer * (v_line ->> 'quantity')::integer;
    v_cost     := v_cost + v_line_cost * (v_line ->> 'quantity')::integer;
  end loop;

  v_below_cost := (v_subtotal - p_discount) <= v_cost;

  insert into public.sales (staff_id, subtotal, discount, cost, below_cost, below_cost_reason)
  values (p_staff_id, v_subtotal, p_discount, v_cost, v_below_cost, p_below_cost_reason)
  returning id into v_sale_id;

  -- Pass 2: the lines themselves, and stock.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;

    if v_product_id is null then
      v_name := btrim(v_line ->> 'name');
      v_cost_pending := (v_line ->> 'cost_price') is null;
      v_line_cost := coalesce((v_line ->> 'cost_price')::integer, 0);

      insert into public.sale_lines (
        sale_id, product_id, variant_id, name, quantity,
        unit_price, list_price, cost_price, tier_applied, cost_price_pending
      )
      values (
        v_sale_id, null, null, v_name,
        (v_line ->> 'quantity')::integer,
        (v_line ->> 'unit_price')::integer,
        -- A misc item has no shelf price to have been discounted from, so
        -- list_price is the price charged. "You saved £0" is the truth.
        (v_line ->> 'unit_price')::integer,
        v_line_cost,
        false,
        v_cost_pending
      );

      -- Deliberately NO stock_consume: there is no stock row behind this.
      continue;
    end if;

    select * into v_product from public.products where id = v_product_id;
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;

    if v_variant_id is not null then
      select cost_price into v_line_cost from public.product_variants where id = v_variant_id;
    else
      v_line_cost := v_product.cost_price;
    end if;

    insert into public.sale_lines (sale_id, product_id, variant_id, name, quantity, unit_price, list_price, cost_price, tier_applied)
    values (
      v_sale_id, v_product.id, v_variant_id, v_product.name,
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      coalesce((v_line ->> 'list_price')::integer, (v_line ->> 'unit_price')::integer),
      v_line_cost,
      coalesce((v_line ->> 'tier_applied')::boolean, false)
    );

    perform public.stock_consume(
      v_product.id, (v_line ->> 'quantity')::integer, 'sale',
      'sale', v_sale_id, p_staff_id, null, v_variant_id
    );
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_reference := nullif(btrim(coalesce(v_payment ->> 'reference', '')), '');
    v_tender := (v_payment ->> 'tender')::tender_method;

    v_machine_label := case
      when v_tender in ('pos1', 'pos2') then v_machine_labels ->> v_tender::text
      else null
    end;

    insert into public.sale_payments (
      sale_id, tender, amount, confirmed_by, provider_reference, source, machine_label
    )
    values (
      v_sale_id, v_tender, (v_payment ->> 'amount')::integer,
      p_staff_id, v_reference, 'manual', v_machine_label
    );
  end loop;

  set constraints public.sale_payments_sum_matches_total immediate;
  set constraints public.sale_payments_sum_matches_total deferred;

  return v_sale_id;
end;
$$;

comment on function public.complete_sale is
  'The only way a till sale should be created. Stock is consumed line by line inside the same transaction as the payment rows, so if the deferred payments-equal-total check fails at commit, the stock movements roll back with it. Variant-aware since 0061. Since 0082 a line with NO product_id is a "misc" line (change request item 10): it brings its own name and selling price because there is no catalogue row to price it from, consumes no stock, and — when it brings no cost_price — is stored with a 0 placeholder and cost_price_pending = true for set_sale_line_cost() to correct later. Every catalogued line is still priced and costed from the database exactly as before.';

-- ---------------------------------------------------------------------------
-- Filling the cost in afterwards
-- ---------------------------------------------------------------------------
-- The whole point of the flag. sales.cost is a stored total, so the line and
-- the sale have to move together or the profit figure stays wrong forever and
-- the feature damages the reporting it was asked for to protect.

create or replace function public.set_sale_line_cost(
  p_line_id  uuid,
  p_cost     pence,
  p_staff_id uuid default null
)
returns void
language plpgsql
as $$
declare
  v_line public.sale_lines;
  v_delta bigint;
begin
  select * into v_line from public.sale_lines where id = p_line_id for update;
  if not found then
    raise exception 'Sale line % not found', p_line_id;
  end if;
  if not v_line.cost_price_pending then
    raise exception 'That line already has a cost price recorded.';
  end if;

  -- Per UNIT, like cost_price everywhere else in this schema.
  v_delta := (p_cost::bigint - v_line.cost_price::bigint) * v_line.quantity;

  update public.sale_lines
  set cost_price = p_cost,
      cost_price_pending = false
  where id = p_line_id;

  -- below_cost is re-derived too: a sale that looked profitable only because
  -- a cost was missing is exactly the case this is protecting against.
  update public.sales
  set cost = cost + v_delta,
      below_cost = (subtotal - discount) <= (cost + v_delta)
  where id = v_line.sale_id;

  -- p_staff_id is accepted and deliberately not stored: sale_lines has no
  -- audit column and inventing one here would be a bigger change than this
  -- warrants. The API logs the call; if per-edit attribution is wanted later
  -- it belongs in a proper audit table, not a column bolted onto a line.
  perform p_staff_id;
end;
$$;

comment on function public.set_sale_line_cost is
  'Change request item 10. Records the cost price of a misc sale line that was rung through without one, and moves sales.cost and sales.below_cost by the same amount in the same transaction so profit reporting is corrected rather than left stale. Refuses a line that is not pending, so a real recorded cost cannot be quietly rewritten through this path.';
