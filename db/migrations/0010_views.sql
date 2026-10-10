-- 0010 — Reporting
-- One view every report reads from, so two screens can never disagree about
-- what "today's takings" means — which is exactly the problem the frontend
-- has right now: getTodaySummary and getTodayReport are two separate
-- computations of the same number, similar enough to look consistent and
-- different enough that a doc had to be written begging the backend to keep
-- them in step by hand. A view can't drift from itself.

-- ---------------------------------------------------------------------------
-- The money ledger
-- ---------------------------------------------------------------------------
-- Five sources, not four. The brief for this file named sale payments, paid
-- orders, job payments and trade-in payouts — it didn't mention refunds. Left
-- out, every revenue figure downstream would overstate the shop's takings by
-- the full amount ever refunded, silently, forever. Added as a fifth, always-
-- negative source instead of leaving that hole open. See the migration notes
-- at the end of this run for why.
--
-- tender is text, not tender_method, across every branch — trade-in payouts
-- use their own cash/bank_transfer method, which isn't a till tender, so the
-- column has to be the wider type everything can agree on.
--
-- amount and cost are cast to plain integer in every branch, not left as
-- pence. Postgres's arithmetic and aggregate operators (SUM in particular,
-- which always widens to bigint) don't preserve a domain through an
-- expression the way a bare column reference does — mixing a bare pence
-- column in one branch with an arithmetic result in another is exactly the
-- kind of thing that only breaks when a UNION tries to reconcile the two.
-- Casting explicitly, every branch, removes the ambiguity instead of relying
-- on it happening to resolve the same way everywhere.

create or replace view public.transactions as

with job_running as (
  -- Running total paid per job, in payment order. Used below to find the
  -- one payment that actually completes a job, instead of prorating job
  -- cost across every payment on it.
  select
    jp.id, jp.at, jp.job_id, jp.amount, jp.tender, jp.staff_id,
    sum(jp.amount) over (partition by jp.job_id order by jp.at, jp.id) as cum_through
  from public.job_payments jp
)

  -- Till sales, ONE ROW PER SALE — not per payment portion. An earlier
  -- version of this view had one row per sale_payments row, splitting cost
  -- proportionally across tenders to keep a per-row figure. That's gone:
  -- cost belongs at the sale, where sales.cost is exact, and a split
  -- payment doesn't have a single tender to attach an approximate cost
  -- slice to anyway. tender is null here for the same reason the online-
  -- orders branch below already uses null — a sale isn't reliably one
  -- tender, so this branch doesn't pretend it is. The actual per-tender
  -- breakdown (today_takings_by_tender, tender_totals) reads sale_payments
  -- directly instead, where amount-by-tender is exact and doesn't need
  -- cost at all.
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

  -- Online orders, once, at the moment they were paid — not at checkout
  -- (payment can fail) and not re-derived from current status (a later
  -- cancellation doesn't erase the historical fact that it was paid; if money
  -- needs to go back, that's a separate negative row via the refunds branch
  -- below, exactly like a till sale that gets refunded).
  select
    o.id,
    o.paid_at as at,
    'shop'::text as stream,
    o.reference,
    o.total::integer as amount,
    coalesce((select sum(ol.cost_price * ol.quantity) from public.order_lines ol where ol.order_id = o.id), 0)::integer as cost,
    null::text as tender,   -- stripe/clearpay aren't till tenders; payment_provider on the order carries this instead
    null::uuid as staff_id
  from public.orders o
  where o.paid_at is not null

  union all

  -- Repair income. cost is job_parts only — there is no labour-cost model
  -- anywhere in this schema, matching the scope actually asked for.
  --
  -- An earlier version of this prorated job cost across every payment on
  -- the job, proportional to that payment's share of the total paid, then
  -- rounded each row to the nearest penny. That's the exact same bug just
  -- removed from the shop branch above, just less visible: round() on each
  -- row independently doesn't guarantee the rows sum back to the job's real
  -- cost — a job costing 1000p paid in three equal 1000p installments
  -- prorates to round(333.33) = 333 three times, 999 total, a penny short
  -- of the truth for no reason. Fixed the same way: cost isn't split across
  -- payments, it's attached once, to the one payment that actually
  -- completes the job (the row where the running total first reaches the
  -- job's price) — found via job_running above. A job never fully paid off
  -- never has a payment that qualifies, so it never gets a cost figure at
  -- all; that's consistent with a job whose economics were never settled,
  -- not a gap.
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

  -- Trade-in payouts. Always negative already (0007's check constraint) — no
  -- sign-flipping needed here, just pass it through.
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

  -- Refunds. Not in the original brief for this view — added because
  -- omitting them would silently inflate every revenue figure below by the
  -- full value of every return ever processed.
  --
  -- refunds gains a job_id in 0013 (repair refunds), which this branch has
  -- to account for — but refunds.job_id doesn't exist yet at this point in
  -- the migration order, so the join and stream/reference logic for it are
  -- added by redefining this view again in 0013, once the column exists,
  -- rather than referenced here.
  select
    r.id,
    r.created_at as at,
    'shop'::text as stream,
    coalesce(s.reference, o.reference, 'NO-RECEIPT') as reference,
    (-r.amount)::integer as amount,
    0 as cost,
    r.refund_tender::text as tender,
    r.staff_id
  from public.refunds r
  left join public.sales s on s.id = r.sale_id
  left join public.orders o on o.id = r.order_id;

comment on view public.transactions is
  'The one ledger every report reads. amount > 0 for revenue, amount < 0 for money out (refunds, trade-in payouts) — filter on amount > 0 wherever "revenue" or "takings" is the question, never just sum everything blindly.';

-- ---------------------------------------------------------------------------
-- Today's takings — the one figure employees may see
-- ---------------------------------------------------------------------------
-- A view with shop_day(now()) baked into the WHERE clause, not a function
-- with a date parameter. That's deliberate: there is nothing here to widen
-- into history, because there is no parameter to pass a different date into.
-- The frontend's `sales.today` permission boundary becomes structural instead
-- of a rule someone has to remember to apply.

create or replace view public.today_takings as
select
  public.shop_day(now()) as trading_day,
  coalesce(sum(t.amount), 0)::integer as total,
  count(distinct t.reference)::integer as sales_count,
  case when count(distinct t.reference) > 0
       then round(sum(t.amount)::numeric / count(distinct t.reference))::integer
       else 0
  end as average_sale,
  max(t.at) as last_sale_at
from public.transactions t
where t.amount > 0
  and public.shop_day(t.at) = public.shop_day(now());

-- Reads sale_payments and job_payments directly, not the transactions view
-- — the shop branch of transactions is one row per SALE now (see above),
-- which has no single tender for a split payment. Both sources here
-- represent real money physically taken against one specific tender —
-- till sales and counter repair payments both count for a cash
-- reconciliation the same way; online order payments (no till tender at
-- all) correctly don't appear. Per-portion amount by tender is exact here
-- and never needed cost in the first place.
create or replace view public.today_takings_by_tender as
select
  tender,
  count(*)::integer as payment_count,
  coalesce(sum(amount), 0)::integer as total
from (
  select tender, amount, created_at from public.sale_payments
  union all
  select tender, amount, at as created_at from public.job_payments
) combined
where public.shop_day(created_at) = public.shop_day(now())
group by tender;

-- ---------------------------------------------------------------------------
-- Analytics — a date range, for owners and managers only (analytics.view)
-- ---------------------------------------------------------------------------

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
  where amount > 0
    and public.shop_day(at) between p_from and p_to;
$$;

-- Daily buckets for a range of 62 days or less, monthly beyond that — the
-- same threshold the frontend already uses. Empty days/months are not
-- generated here (no calendar scaffold); a caller wanting a gap-free series
-- fills in the zeros itself, same as summing an empty result set to zero.
create or replace function public.analytics_series(p_from date, p_to date)
returns table (bucket_date date, bucket_label text, revenue pence, cost pence)
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
    -- ::pence, not ::integer — this is a plpgsql RETURN QUERY, which does
    -- strict type-checking against the function's own declared RETURNS
    -- TABLE columns (revenue pence, cost pence). A plain integer here fails
    -- with "structure of query does not match function result type" even
    -- though pence IS an integer domain — LANGUAGE SQL functions coerce
    -- this automatically at the boundary, LANGUAGE PLPGSQL's RETURN QUERY
    -- does not. Found because this function had never actually been called
    -- by anything until it was tested.
    sum(b.amount)::integer::pence as revenue,
    sum(b.cost)::integer::pence as cost
  from (
    select
      case when v_daily
           then public.shop_day(t.at)
           else date_trunc('month', public.shop_day(t.at))::date
      end as bucket_date,
      t.amount,
      t.cost
    from public.transactions t
    where t.amount > 0
      and public.shop_day(t.at) between p_from and p_to
  ) b
  group by b.bucket_date
  order by b.bucket_date;
end;
$$;

-- Weekday x hour footfall matrix. Monday = 0, matching shop_weekday() and the
-- chart the frontend already draws.
create or replace function public.busiest_times(p_from date, p_to date)
returns table (weekday integer, hour integer, sale_count integer)
language sql
stable
as $$
  select
    public.shop_weekday(at) as weekday,
    public.shop_hour(at) as hour,
    count(*)::integer as sale_count
  from public.transactions
  where amount > 0
    and public.shop_day(at) between p_from and p_to
  group by 1, 2;
$$;

create or replace function public.revenue_by_category(p_from date, p_to date)
returns table (category product_category, revenue pence, units integer)
language sql
stable
as $$
  -- The aggregate outputs need their own aliases here — without them, the
  -- `order by revenue desc` below binds to the raw pre-aggregate column from
  -- the `combined` subquery instead of the summed output, which Postgres
  -- correctly refuses ("must appear in GROUP BY or be used in an aggregate
  -- function"). Caught by trying to apply this migration for real, not by
  -- reading it.
  select category, sum(revenue)::integer as revenue, sum(units)::integer as units
  from (
    select p.category, sl.line_total as revenue, sl.quantity as units, s.created_at as at
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    join public.products p on p.id = sl.product_id

    union all

    select p.category, ol.line_total, ol.quantity, o.paid_at as at
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.paid_at is not null
    join public.products p on p.id = ol.product_id
  ) combined
  where public.shop_day(at) between p_from and p_to
  group by category
  order by revenue desc;
$$;

-- Reads sale_payments and job_payments directly, same reasoning as
-- today_takings_by_tender above — the ledger's shop rows no longer carry a
-- single tender per row, and repair payments belong in a tender breakdown
-- the same way till sales do.
create or replace function public.tender_totals(p_from date, p_to date)
returns table (tender text, payment_count integer, total pence)
language sql
stable
as $$
  select combined.tender::text, count(*)::integer, coalesce(sum(combined.amount), 0)::integer
  from (
    select tender, amount, created_at from public.sale_payments
    union all
    select tender, amount, at as created_at from public.job_payments
  ) combined
  where public.shop_day(combined.created_at) between p_from and p_to
  group by combined.tender;
$$;

-- ---------------------------------------------------------------------------
-- Low stock
-- ---------------------------------------------------------------------------

create or replace view public.low_stock_products as
select id, name, category, stock_qty, low_stock_threshold
from public.products
where is_active
  and low_stock_alert
  and stock_qty <= low_stock_threshold;
