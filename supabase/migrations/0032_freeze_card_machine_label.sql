-- 0032 — Freeze the card machine's name onto each payment at the moment it's taken
-- ---------------------------------------------------------------------------
-- 0030 deliberately resolved pos1/pos2 → machine name from shop_settings at
-- READ time, on the reasoning that the label is display metadata and freezing
-- it risked making tender and provider contradict each other.
--
-- Overturned here, on request, for one reason: reconciliation is inherently
-- historical. If pos2 ever stops being the Dojo PAX A920 (the shop has
-- already changed provider once), resolving live would relabel every past
-- Dojo payment as whatever replaced it — and matching a June statement
-- against June's payments is exactly the job this column exists for. This
-- schema already chose snapshot-over-recompute for the same reason in 0024
-- (day_close's own comment: a reconstructed breakdown "could disagree with
-- the expected_amount sitting beside it"). Same shape of problem, same
-- answer.
--
-- The integrity risk 0030 flagged is real but solvable: the value is derived
-- SERVER-SIDE from shop_settings at the moment complete_sale() inserts the
-- row — never client-supplied, never a second independent claim sitting next
-- to tender. It is a timestamped snapshot of what pos1/pos2 meant that day,
-- the same relationship a repair's frozen part cost has to today's price
-- list, not an independent fact that could drift from tender and contradict
-- it.
--
-- Cash and transfer legs get NULL — there is no machine to name.

alter table public.sale_payments
  add column machine_label text;

comment on column public.sale_payments.machine_label is
  'The card machine''s display name (shop_settings.card_machine_labels), frozen at the moment this leg was confirmed — NOT resolved live. Null for cash/transfer, which have no machine. Frozen so a later provider change (the shop has done this once already) cannot silently relabel historical payments — see 0032.';

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
  v_tender   tender_method;
  v_machine_labels jsonb;
  v_machine_label  text;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line';
  end if;
  if jsonb_array_length(p_payments) = 0 then
    raise exception 'A sale needs at least one payment';
  end if;

  -- Read once, outside the payments loop — one settings lookup per sale, not
  -- per leg, and every leg in the same sale freezes the same snapshot.
  select card_machine_labels into v_machine_labels from public.shop_settings limit 1;

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
    v_reference := nullif(btrim(coalesce(v_payment ->> 'reference', '')), '');
    v_tender := (v_payment ->> 'tender')::tender_method;

    -- Only pos1/pos2 ever have a machine. ->> on a missing jsonb key returns
    -- NULL cleanly, so an unconfigured settings row degrades to NULL rather
    -- than raising.
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
  'The only way a till sale should be created. Stock is consumed line by line inside the same transaction as the payment rows, so if the deferred payments-equal-total check fails at commit, the stock movements roll back with it — nothing is left half-applied. Each payment may carry an optional "reference" (the card machine''s slip reference); every leg records who confirmed it, that the confirmation was manual, and (for pos1/pos2) the machine''s name FROZEN at that moment (0032) — never re-resolved from current settings.';
