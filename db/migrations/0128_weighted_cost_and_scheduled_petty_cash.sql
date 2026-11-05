-- 0128 — Weighted average cost on receipts, and scheduled Petty Cash In (client changes v2,
-- November 2026, sections 6.1 and 6.3).
--
-- 1. WEIGHTED AVERAGE. 0063 took this out at the client's request; they have asked for it back. A
--    receipt with a unit cost now blends with what is on the shelf:
--      new cost = ((existing stock x old cost) + (incoming x incoming cost)) / (existing + incoming)
--    With nothing on the shelf that is simply the incoming cost, so one formula covers both of the
--    client's cases. Rounded to the penny. Past sales keep the cost saved on them. Typing a cost on
--    the product form still overrides it directly, as before.
--
-- 2. SCHEDULED PETTY CASH. A cash_entries row dated in the future. Nothing runs at midnight: a day's
--    petty cash is worked out when asked for (lib/pettyCash.ts), starting from £0 on a Monday and
--    adding that day's entries. So a Petty Cash In scheduled for a Monday always lands after the
--    reset, by construction.

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  v_qty_before  integer;
  v_cost_before pence;
  v_new_cost    pence;
begin
  if new.variant_id is not null then
    select stock_qty, cost_price
      into v_qty_before, v_cost_before
      from public.product_variants
     where id = new.variant_id
       for update;

    if not found then
      raise exception 'Variant % does not exist', new.variant_id;
    end if;
  else
    select stock_qty, cost_price
      into v_qty_before, v_cost_before
      from public.products
     where id = new.product_id
       for update;

    if not found then
      raise exception 'Product % does not exist', new.product_id;
    end if;
  end if;

  v_new_cost := case
    when new.qty_delta > 0 and new.unit_cost is not null and new.kind = 'receipt' then
      round(
        (v_qty_before::numeric * v_cost_before + new.qty_delta::numeric * new.unit_cost)
        / (v_qty_before + new.qty_delta)
      )::integer
    when new.qty_delta > 0 and new.unit_cost is not null then new.unit_cost
    else v_cost_before
  end;

  if new.variant_id is not null then
    update public.product_variants
       set stock_qty  = stock_qty + new.qty_delta,
           cost_price = v_new_cost,
           updated_at = now()
     where id = new.variant_id;
  else
    update public.products
       set stock_qty  = stock_qty + new.qty_delta,
           cost_price = v_new_cost,
           updated_at = now()
     where id = new.product_id;
  end if;

  return new;
end;
$$;

comment on function public.apply_stock_movement is
  'Applies a stock movement. A receipt with a unit cost sets cost_price to the weighted average of what was on the shelf and what came in (0128, reversing 0063). Outbound movements never touch cost_price.';

alter table public.cash_entries
  add column scheduled boolean not null default false;

comment on column public.cash_entries.scheduled is
  'Booked ahead for trading_day by an admin (0128). Can be cancelled until that day arrives.';

create index cash_entries_scheduled_idx on public.cash_entries (shop_id, trading_day) where scheduled;
