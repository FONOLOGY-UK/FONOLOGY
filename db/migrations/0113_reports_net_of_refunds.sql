-- Reports that did not subtract refunds now do.
--
-- The headline figures (analytics_totals) already net refunds, but two sections of the report did not, so
-- after a sale and a full refund the headline said £0 while "Shop revenue by category" still said £19.99 and
-- "Payment methods" still said £10 cash + £9.99 card with no refund line. An accountant reading the page saw
-- two answers.
--
-- revenue_by_category: refunded items come off the category they belong to (units and money), counted in the
--   refund's ORIGINAL shop, as a cross-shop refund is a reduction of that shop's sale. Money-only refunds
--   (no items) have no category and cannot be placed, so they are not subtracted here.
-- tender_totals: refunds paid out of the drawer or card machine appear as negative amounts under the method
--   they went out by. Online-order refunds are left out because online orders are not part of this view.
--   payment_count counts real payments only, not the refund rows.
--
-- Same signatures and column types as 0097, so create or replace is enough.

create or replace function public.revenue_by_category(p_from date, p_to date, p_shop_id uuid default null)
returns table(category_id uuid, category_label text, revenue pence, units integer)
language sql stable
as $$
  select c.id, c.label, sum(combined.revenue)::integer as revenue, sum(combined.units)::integer as units
  from (
    select p.category_id, sl.line_total as revenue, sl.quantity as units, s.created_at as at, s.shop_id
    from public.sale_lines sl
    join public.sales s on s.id = sl.sale_id
    join public.products p on p.id = sl.product_id

    union all

    select p.category_id, ol.line_total, ol.quantity, o.paid_at as at, o.fulfilment_shop_id
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.paid_at is not null
    join public.products p on p.id = ol.product_id

    union all

    -- refunded items, as negatives
    select p.category_id,
           -(rl.unit_price::integer * rl.quantity)::integer as revenue,
           -rl.quantity as units,
           r.created_at as at,
           r.original_shop_id
    from public.refund_lines rl
    join public.refunds r on r.id = rl.refund_id
    join public.products p on p.id = rl.product_id
    where r.job_id is null
  ) combined
  join public.categories c on c.id = combined.category_id
  where public.shop_day(combined.at) between p_from and p_to
    and (p_shop_id is null or combined.shop_id = p_shop_id)
  group by c.id, c.label
  order by revenue desc;
$$;

create or replace function public.tender_totals(p_from date, p_to date, p_shop_id uuid default null)
returns table(tender text, payment_count integer, total pence)
language sql stable
as $$
  select combined.tender::text,
         (count(*) filter (where combined.amount > 0))::integer,
         coalesce(sum(combined.amount), 0)::integer
  from (
    select sp.tender, sp.amount, sp.created_at, s.shop_id
      from public.sale_payments sp join public.sales s on s.id = sp.sale_id
    union all
    select tender, amount, at as created_at, shop_id from public.job_payments
    union all
    -- refunds paid out through the till (counter sales and repair deposits), as negatives, in the shop they left
    select r.refund_tender, -r.amount, r.created_at, r.shop_id
      from public.refunds r
     where r.sale_id is not null or r.job_id is not null
  ) combined
  where public.shop_day(combined.created_at) between p_from and p_to
    and (p_shop_id is null or combined.shop_id = p_shop_id)
  group by combined.tender;
$$;
