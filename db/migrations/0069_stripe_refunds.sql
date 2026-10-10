-- 0069 — Stripe refund integration: where the actual Stripe-side refund gets
-- recorded against the internal ledger row
-- ---------------------------------------------------------------------------
-- Readiness-audit Group 3. Until now `POST /pos/refunds` only ever wrote to
-- `refunds` via create_refund() — nothing in this codebase ever called
-- Stripe's refund API. `apps/api/src/routes/pos.routes.ts` now does, for
-- card-tender refunds on an online order specifically (till sales are never
-- Stripe — see 0030's comment: both card machines are manual-entry, no
-- reader was ever bought). This migration adds the two columns that let one
-- `refunds` row carry both halves of that fact: what Stripe's own refund
-- object is called, and what its last-known status was.
--
-- WHY BOTH AN ID AND A STATUS COLUMN
-- Some refund methods settle asynchronously on Stripe's side — a card
-- refund is usually immediate, but a few payment methods take days and can
-- still fail after the initial call reported success. `stripe_refund_id` is
-- written once, at creation, from `stripe.refunds.create()`'s own response.
-- `stripe_refund_status` is written then AND updated later by the
-- `refund.updated` webhook handler added alongside this migration — so a
-- refund that Stripe marks failed after the fact doesn't sit forever
-- looking identical to one that actually completed.
--
-- WHY NO UNIQUE CONSTRAINT ON stripe_refund_id
-- The idempotency key passed to Stripe (order + amount + reason + staff,
-- hashed) means a genuine network retry or double-click reuses the same
-- Stripe refund and is safe by construction. But it also means two
-- DELIBERATE, textually-identical partial refunds on the same order (rare,
-- but not impossible) would collide on that same idempotency key and Stripe
-- would hand back the SAME refund object for both. A unique constraint here
-- would then make the second create_refund() call fail outright, which
-- would misfire the "money moved, ledger didn't" alarm the API raises on a
-- genuine post-Stripe write failure — for a case where nothing is actually
-- wrong. Left as a plain (non-unique) index for the webhook's own lookup;
-- see the API-side comment on the idempotency key for the full trade-off.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only, per the standing
-- hard rule.

alter table public.refunds
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_refund_status text
    check (stripe_refund_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'));

create index if not exists refunds_stripe_refund_id_idx
  on public.refunds (stripe_refund_id)
  where stripe_refund_id is not null;

comment on column public.refunds.stripe_refund_id is
  'Stripe''s own refund id (re_...), set only for card-tender refunds on an online order — null for every till/cash/goodwill refund, which never touch Stripe. Written once from stripe.refunds.create()''s response, after Stripe has actually confirmed the refund and before create_refund() runs — see pos.routes.ts.';
comment on column public.refunds.stripe_refund_status is
  'Stripe''s refund.status as of the last time this app heard about it — set at creation, kept current by the refund.updated webhook handler for refund methods that settle asynchronously. Null for every non-Stripe refund.';

-- ---------------------------------------------------------------------------
-- create_refund(): two new optional trailing params
-- ---------------------------------------------------------------------------
-- Same discipline as every prior signature change to this function (0013,
-- 0061): explicit DROP of the exact current signature first, because
-- CREATE OR REPLACE with an added parameter creates a second overload
-- instead of replacing the first, and an unqualified call from the API
-- (positional-free, but still resolved by arity/types under the hood)
-- becomes ambiguous. Confirmed against 0061_variant_aware_money_functions.sql
-- as the current body before writing this — not the older 0013/0008 one.
--
-- Both new params default to null, so every existing call site (till
-- refunds, job-deposit refunds, cash refunds — none of which touch Stripe)
-- keeps working completely untouched.

drop function if exists public.create_refund(
  uuid, pence, tender_method, text, jsonb, uuid, uuid, uuid, tender_method, boolean, uuid
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
  v_variant_id uuid;
  v_original_total pence;
  v_already_refunded pence;
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

    insert into public.refund_lines (refund_id, product_id, variant_id, name, quantity, unit_price, restocked)
    values (
      v_refund_id,
      nullif(v_line ->> 'product_id', '')::uuid,
      v_variant_id,
      v_line ->> 'name',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      coalesce((v_line ->> 'restock')::boolean, false)
    );

    if coalesce((v_line ->> 'restock')::boolean, false)
       and (v_line ->> 'product_id') is not null and (v_line ->> 'product_id') <> '' then
      perform public.stock_receive(
        (v_line ->> 'product_id')::uuid, (v_line ->> 'quantity')::integer, null,
        'refund_restock', 'refund', v_refund_id, p_staff_id, null, v_variant_id
      );
    end if;
  end loop;

  return v_refund_id;
end;
$$;

comment on function public.create_refund is
  'The only way a refund should be recorded. Exactly one of p_sale_id/p_order_id/p_job_id is required. A restocked line calls stock_receive with kind refund_restock — unit_cost null. Variant-aware since 0061. Since 0069: p_stripe_refund_id/p_stripe_refund_status record a card refund already confirmed by Stripe BEFORE this function runs — see pos.routes.ts for the ordering (Stripe first, ledger second) and why.';
