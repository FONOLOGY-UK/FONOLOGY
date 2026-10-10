-- 0084 - The end-of-day report the till prints
-- ---------------------------------------------------------------------------
-- Change request item 7, and the data half of item 13.
--
-- WHY THIS EXTENDS pos_today_report() INSTEAD OF ADDING A THIRD THING
--
-- There were already two different "how did today go" surfaces, and the risk
-- with this request was building a third:
--
--   POST/GET /pos/day-close  a LOCKING, blind-count cash reconciliation.
--                            Admin-only, cash.manage, one per day, with a
--                            shortfall threshold. Ends the day.
--   GET /pos/today/report    a non-locking summary, already on the POS shell
--                            as "My day".
--
-- The doc is explicit that "End Day" must NOT lock the till, that staff can
-- keep selling afterwards, and that printing it again later must produce an
-- updated version. That is the second one exactly — it is a report, not a
-- close. So this adds nothing new to the pipeline: it fills the gaps in the
-- report that already exists, and the print button reads the same function
-- the panel on screen already reads. The panel and the paper cannot disagree,
-- because there is one source.
--
-- WHAT THE DOC ASKED FOR THAT WAS MISSING
--
--   total sales            already there (total, salesCount)
--   total items sold       NEW - itemsSold
--   total jobs completed   NEW - jobsCompleted
--   a COMPLETE breakdown   byTender was sale_payments only. See below.
--   of all payment methods
--
-- byTender NOW INCLUDES REPAIR MONEY, AND THAT IS A FIX, NOT A FEATURE
--
-- record_job_payment() writes to job_payments and creates no sale and no
-- sale_payments row. A cash repair deposit is money physically in the drawer
-- that the old byTender could not see. This is the same bug 0031 fixed in the
-- day-close expected-cash calculation, and 0010's today_takings_by_tender
-- view has always got it right ("counter repair payments count for a cash
-- reconciliation the same way"). The report was the last place still
-- disagreeing. A printed "complete breakdown of all payment methods" that
-- silently omits every repair deposit would be worse than not printing one.
--
-- salesByTender is kept alongside it, so nothing loses the ability to ask the
-- narrower question, and so the change is additive rather than a redefinition
-- nobody can see.
--
-- ONLINE ORDERS ARE NOT IN byTender, DELIBERATELY. Stripe and Clearpay are
-- not till tenders — no money entered this drawer — and 0010's own view makes
-- the same call. "Online Transfers" in the doc means the `transfer` tender: a
-- bank transfer taken at the counter, which IS in job_payments/sale_payments
-- and so IS counted.
--
-- jobsCompleted IS AN APPROXIMATION, AND SAYS SO
--
-- Nothing in this schema timestamps a status change; there is no job status
-- history table. updated_at is the only signal available, so a job counts as
-- completed today if it is in a finished state AND was last touched today. A
-- job collected yesterday and edited today would be counted again. The honest
-- alternatives were a status-history table (out of scope for a printed
-- summary) or omitting the figure the doc explicitly asked for. The report's
-- own wording on paper hedges it rather than presenting it as exact.
--
-- 'id' ON EACH SALE is for item 13 — same-day receipt reprinting needs
-- something to reprint FROM, and the list was reference-only. A reference is
-- not an id and the print enqueue takes an entity id.

create or replace function public.pos_today_report()
returns jsonb
language sql
stable
as $$
  with today_sales as (
    select s.id, s.reference, s.total, s.created_at,
           (select count(*) from public.sale_lines sl where sl.sale_id = s.id) as item_count,
           (select coalesce(sum(sl.quantity), 0) from public.sale_lines sl where sl.sale_id = s.id) as unit_count
    from public.sales s
    where public.shop_day(s.created_at) = public.shop_day(now())
  ),
  sales_tender_agg as (
    select sp.tender, count(*)::integer as cnt, sum(sp.amount)::integer as tot
    from public.sale_payments sp
    join today_sales ts on ts.id = sp.sale_id
    group by sp.tender
  ),
  -- Everything that went through the till today, whichever door it came in
  -- by. Same union as today_takings_by_tender (0010), computed here so the
  -- report is one function call rather than a function plus a view read.
  all_tender_agg as (
    select tender, count(*)::integer as cnt, sum(amount)::integer as tot
    from (
      select sp.tender, sp.amount, sp.created_at
      from public.sale_payments sp
      union all
      select jp.tender, jp.amount, jp.at as created_at
      from public.job_payments jp
    ) combined
    where public.shop_day(created_at) = public.shop_day(now())
    group by tender
  )
  select jsonb_build_object(
    'date', public.shop_day(now()),
    'total', coalesce((select sum(total) from today_sales), 0),
    'salesCount', (select count(*) from today_sales),
    'averageSale', case when (select count(*) from today_sales) > 0
                        then round((select sum(total) from today_sales)::numeric / (select count(*) from today_sales))
                        else 0 end,
    'lastSaleAt', (select max(created_at) from today_sales),

    -- Item 7: units, not lines. Three of the same case on one line is three
    -- items sold, and "total items sold" on a day sheet means units.
    'itemsSold', coalesce((select sum(unit_count) from today_sales), 0),

    -- Item 7. See the approximation note above.
    'jobsCompleted', (
      select count(*)
      from public.jobs j
      where j.status in ('collected', 'sent_back')
        and public.shop_day(j.updated_at) = public.shop_day(now())
    ),

    -- Item 7: repair money taken at the counter today, called out on its own
    -- because it is the part that used to be invisible here.
    'repairTakings', coalesce((
      select sum(jp.amount)::integer
      from public.job_payments jp
      where public.shop_day(jp.at) = public.shop_day(now())
    ), 0),

    -- Item 7: every payment method, sales AND repairs. The one the paper
    -- prints.
    'byTender', coalesce(
      (select jsonb_agg(jsonb_build_object('tender', tender, 'count', cnt, 'total', tot) order by tot desc)
       from all_tender_agg),
      '[]'::jsonb
    ),

    -- The narrower shop-only split, kept so nothing loses the ability to ask.
    'salesByTender', coalesce(
      (select jsonb_agg(jsonb_build_object('tender', tender, 'count', cnt, 'total', tot) order by tot desc)
       from sales_tender_agg),
      '[]'::jsonb
    ),

    'sales', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            -- Item 13: what a reprint is enqueued against.
            'id', ts.id,
            'reference', ts.reference,
            'at', ts.created_at,
            'total', ts.total,
            'tenders', (
              select coalesce(jsonb_agg(sp.tender order by sp.created_at), '[]'::jsonb)
              from public.sale_payments sp where sp.sale_id = ts.id
            ),
            'description', 'POS sale - ' || ts.item_count || ' item' || case when ts.item_count = 1 then '' else 's' end
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
  'The employee day panel and the printed End Day report (sales.today) - today only, no parameters, no history, no cost/margin. byTender covers sale_payments AND job_payments, matching today_takings_by_tender (0010) and the day-close expected-cash calculation (0031); salesByTender is the shop-only split. Change request item 7 added itemsSold, jobsCompleted, repairTakings; item 13 added each sale id so a same-day receipt can be reprinted.';
