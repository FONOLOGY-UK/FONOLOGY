-- 0017 — analytics_series, split by stream (shop vs repair)
-- Found building B6: the frontend's RevenuePoint wants each bucket broken
-- into `shop` and `repair` figures (a stacked chart), but analytics_series()
-- only ever returned one combined revenue number per bucket. The hard rule
-- this phase — "the UI never sums raw rows; the database does" — means this
-- split has to happen in the function, not by fetching two queries and
-- subtracting in TypeScript. `transactions.stream` already carries exactly
-- this distinction (shop/repair/trade-in — trade-in is money out and never
-- counted as revenue here, unchanged from before).
--
-- create or replace works cleanly here (same signature, only the RETURNS
-- TABLE column list changed by ADDING columns) — no overload conflict like
-- the p_phone/p_job_id cases, since this is the RETURNS shape, not the
-- parameter list.
--
-- Applied to the DEV project only, per the standing hard rule.

drop function if exists public.analytics_series(date, date);

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
    where t.amount > 0
      and public.shop_day(t.at) between p_from and p_to
  ) b
  group by b.bucket_date
  order by b.bucket_date;
end;
$$;

comment on function public.analytics_series(date, date) is
  'Daily buckets for ranges <= 62 days, monthly beyond — revenue split by stream (shop/repair) so the UI never has to derive it. Trade-in payouts are excluded (amount > 0 filter) exactly as before.';
