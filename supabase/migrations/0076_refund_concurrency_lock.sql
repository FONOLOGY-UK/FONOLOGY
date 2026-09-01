-- 0076 - Serialise concurrent refunds against the same sale/order/job
-- ---------------------------------------------------------------------------
-- Independent audit finding CRIT-03 (the locking half of it; the Stripe
-- call ordering in pos.routes.ts is deliberate and is NOT changed here).
--
-- create_refund() validates twice by reading what already exists:
--
--   1. sum(refunds.amount) for this parent, refused if adding p_amount
--      would exceed what was paid (0008, tightened by 0070);
--   2. per restock line, sum(refund_lines.quantity) already restocked,
--      refused if it would exceed what was actually sold (0070).
--
-- Both are read-then-insert with nothing serialising them. Two refunds of
-- the same sale committed concurrently each read the other's rows as
-- absent, both pass, and the sale ends up over-refunded or over-restocked
-- -- past a check that exists precisely to make that impossible. Stock is
-- the worse half: stock_receive() puts units back on the shelf that were
-- never sold.
--
-- Fix: take a row lock on the parent sale/order/job at the top, before the
-- first read. Function body is otherwise byte-identical to 0070's.
--
-- Scope of the lock: one sale/order/job. Refunds against DIFFERENT parents
-- never contend, so this costs nothing at the till in normal use -- the
-- only thing that now waits is a second refund of the SAME sale, which is
-- exactly the case that was broken.
--
-- APPLIED to the DEV project (ohkvwqqtppvnxbvvdsfr) on 2026-09-01 and verified
-- there (lock acquisition confirmed via pg_locks; over-refund and
-- over-restock both correctly refused). NOT applied to production, which
-- remains paused, per the standing hard rule.

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
  v_lock_id uuid;
begin
  if (case when p_sale_id is not null then 1 else 0 end)
   + (case when p_order_id is not null then 1 else 0 end)
   + (case when p_job_id is not null then 1 else 0 end) <> 1 then
    raise exception 'A refund must reference exactly one of a sale, an order, or a job';
  end if;

  -- `for update` is the whole point of 0076. Every check below this line
  -- (the amount-overrun check, and the per-line restock check inside the
  -- loop) is read-then-write against rows a CONCURRENT refund of the same
  -- parent is also reading. Under READ COMMITTED, two tills refunding the
  -- same sale at once both saw v_already_refunded = 0, both passed, and
  -- both inserted -- refunding twice what was actually paid.
  --
  -- Locking the PARENT (not the refunds rows) is what makes it hold: the
  -- rows being counted don't exist yet at the time of the check, so there
  -- is nothing there to lock. The second transaction blocks here until the
  -- first commits, then re-reads and correctly sees the first refund.
  if p_sale_id is not null then
    select total into v_original_total from public.sales where id = p_sale_id for update;
    if v_original_total is null then
      raise exception 'Sale % not found', p_sale_id;
    end if;
  elsif p_order_id is not null then
    select total into v_original_total from public.orders where id = p_order_id for update;
    if v_original_total is null then
      raise exception 'Order % not found', p_order_id;
    end if;
  else
    -- Locked via a select into rather than `exists(...)`, which cannot
    -- carry `for update`. v_lock_id is discarded; the lock is the product.
    select id into v_lock_id from public.jobs where id = p_job_id for update;
    if v_lock_id is null then
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
