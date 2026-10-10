-- 0070 — create_refund(): validate restock lines against what was actually sold
-- ---------------------------------------------------------------------------
-- Red-team finding #1 (CRITICAL, independently confirmed against the real
-- function on dev before this was written). create_refund() has always
-- capped the MONEY side of a refund — v_already_refunded + p_amount can
-- never exceed the sale/order/job's original total (0008, carried through
-- 0013/0061). It has never capped the INVENTORY side: a line with
-- restock: true calls stock_receive() for whatever product_id/variant_id/
-- quantity the caller sent, with no check that product was ever part of
-- THIS sale/order/job, and no check against how much of it was actually
-- sold. A caller (a compromised staff session, or a bug upstream of this
-- function) could name any product in the catalogue on a refund_line and
-- call stock_receive() for arbitrary quantity, repeatedly — free stock,
-- unconnected to any real return, with nothing in this function to notice.
--
-- THIS BUILDS ON 0069, NOT AROUND IT
-- 0069 (readiness-audit Group 3 — the Stripe refund integration) already
-- changed this function's signature once, adding p_stripe_refund_id/
-- p_stripe_refund_status. This migration follows the exact same discipline
-- on top of THAT signature — confirmed against 0069's actual body (read
-- fresh from this file, not assumed) before writing the DROP below — and
-- adds no new parameters of its own. The Stripe fields and the restock
-- validation are independent concerns living in the same function; nothing
-- here touches p_stripe_refund_id/p_stripe_refund_status or the ordering
-- pos.routes.ts already relies on (Stripe called first, this function
-- second) — they pass through completely unchanged.
--
-- THE NEW CHECK, PER LINE, ONLY WHEN restock = true
-- (A non-restocking line has no inventory effect either way — same as
-- before, stock_receive is only ever called when restock is true and a
-- product_id is actually given.)
--
--   1. THE PRODUCT WAS ACTUALLY PART OF THIS SALE/ORDER/JOB.
--      Summed straight off the real source-of-truth line table for
--      whichever of p_sale_id/p_order_id/p_job_id is set — sale_lines,
--      order_lines, or job_parts respectively — matched on product_id AND
--      variant_id (job_parts has no variant_id column; jobs don't carry
--      product variants, so that table is matched on product_id alone).
--      Zero rows sold of that product/variant on this sale/order/job means
--      the line names something that was never actually sold here, and the
--      refund is rejected outright.
--
--   2. CUMULATIVE RESTOCKED QUANTITY, ACROSS EVERY PRIOR REFUND AGAINST
--      THE SAME SALE/ORDER/JOB, NEVER EXCEEDS WHAT WAS SOLD.
--      Summed from refund_lines joined to refunds, filtered to restocked
--      lines against the same sale/order/job and the same product/variant.
--      A partial return followed later by a second partial return of the
--      same line is the normal case this is meant to allow — it only
--      rejects the point where the running total would restock MORE units
--      than were ever sold of that specific product/variant here.
--
-- Both checks raise an exception in the same style as the existing
-- amount-overrun check just above them — the whole refund is refused, not
-- partially applied; a plpgsql function body is one implicit transaction,
-- so nothing from earlier in the same call is left half-written either way.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only, per the standing
-- hard rule.

drop function if exists public.create_refund(
  uuid, pence, tender_method, text, jsonb, uuid, uuid, uuid, tender_method, boolean, uuid, text, text
);

create or replace function public.create_refund(
  p_staff_id       uuid,
  p_amount         pence,
  p_refund_tender  tender_method,
  p_reason         text,
  p_lines          jsonb default '[]'::jsonb,   -- [{"product_id","variant_id"?,"name","quantity","unit_price","restock"}]
  p_sale_id        uuid default null,
  p_order_id       uuid default null,
  p_job_id         uuid default null,
  p_original_tender tender_method default null,
  p_outside_window boolean default false,
  p_window_override_by uuid default null,
  p_stripe_refund_id     text default null,
  p_stripe_refund_status text default null
)
returns uuid
language plpgsql
as $$
declare
  v_refund_id uuid;
  v_line jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_restock boolean;
  v_original_total pence;
  v_already_refunded pence;
  v_sold_qty integer;
  v_already_restocked integer;
begin
  if (case when p_sale_id is not null then 1 else 0 end)
   + (case when p_order_id is not null then 1 else 0 end)
   + (case when p_job_id is not null then 1 else 0 end) <> 1 then
    raise exception 'A refund must reference exactly one of a sale, an order, or a job';
  end if;

  if p_sale_id is not null then
    select total into v_original_total from public.sales where id = p_sale_id;
    if v_original_total is null then
      raise exception 'Sale % not found', p_sale_id;
    end if;
  elsif p_order_id is not null then
    select total into v_original_total from public.orders where id = p_order_id;
    if v_original_total is null then
      raise exception 'Order % not found', p_order_id;
    end if;
  else
    if not exists (select 1 from public.jobs where id = p_job_id) then
      raise exception 'Job % not found', p_job_id;
    end if;
    select coalesce(sum(amount), 0) into v_original_total
    from public.job_payments where job_id = p_job_id;
  end if;

  select coalesce(sum(amount), 0) into v_already_refunded
  from public.refunds
  where (p_sale_id is not null and sale_id = p_sale_id)
     or (p_order_id is not null and order_id = p_order_id)
     or (p_job_id is not null and job_id = p_job_id);

  if v_already_refunded + p_amount > v_original_total then
    raise exception 'Refund amount (%) plus what has already been refunded (%) would exceed what was paid (%)',
      p_amount, v_already_refunded, v_original_total;
  end if;

  insert into public.refunds (
    sale_id, order_id, job_id, amount, original_tender, refund_tender, reason,
    outside_window, window_override_by, staff_id, stripe_refund_id, stripe_refund_status
  ) values (
    p_sale_id, p_order_id, p_job_id, p_amount, p_original_tender, p_refund_tender, p_reason,
    p_outside_window, p_window_override_by, p_staff_id, p_stripe_refund_id, p_stripe_refund_status
  )
  returning id into v_refund_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity   := (v_line ->> 'quantity')::integer;
    v_restock    := coalesce((v_line ->> 'restock')::boolean, false);

    -- New in 0070: a restock line has to name something that was actually
    -- part of THIS sale/order/job, and can't push the running restocked
    -- total past what was actually sold of it. Checked BEFORE the
    -- refund_lines insert for this line, so a rejected line writes nothing
    -- at all — same "refuse outright, don't partially apply" posture as
    -- the amount-overrun check above.
    if v_restock and v_product_id is not null then
      if p_sale_id is not null then
        select coalesce(sum(quantity), 0) into v_sold_qty
        from public.sale_lines
        where sale_id = p_sale_id
          and product_id = v_product_id
          and variant_id is not distinct from v_variant_id;
      elsif p_order_id is not null then
        select coalesce(sum(quantity), 0) into v_sold_qty
        from public.order_lines
        where order_id = p_order_id
          and product_id = v_product_id
          and variant_id is not distinct from v_variant_id;
      else
        -- job_parts carries no variant_id — repair parts aren't sold by
        -- variant — so a job restock line is matched on product_id alone.
        select coalesce(sum(quantity), 0) into v_sold_qty
        from public.job_parts
        where job_id = p_job_id
          and product_id = v_product_id;
      end if;

      if v_sold_qty = 0 then
        raise exception 'Product % was not part of this sale/order/job — cannot restock it', v_product_id;
      end if;

      select coalesce(sum(rl.quantity), 0) into v_already_restocked
      from public.refund_lines rl
      join public.refunds r on r.id = rl.refund_id
      where rl.restocked
        and rl.product_id = v_product_id
        and rl.variant_id is not distinct from v_variant_id
        and (
          (p_sale_id is not null and r.sale_id = p_sale_id)
          or (p_order_id is not null and r.order_id = p_order_id)
          or (p_job_id is not null and r.job_id = p_job_id)
        );

      if v_already_restocked + v_quantity > v_sold_qty then
        raise exception
          'Restocking % of product % would restock % in total against this sale/order/job, more than the % actually sold',
          v_quantity, v_product_id, v_already_restocked + v_quantity, v_sold_qty;
      end if;
    end if;

    insert into public.refund_lines (refund_id, product_id, variant_id, name, quantity, unit_price, restocked)
    values (
      v_refund_id,
      v_product_id,
      v_variant_id,
      v_line ->> 'name',
      v_quantity,
      (v_line ->> 'unit_price')::integer,
      v_restock
    );

    if v_restock and v_product_id is not null then
      perform public.stock_receive(
        v_product_id, v_quantity, null,
        'refund_restock', 'refund', v_refund_id, p_staff_id, null, v_variant_id
      );
    end if;
  end loop;

  return v_refund_id;
end;
$$;

comment on function public.create_refund is
  'The only way a refund should be recorded. Exactly one of p_sale_id/p_order_id/p_job_id is required. Since 0070: a restock line must name a product/variant actually present on the source sale_lines/order_lines/job_parts row, and cumulative restocked quantity for that product/variant across every refund against the same sale/order/job can never exceed what was actually sold — both checked before any write for that line. A restocked line calls stock_receive with kind refund_restock — unit_cost null. Variant-aware since 0061. Since 0069: p_stripe_refund_id/p_stripe_refund_status record a card refund already confirmed by Stripe BEFORE this function runs — see pos.routes.ts for the ordering (Stripe first, ledger second) and why.';
