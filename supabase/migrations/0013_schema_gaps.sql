-- 0013 — Closing the gaps found in review
-- Additive, on top of an already-tested 0001-0011 (plus 0012's enum value).
-- Each section below closes exactly one gap from that review; see
-- supabase/tests/ for the failing-case/valid-case pair that proves it.

-- =============================================================================
-- 1a. Repair refunds: a third link, and "exactly one" instead of "at most two"
-- =============================================================================
-- refunds could previously carry sale_id, order_id, both null (goodwill, no
-- receipt) or — nothing stopped it — both at once. Neither of those is right
-- once a refund can also point at a job: a refund should be traceable to
-- exactly one thing it's refunding. That does mean a link-less "goodwill,
-- no receipt" refund is no longer representable — deliberate, not an
-- oversight; see supabase/migrations/README.md for why.

alter table public.refunds
  add column job_id uuid references public.jobs (id);

create index refunds_job_idx on public.refunds (job_id) where job_id is not null;

alter table public.refunds
  add constraint refunds_exactly_one_link check (
    (case when sale_id is not null then 1 else 0 end)
  + (case when order_id is not null then 1 else 0 end)
  + (case when job_id  is not null then 1 else 0 end) = 1
  );

comment on column public.refunds.job_id is
  'A repair deposit or balance being returned — a cancelled or abandoned job with money already taken. Exactly one of sale_id/order_id/job_id is set (refunds_exactly_one_link); there is no more link-less "goodwill" refund.';

-- create_refund's parameter list is changing shape (p_job_id inserted in the
-- middle), which CREATE OR REPLACE treats as a different function, not a
-- replacement of the old one — the old ten-argument version would otherwise
-- sit alongside the new eleven-argument one forever, and any unqualified
-- reference to public.create_refund (including the COMMENT ON FUNCTION
-- below) becomes ambiguous between them.
drop function if exists public.create_refund(uuid, pence, tender_method, text, jsonb, uuid, uuid, tender_method, boolean, uuid);

create or replace function public.create_refund(
  p_staff_id       uuid,
  p_amount         pence,
  p_refund_tender  tender_method,
  p_reason         text,
  p_lines          jsonb default '[]'::jsonb,   -- [{"product_id","name","quantity","unit_price","restock"}]
  p_sale_id        uuid default null,
  p_order_id       uuid default null,
  p_job_id         uuid default null,
  p_original_tender tender_method default null,
  p_outside_window boolean default false,
  p_window_override_by uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_refund_id uuid;
  v_line jsonb;
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
    -- What was actually paid on the job — deposits and balances together, the
    -- same "cap at what was paid" rule sales and orders already get. A job
    -- with no payments at all caps at zero, same as any other refund target.
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
    outside_window, window_override_by, staff_id
  ) values (
    p_sale_id, p_order_id, p_job_id, p_amount, p_original_tender, p_refund_tender, p_reason,
    p_outside_window, p_window_override_by, p_staff_id
  )
  returning id into v_refund_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.refund_lines (refund_id, product_id, name, quantity, unit_price, restocked)
    values (
      v_refund_id,
      nullif(v_line ->> 'product_id', '')::uuid,
      v_line ->> 'name',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      coalesce((v_line ->> 'restock')::boolean, false)
    );

    if coalesce((v_line ->> 'restock')::boolean, false)
       and (v_line ->> 'product_id') is not null and (v_line ->> 'product_id') <> '' then
      perform public.stock_receive(
        (v_line ->> 'product_id')::uuid, (v_line ->> 'quantity')::integer, null,
        'refund_restock', 'refund', v_refund_id, p_staff_id
      );
    end if;
  end loop;

  return v_refund_id;
end;
$$;

comment on function public.create_refund is
  'The only way a refund should be recorded. Exactly one of p_sale_id/p_order_id/p_job_id is required. A restocked line calls stock_receive with kind refund_restock — unit_cost is left null (the weighted-average cost is unaffected by goods coming back at the price they were sold, not the price they were bought).';

-- =============================================================================
-- 1b. Jobs can be abandoned
-- =============================================================================
-- 'cancelled' itself was added in 0012 (its own transaction, required before
-- it can appear in a CHECK or a case branch here). Reachable from new,
-- in_progress or waiting_approval only — not from done, sent_back or
-- collected, which are already finished, and not a second time from
-- cancelled itself.

alter table public.jobs
  add column cancellation_reason text,
  -- true = shop still has the device, false = it's back with the customer or
  -- courier, null = not applicable (job isn't cancelled). Every cancelled
  -- job may record this; a mail-in cancellation must, because the shop is
  -- physically holding someone's phone and "cancelled" can't also mean
  -- "and nobody knows where the device is".
  add column device_returned boolean;

alter table public.jobs
  add constraint jobs_cancelled_requires_reason check (
    status <> 'cancelled' or (cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
  );

alter table public.jobs
  add constraint jobs_cancelled_mail_in_resolves_device check (
    status <> 'cancelled' or source <> 'mail_in' or device_returned is not null
  );

create or replace function public.job_status_allowed_next(p_status job_status)
returns job_status[]
language sql
immutable
as $$
  select case p_status
    when 'new'              then array['in_progress', 'cancelled']::job_status[]
    when 'in_progress'      then array['waiting_approval', 'done', 'cancelled']::job_status[]
    when 'waiting_approval' then array['in_progress', 'cancelled']::job_status[]
    when 'done'             then array['sent_back', 'collected']::job_status[]
    else array[]::job_status[]
  end;
$$;

comment on function public.job_status_allowed_next is
  'cancelled is reachable from new, in_progress and waiting_approval — not from done, sent_back or collected, which are already finished, matching jobs_cancelled_requires_reason and jobs_cancelled_mail_in_resolves_device on the table itself. Any deposit already taken is returned through create_refund(p_job_id => ...), not through this table.';

-- =============================================================================
-- 4. Money can only move in the right direction
-- =============================================================================
-- Everything already forbidding negative amounts (refunds.amount > 0,
-- job_payments.amount > 0, sale_payments.amount > 0, cash_entries.amount > 0,
-- trade_in_payouts.amount < 0, every price/subtotal/fee >= 0) was already a
-- CHECK constraint from 0003-0009 — see supabase/tests/014_money_direction.sql
-- for the full sweep and which side of the line each column falls on. What
-- follows are the columns the sweep found with no check at all.

-- A discount that meets or exceeds the subtotal isn't a discount, it's a
-- silent zero — GREATEST(...,0) on the generated total already stopped the
-- number going negative, but it was doing that by quietly absorbing an
-- over-large discount rather than refusing it. Capped at the subtotal, not
-- subtotal+delivery_fee, on purpose: a discount takes something off the
-- goods, not off the cost of getting them there.
alter table public.sales  add constraint sales_discount_not_over_subtotal  check (discount <= subtotal);
alter table public.orders add constraint orders_discount_not_over_subtotal check (discount <= subtotal);

-- A negative repair price, quote, resale price or till-count is never valid
-- — these were simply never given a floor.
alter table public.repair_types
  add constraint repair_types_base_prices_not_negative check (
    (base_price_original is null or base_price_original >= 0)
    and (base_price_oem is null or base_price_oem >= 0)
    and (base_price_copy is null or base_price_copy >= 0)
  );

alter table public.jobs
  add constraint jobs_quoted_price_not_negative check (quoted_price is null or quoted_price >= 0),
  add constraint jobs_revised_quote_not_negative check (revised_quote is null or revised_quote >= 0);

alter table public.sell_requests
  add constraint sell_requests_quoted_amount_not_negative check (quoted_amount is null or quoted_amount >= 0);

alter table public.trade_in_payouts
  add constraint trade_in_payouts_resale_price_not_negative check (resale_price is null or resale_price >= 0);

alter table public.day_close
  add constraint day_close_expected_amount_not_negative check (expected_amount >= 0),
  add constraint day_close_counted_amount_not_negative check (counted_amount >= 0);

alter table public.shop_settings
  add constraint shop_settings_float_target_not_negative check (float_target >= 0);

-- =============================================================================
-- 5. Deleting a customer who has orders: they survive as guest-shaped
-- =============================================================================
-- orders.customer_id is ON DELETE SET NULL, but orders_guest_or_customer
-- requires customer_id or guest_email to be set — a registered customer's
-- order has neither once the customer row (and its email) is gone, unless
-- something copies the email across first. Without this, deleting a
-- customer with a non-guest order didn't leave the order "guest-shaped" —
-- it failed outright on the CHECK, which is refusal, not survival. This
-- trigger runs before the delete (and before the FK's SET NULL fires),
-- so by the time customer_id goes null the order already has an email to
-- fall back on.

create or replace function public.customers_preserve_orders_before_delete()
returns trigger
language plpgsql
as $$
begin
  update public.orders
     set guest_email = coalesce(guest_email, old.email)
   where customer_id = old.id;
  return old;
end;
$$;

create trigger customers_preserve_orders
  before delete on public.customers
  for each row execute function public.customers_preserve_orders_before_delete();

comment on trigger customers_preserve_orders on public.customers is
  'Copies the customer''s email onto their orders'' guest_email before the delete, so orders_guest_or_customer still holds once customer_id is set null by the FK. Without this, deleting a customer with a non-guest order fails on that CHECK instead of leaving the order intact.';

-- =============================================================================
-- 6. A promo tier that doesn't apply charges full price, not a broken result
-- =============================================================================
-- Nothing before this resolved "what does this quantity actually cost" —
-- complete_sale() trusts whatever unit_price the caller sends. This is the
-- one place that answers it authoritatively: the best (highest-min_qty)
-- tier that still qualifies for the quantity being bought, on an active,
-- currently-running promotion, or the shelf price if none qualifies —
-- never null, never an error, for any quantity including zero or a
-- quantity below every tier's min_qty.

create or replace function public.resolve_sale_unit_price(p_product_id uuid, p_quantity integer)
returns pence
language sql
stable
as $$
  select coalesce(
    (
      select pt.unit_price
      from public.promotions promo
      join public.promo_tiers pt on pt.promotion_id = promo.id
      where promo.product_id = p_product_id
        and promo.is_active
        and (promo.starts_at is null or promo.starts_at <= now())
        and (promo.ends_at is null or promo.ends_at > now())
        and pt.min_qty <= p_quantity
      order by pt.min_qty desc
      limit 1
    ),
    (select price from public.products where id = p_product_id)
  );
$$;

comment on function public.resolve_sale_unit_price is
  'The effective per-unit price for buying p_quantity of a product right now: the best qualifying bulk tier on an active, currently-running promotion, or the shelf price if none qualifies. Never null for a real product — a quantity below every tier''s min_qty is exactly the ordinary, non-broken case of "no tier applies".';

-- =============================================================================
-- The ledger, redefined: refunds now has a job_id
-- =============================================================================
-- Identical to 0010's public.transactions except the refunds branch, which
-- couldn't reference refunds.job_id in 0010 because that column didn't exist
-- yet. A job refund's stream is 'repair', matching the stream a job's own
-- payments already use — a repair deposit going back out is repair income
-- moving, not shop income — and its reference resolves to the job's own
-- reference instead of falling through to NO-RECEIPT.

create or replace view public.transactions as

with job_running as (
  select
    jp.id, jp.at, jp.job_id, jp.amount, jp.tender, jp.staff_id,
    sum(jp.amount) over (partition by jp.job_id order by jp.at, jp.id) as cum_through
  from public.job_payments jp
)

  select
    s.id,
    s.created_at as at,
    'shop'::text as stream,
    s.reference,
    s.total::integer as amount,
    s.cost::integer as cost,
    null::text as tender,
    s.staff_id
  from public.sales s

  union all

  select
    o.id,
    o.paid_at as at,
    'shop'::text as stream,
    o.reference,
    o.total::integer as amount,
    coalesce((select sum(ol.cost_price * ol.quantity) from public.order_lines ol where ol.order_id = o.id), 0)::integer as cost,
    null::text as tender,
    null::uuid as staff_id
  from public.orders o
  where o.paid_at is not null

  union all

  select
    jr.id,
    jr.at,
    'repair'::text as stream,
    j.reference,
    jr.amount::integer as amount,
    case
      when coalesce(j.revised_quote, j.quoted_price, 0) > 0
       and jr.cum_through >= coalesce(j.revised_quote, j.quoted_price, 0)
       and (jr.cum_through - jr.amount) < coalesce(j.revised_quote, j.quoted_price, 0)
      then coalesce((select sum(part.unit_cost * part.quantity) from public.job_parts part where part.job_id = j.id), 0)::integer
      else 0
    end as cost,
    jr.tender::text as tender,
    jr.staff_id
  from job_running jr
  join public.jobs j on j.id = jr.job_id

  union all

  select
    t.id,
    t.created_at as at,
    'trade-in'::text as stream,
    t.reference,
    t.amount::integer as amount,
    0 as cost,
    t.method as tender,
    t.staff_id
  from public.trade_in_payouts t

  union all

  -- The one branch that actually changed: job_id is now possible, so the
  -- stream and reference have to account for it.
  select
    r.id,
    r.created_at as at,
    case when r.job_id is not null then 'repair' else 'shop' end::text as stream,
    coalesce(s.reference, o.reference, jb.reference, 'NO-RECEIPT') as reference,
    (-r.amount)::integer as amount,
    0 as cost,
    r.refund_tender::text as tender,
    r.staff_id
  from public.refunds r
  left join public.sales s on s.id = r.sale_id
  left join public.orders o on o.id = r.order_id
  left join public.jobs jb on jb.id = r.job_id;

comment on view public.transactions is
  'The one ledger every report reads. amount > 0 for revenue, amount < 0 for money out (refunds, trade-in payouts) — filter on amount > 0 wherever "revenue" or "takings" is the question, never just sum everything blindly.';
