-- 0063 — Client decision #15: unlock the stock count, remove
-- weighted-average cost
--
-- Was: apply_stock_movement() blended an incoming cost with whatever was
-- already on the shelf (10 @ 400p + 10 @ 500p = 20 @ 450p). Client decision:
-- strip that out. An inbound movement with a unit cost now sets cost_price
-- DIRECTLY to that value — "the currently-entered cost price applies to the
-- whole stock volume" — never blended with history. Outbound movements
-- (sales, consumption) are untouched either way; they never carried a cost
-- and still don't.
--
-- WHAT THIS BREAKS AND WHAT IT BECOMES (full list, from the plan given
-- before building this):
--
--   1. Margin/profit figures (Reports, Overview dashboard) — NOT removed,
--      DEGRADED honestly. sale_lines.cost_price / order_lines.cost_price are
--      snapshotted at time of sale either way (this was already true, see
--      0008/0061's own comments) — a past sale's margin is exactly as
--      accurate as it always was. What changes is what "current cost_price"
--      MEANS going forward: it's now "whatever was last typed", not a true
--      weighted average of what was actually paid across every delivery.
--      Reports keep reading the same column and computing the same maths —
--      nothing to remove — the number is just blunter than before. No UI
--      change needed; this is a data-meaning change, not a broken feature.
--
--   2. The below-cost prompt at the till — UNCHANGED, still fully correct.
--      complete_sale()'s below_cost check compares the sale price against
--      cost_price at time of sale — cost_price still means "what this unit
--      currently costs", it just gets there by direct entry now instead of
--      a rolling average. The prompt still fires exactly when it should.
--
--   3. stock_movements audit trail — KEPT, per the explicit instruction.
--      Every stock change is still a real row: a typed-in stock increase
--      still writes a 'receipt' movement (with the entered cost as
--      unit_cost — now applied directly, not blended); a typed-in decrease
--      still writes a 'correction' movement with a reason. Till sales,
--      refunds, repair parts — every existing movement path is completely
--      unchanged. Only the COST MATH inside the trigger changed; the ledger
--      itself, and everything that reads it, did not.
--
--   4. stock_status_for()'s "restocking" status (keys off a 'receipt' in
--      the last 30 days) — UNCHANGED AND STILL WORKS, because the unlocked
--      stock-count field writes a 'receipt' movement when the count goes
--      UP (see admin.routes.ts) — a bulk stock-count increase IS a receipt,
--      semantically, so "restocking" keeps firing correctly for exactly the
--      case it's meant to catch. A decrease writes a 'correction' instead
--      (matching stock_movements_reason_required's own existing rule that
--      a correction must carry a reason) and correctly does NOT trigger
--      "restocking" — a stocktake correction downward isn't new stock
--      coming in.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

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

    -- No more weighted average (0063): an inbound movement with a unit
    -- cost sets cost_price to exactly that value, whatever was on the
    -- shelf before. No incoming cost (a sale, a refund restock, a repair
    -- part) leaves cost_price exactly as it was.
    v_new_cost := case when new.qty_delta > 0 and new.unit_cost is not null
                    then new.unit_cost
                    else v_cost_before
                  end;

    update public.product_variants
       set stock_qty  = stock_qty + new.qty_delta,
           cost_price = v_new_cost,
           updated_at = now()
     where id = new.variant_id;

    return new;
  end if;

  select stock_qty, cost_price
    into v_qty_before, v_cost_before
    from public.products
   where id = new.product_id
     for update;

  if not found then
    raise exception 'Product % does not exist', new.product_id;
  end if;

  v_new_cost := case when new.qty_delta > 0 and new.unit_cost is not null
                  then new.unit_cost
                  else v_cost_before
                end;

  update public.products
     set stock_qty  = stock_qty + new.qty_delta,
         cost_price = v_new_cost,
         updated_at = now()
   where id = new.product_id;

  return new;
end;
$$;

comment on function public.apply_stock_movement is
  'Applies a stock movement and sets cost_price directly from the movement''s own unit_cost on any inbound movement (0063 — client decision #15, weighted-average cost removed). Outbound movements never touch cost_price. Two branches (variant_id present or not), same mechanism in each, unchanged since 0060 apart from the cost math.';
