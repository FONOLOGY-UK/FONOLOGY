-- 0073 — Analytics: refunds actually net into revenue and cost, not just the ledger
-- ---------------------------------------------------------------------------
-- Red-team finding #6d (MEDIUM, confirmed — with a nuance worth stating
-- precisely, because the surface-level claim ("refunds are filtered out
-- entirely") isn't quite what the source actually does).
--
-- WHAT WAS ALREADY CORRECT
-- public.transactions (0010, redefined 0013) already includes refunds as a
-- fifth, always-negative source — 0010's own top comment says so
-- explicitly: "omitting them would silently inflate every revenue figure
-- below by the full amount ever refunded". That part of the design was
-- right from the start.
--
-- WHAT WAS ACTUALLY BROKEN
-- Every aggregate that READS transactions for a revenue/profit figure —
-- analytics_totals(), analytics_series() (0017's version) — filters
-- `where amount > 0` before summing. That filter exists to exclude
-- trade-in payouts (also negative, never revenue — 0010's comment on that
-- branch is explicit: "Always negative already... no sign-flipping needed
-- here"), but a refund row is ALSO negative, so the same filter throws it
-- straight back out. The ledger includes refunds; analytics_totals'
-- revenue/profit/margin figures do not — the two disagree with each other,
-- which is exactly the class of bug 0010 itself was written to prevent
-- ("two screens can never disagree about what a number means").
--
-- Fixed by filtering on `stream <> 'trade-in'` instead of `amount > 0` in
-- both functions: still excludes trade-in payouts (unchanged from before),
-- now includes a refund's negative amount in the same stream (shop/repair)
-- its original sale/order/job belonged to.
--
-- busiest_times() is DELIBERATELY NOT changed here, even though it has the
-- same `where amount > 0` shape — it counts sale_count for footfall/
-- staffing, a different question ("when do people come in and buy things")
-- than revenue, and counting a refund being processed as footfall would
-- answer that question wrong in the other direction. Out of scope for this
-- fix on purpose.
--
-- THE SECOND HALF: COST, NOT JUST REVENUE
-- transactions' refunds branch has always hardcoded `0 as cost`. Revenue
-- reversing without cost reversing overstates margin on every restocked
-- return — the money is gone AND the item is back on the shelf (no longer
-- sold), but the original sale's cost figure stays counted as if it were
-- still sold. Only RESTOCKED lines get a cost credit — an item refunded but
-- NOT restocked (damaged, written off) genuinely did cost the shop that
-- unit permanently, so its cost correctly stays counted, matching how
-- create_refund()/stock_receive() already treat restock as the dividing
-- line for whether inventory actually came back.
--
-- The credited cost is the ORIGINAL sale/order/job's cost_price/unit_cost
-- for that product/variant — sale_lines.cost_price, order_lines.cost_price
-- and job_parts.unit_cost are all snapshots taken at the time of the
-- original transaction (this schema's own established pattern — see
-- sale_lines' column comment, 0008), not today's possibly-different
-- products.cost_price — so a return nets out against the actual cost that
-- was actually counted when the sale first happened. Matched by
-- product_id/variant_id the same way 0070's restock-validation join does,
-- for the same reason: that is the real source of truth for what a line
-- actually cost when it was sold.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only, per the standing
-- hard rule.

create or replace view public.transactions as

with job_running as (
  select
    jp.id, jp.at, jp.job_id, jp.amount, jp.tender, jp.staff_id,
    sum(jp.amount) over (partition by jp.job_id order by jp.at, jp.id) as cum_through
  from public.job_payments jp
),

-- New in 0073: cost to credit back per refund, summed across only its
-- RESTOCKED lines, matched to whichever source line (sale_lines/
-- order_lines/job_parts) the refund's product/variant actually came from.
refund_restock_cost as (
  select
    rl.refund_id,
    sum(
      rl.quantity * coalesce(
        (
          select sl.cost_price
          from public.sale_lines sl
          where sl.sale_id = r.sale_id
            and sl.product_id = rl.product_id
            and sl.variant_id is not distinct from rl.variant_id
          order by sl.created_at
          limit 1
        ),
        (
          select ol.cost_price
          from public.order_lines ol
          where ol.order_id = r.order_id
            and ol.product_id = rl.product_id
            and ol.variant_id is not distinct from rl.variant_id
          order by ol.created_at
          limit 1
        ),
        (
          select jp.unit_cost
          from public.job_parts jp
          where jp.job_id = r.job_id
            and jp.product_id = rl.product_id
          order by jp.added_at
          limit 1
        ),
        0
      )
    ) as cost
  from public.refund_lines rl
  join public.refunds r on r.id = rl.refund_id
  where rl.restocked
  group by rl.refund_id
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

  -- The branch that actually changed in 0073: cost is no longer hardcoded
  -- zero — a restocked line credits back what that product/variant
  -- actually cost on the ORIGINAL sale/order/job, negative, matching the
  -- (already-negative) amount so profit nets to zero on a fully-restocked
  -- return. A refund with nothing restocked (or restocked but matched to
  -- nothing — e.g. the product was deleted since) still correctly gets 0
  -- cost, same as before: the shop genuinely still absorbed that cost.
  select
    r.id,
    r.created_at as at,
    case when r.job_id is not null then 'repair' else 'shop' end::text as stream,
    coalesce(s.reference, o.reference, jb.reference, 'NO-RECEIPT') as reference,
    (-r.amount)::integer as amount,
    (-coalesce(rrc.cost, 0))::integer as cost,
    r.refund_tender::text as tender,
    r.staff_id
  from public.refunds r
  left join public.sales s on s.id = r.sale_id
  left join public.orders o on o.id = r.order_id
  left join public.jobs jb on jb.id = r.job_id
  left join refund_restock_cost rrc on rrc.refund_id = r.id;

comment on view public.transactions is
  'The one ledger every report reads. amount > 0 for revenue, amount < 0 for money out (refunds, trade-in payouts) — filter on stream <> ''trade-in'' wherever "revenue" or "profit" is the question (NOT amount > 0, which also throws out refunds — see 0073), and on amount > 0 specifically where the question is genuinely about positive sale events (busiest_times''s footfall count, deliberately unchanged). Since 0073: a refund''s cost is negative for whatever was actually restocked, matched to that line''s ORIGINAL sale/order/job cost snapshot — zero cost for anything not restocked, which the shop still genuinely absorbed.';

-- ---------------------------------------------------------------------------
-- analytics_totals(): stream <> 'trade-in', not amount > 0
-- ---------------------------------------------------------------------------
-- Same signature (p_from date, p_to date) returns (revenue, cost, profit,
-- margin) — only the WHERE clause changes, so a plain CREATE OR REPLACE is
-- safe (no parameter-list or RETURNS-shape change, no overload risk).

create or replace function public.analytics_totals(p_from date, p_to date)
returns table (revenue pence, cost pence, profit pence, margin numeric)
language sql
stable
as $$
  select
    coalesce(sum(amount), 0)::integer as revenue,
    coalesce(sum(cost), 0)::integer as cost,
    coalesce(sum(amount) - sum(cost), 0)::integer as profit,
    case when sum(amount) > 0
         then round((sum(amount) - sum(cost))::numeric / sum(amount), 4)
         else 0
    end as margin
  from public.transactions
  where stream <> 'trade-in'
    and public.shop_day(at) between p_from and p_to;
$$;

comment on function public.analytics_totals is
  'Revenue/cost/profit/margin for a date range. Filters stream <> ''trade-in'' (0073) — NOT amount > 0, which would also discard every refund''s negative revenue and cost, overstating both. Trade-in payouts are the one source genuinely excluded from revenue entirely.';

-- ---------------------------------------------------------------------------
-- analytics_series(): same fix, same reasoning, in the daily/monthly buckets
-- ---------------------------------------------------------------------------
-- 0017's own comment already establishes create-or-replace is safe here
-- (RETURNS TABLE column list, not the parameter list) — still true; this
-- changes neither.

create or replace function public.analytics_series(p_from date, p_to date)
returns table (
  bucket_date date,
  bucket_label text,
  revenue pence,
  cost pence,
  shop_revenue pence,
  repair_revenue pence
)
language plpgsql
stable
as $$
declare
  v_daily boolean := (p_to - p_from) <= 62;
begin
  return query
  select
    b.bucket_date,
    to_char(b.bucket_date, case when v_daily then 'DD Mon' else 'Mon YYYY' end) as bucket_label,
    sum(b.amount)::integer::pence as revenue,
    sum(b.cost)::integer::pence as cost,
    sum(b.amount) filter (where b.stream = 'shop')::integer::pence as shop_revenue,
    sum(b.amount) filter (where b.stream = 'repair')::integer::pence as repair_revenue
  from (
    select
      case when v_daily
           then public.shop_day(t.at)
           else date_trunc('month', public.shop_day(t.at))::date
      end as bucket_date,
      t.amount,
      t.cost,
      t.stream
    from public.transactions t
    where t.stream <> 'trade-in'
      and public.shop_day(t.at) between p_from and p_to
  ) b
  group by b.bucket_date
  order by b.bucket_date;
end;
$$;

comment on function public.analytics_series(date, date) is
  'Daily buckets for ranges <= 62 days, monthly beyond — revenue split by stream (shop/repair). Trade-in payouts are excluded (stream <> ''trade-in'' filter, 0073 — was amount > 0, which also wrongly excluded refunds). shop_revenue/repair_revenue net refunds against their own original stream automatically, since transactions already assigns refund rows the same stream their sale/order/job had.';
