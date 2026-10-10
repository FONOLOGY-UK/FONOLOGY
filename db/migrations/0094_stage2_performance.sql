-- 0094 — Stage 2 performance: variant-aware product stock status, a bounded
-- card-limit check, and the indexes the ledger windows were missing.
--
-- Three independent changes, additive only (create or replace / create index
-- if not exists); nothing existing is dropped or edited.

-- ---------------------------------------------------------------------------
-- 1. stock_status_for(product): a product WITH variants was judged on the
--    parent's own stock_qty
-- ---------------------------------------------------------------------------
-- For a has_variants product the parent's price/stock_qty/cost columns are
-- frozen and unused (0060) — the real stock lives on the variants and the
-- parent normally sits at 0. stock_status_for(uuid), and stock_status_for_many
-- (0025) which delegates to it, read that parent number, so the shop grid
-- called a product "out of stock" while its variants were on the shelf.
-- The PDP shows each variant's own status correctly (the two-argument
-- overload); only the product-level answer — the one the grid card shows —
-- was wrong.
--
-- For a has_variants product the answer is now: in stock if any ACTIVE
-- variant has stock; otherwise restocking if any receipt for the product (any
-- of its variants) landed in the last 30 days; otherwise out of stock. A
-- product without variants is unchanged, line for line.

create or replace function public.stock_status_for(p_product_id uuid)
returns stock_status
language sql
stable
as $$
  select case
    when p.has_variants then
      case
        when exists (
          select 1 from public.product_variants v
          where v.product_id = p.id and v.is_active and v.stock_qty > 0
        ) then 'in-stock'::stock_status
        when exists (
          select 1 from public.stock_movements m
          where m.product_id = p.id
            and m.kind = 'receipt'
            and m.created_at > now() - interval '30 days'
        ) then 'restocking'::stock_status
        else 'out-of-stock'::stock_status
      end
    when p.stock_qty > 0 then 'in-stock'::stock_status
    when exists (
      select 1 from public.stock_movements m
      where m.product_id = p.id
        and m.kind = 'receipt'
        and m.created_at > now() - interval '30 days'
    ) then 'restocking'::stock_status
    else 'out-of-stock'::stock_status
  end
  from public.products p
  where p.id = p_product_id;
$$;

-- ---------------------------------------------------------------------------
-- 2. card_payment_usage(): stop reading all payment history
-- ---------------------------------------------------------------------------
-- 0086 filtered by tender only and then bucketed by shop_day in the
-- aggregate, so every card payment (the limit check runs inside
-- complete_sale / record_job_payment) and every /pos/card-limits read scanned
-- every card payment the shop had ever taken. The three windows only ever
-- look back to the start of the current ISO week or calendar month,
-- whichever is earlier — so only that far is read now. The lower bound has a
-- two-day margin so a London-local day that begins the evening before in UTC
-- is never cut off; the exact day filters in the aggregate are unchanged, so
-- the figures are identical.

create or replace function public.card_payment_usage(p_tender tender_method)
returns table (daily pence, weekly pence, monthly pence)
language sql
stable
as $$
  with bounds as (
    select public.shop_day(now()) as d,
           least(
             date_trunc('week', public.shop_day(now()))::date,
             date_trunc('month', public.shop_day(now()))::date
           ) - 2 as since
  ),
  paid as (
    select sp.amount, public.shop_day(sp.created_at) as day
    from public.sale_payments sp
    where sp.tender = p_tender
      and sp.created_at >= (select since from bounds)
    union all
    select jp.amount, public.shop_day(jp.at) as day
    from public.job_payments jp
    where jp.tender = p_tender
      and jp.at >= (select since from bounds)
  )
  select
    coalesce(sum(amount) filter (where day = (select d from bounds)), 0)::integer,
    -- Monday-to-Sunday, the UK trading week and the same one item 8's
    -- "last week" preset uses. date_trunc('week') is ISO: Monday.
    coalesce(sum(amount) filter (
      where day >= date_trunc('week', (select d from bounds))::date
    ), 0)::integer,
    coalesce(sum(amount) filter (
      where day >= date_trunc('month', (select d from bounds))::date
    ), 0)::integer
  from paid;
$$;

-- ---------------------------------------------------------------------------
-- 3. Indexes for the time windows
-- ---------------------------------------------------------------------------
-- The existing *_day_idx indexes are on shop_day(created_at) — an expression
-- — so a filter on the raw timestamp (day close, the transactions view, the
-- card-limit lookup above) could not use them and read the whole table.

create index if not exists sale_payments_tender_created_idx
  on public.sale_payments (tender, created_at);
create index if not exists job_payments_tender_at_idx
  on public.job_payments (tender, at);
create index if not exists sales_created_at_idx
  on public.sales (created_at);
create index if not exists refunds_created_at_idx
  on public.refunds (created_at);
create index if not exists orders_created_at_idx
  on public.orders (created_at);
create index if not exists trade_in_payouts_created_at_idx
  on public.trade_in_payouts (created_at);
