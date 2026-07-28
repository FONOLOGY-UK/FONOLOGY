-- 0016 — Today's takings, computed server-side, impossible to widen
-- Found building B4 (the till): there is no clean way to filter by
-- shop_day(created_at) = shop_day(now()) through the Supabase JS query
-- builder — shop_day() is a functional/expression comparison, and hand-
-- rolling the UK/BST day-boundary math in application code is exactly the
-- kind of timezone bug this project has already been careful to avoid (see
-- 0001_foundation.sql's own comment on why shop_day exists at all). These
-- two read-only functions take NO parameters — there is nothing a caller
-- can pass to see yesterday, a range, or history; the day is always
-- shop_day(now()), decided fresh, server-side, on every call.
--
-- Applied to the DEV project only, per the standing hard rule.

create or replace function public.pos_today_summary()
returns table (total pence, sales_count integer)
language sql
stable
as $$
  select coalesce(sum(s.total), 0)::integer, count(*)::integer
  from public.sales s
  where public.shop_day(s.created_at) = public.shop_day(now());
$$;

comment on function public.pos_today_summary is
  'Today''s sales total + count, for the employee sales.today permission. No parameters — cannot be pointed at any other day.';

create or replace function public.pos_today_report()
returns jsonb
language sql
stable
as $$
  with today_sales as (
    select s.id, s.reference, s.total, s.created_at,
           (select count(*) from public.sale_lines sl where sl.sale_id = s.id) as item_count
    from public.sales s
    where public.shop_day(s.created_at) = public.shop_day(now())
  ),
  tender_agg as (
    select sp.tender, count(*)::integer as cnt, sum(sp.amount)::integer as tot
    from public.sale_payments sp
    join today_sales ts on ts.id = sp.sale_id
    group by sp.tender
  )
  select jsonb_build_object(
    'date', public.shop_day(now()),
    'total', coalesce((select sum(total) from today_sales), 0),
    'salesCount', (select count(*) from today_sales),
    'averageSale', case when (select count(*) from today_sales) > 0
                        then round((select sum(total) from today_sales)::numeric / (select count(*) from today_sales))
                        else 0 end,
    'lastSaleAt', (select max(created_at) from today_sales),
    'byTender', coalesce(
      (select jsonb_agg(jsonb_build_object('tender', tender, 'count', cnt, 'total', tot)) from tender_agg),
      '[]'::jsonb
    ),
    'sales', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'reference', ts.reference,
            'at', ts.created_at,
            'total', ts.total,
            'tenders', (
              select coalesce(jsonb_agg(sp.tender order by sp.created_at), '[]'::jsonb)
              from public.sale_payments sp where sp.sale_id = ts.id
            ),
            'description', 'POS sale — ' || ts.item_count || ' item' || case when ts.item_count = 1 then '' else 's' end
          )
          order by ts.created_at desc
        )
        from today_sales ts
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.pos_today_report is
  'The employee day panel (sales.today) — today only, no parameters, no history, no cost/margin. Mirrors TodayReport exactly.';
