-- 0083 - Configurable spending limits on the two card machines
-- ---------------------------------------------------------------------------
-- Change request item 5 (the doc's A5).
--
-- Six independent, optional numbers: daily / weekly / monthly for Card 1 and
-- Card 2. "Completely optional" is the doc's own word — an admin may set only
-- a monthly limit, or none at all. NULL means no limit, everywhere.
--
-- WHY COLUMNS ON shop_settings RATHER THAN A CHILD TABLE
--
-- shop_settings is this schema's stated single source of shop-wide dials
-- (idle lock, float target, next-day cutoff, returns window) and the doc
-- describes exactly six fixed numbers, not an open set. `pos1`/`pos2` are
-- enum values on tender_method, not rows, so a child table would be keyed on
-- something that cannot grow without a migration anyway. If a third terminal
-- ever appears, both designs need a migration; this one needs less code in
-- between.
--
-- WHAT COUNTS TOWARDS A LIMIT
--
-- Every payment through that terminal, whichever door it came in by: till
-- sales AND repair payments. The limit is a property of the MACHINE, not of
-- what was being sold, and record_job_payment() puts card repair deposits
-- through the same terminal as everything else. This is the same union
-- today_takings_by_tender (0010) and the day-close expected-cash calculation
-- (0031) already use, for the same reason.
--
-- Refunds are NOT subtracted. A limit of this kind is about how much is being
-- pushed through a machine, not about net position, and a day of large
-- refunds should not quietly buy headroom for more takings.
--
-- PERIODS ARE CALENDAR PERIODS, NOT ROLLING WINDOWS
--
-- "Daily/Weekly/Monthly limit" from a shop owner means this day, this week,
-- this month — the same reading change request item 8 settled for the admin
-- date filters, and the same Monday-to-Sunday week. A rolling 7-day window
-- would mean the limit silently resets at a different moment every day.
-- Everything is anchored on shop_day(), so it is Europe/London and survives
-- BST, like every other day boundary in this schema.
--
-- WHERE THE BLOCK ACTUALLY LANDS, AND THE ONE RISK
--
-- The decision taken was a HARD BLOCK: a card payment over its limit is
-- refused, not merely warned about. That makes WHERE it is enforced the most
-- important thing in this migration, because the till runs the customer's
-- card on the physical terminal BEFORE it posts the sale (pos-view.tsx only
-- allows completion once every leg reads `approved`). A block that fires only
-- at sale time would therefore refuse a sale whose money had already been
-- taken, which is far worse than exceeding a limit.
--
-- So it is enforced in two places, and the order matters:
--
--   1. THE TILL, before the card is run. GET /pos/card-limits gives live
--      usage, and the payment cannot be started if it would breach. This is
--      the block that actually protects anyone.
--   2. THIS TRIGGER, at write time. A limit that can be bypassed by ignoring
--      the screen is not a limit, so the database refuses it too.
--
-- The residual risk is real and worth naming: two tills, or a re-check that
-- goes stale between the terminal approving and the sale posting, can leave
-- money taken on a card whose payment is then refused. The window is small
-- (the till re-reads usage immediately before running the card) and the
-- failure is loud — the API's message names the figures and tells staff to
-- void it on the terminal. The alternative, a soft warning, was considered
-- and not chosen.

alter table public.shop_settings
  add column card1_daily_limit   pence,
  add column card1_weekly_limit  pence,
  add column card1_monthly_limit pence,
  add column card2_daily_limit   pence,
  add column card2_weekly_limit  pence,
  add column card2_monthly_limit pence;

comment on column public.shop_settings.card1_daily_limit is
  'Change request item 5. NULL means no limit — every one of the six is independently optional. Counts sale_payments AND job_payments on tender pos1 within the current shop_day(). Enforced by validate_card_payment_limit() and surfaced live by GET /pos/card-limits.';

-- ---------------------------------------------------------------------------
-- How much has gone through a terminal in each window
-- ---------------------------------------------------------------------------

create or replace function public.card_payment_usage(p_tender tender_method)
returns table (daily pence, weekly pence, monthly pence)
language sql
stable
as $$
  with paid as (
    select sp.amount, public.shop_day(sp.created_at) as day
    from public.sale_payments sp
    where sp.tender = p_tender
    union all
    select jp.amount, public.shop_day(jp.at) as day
    from public.job_payments jp
    where jp.tender = p_tender
  ),
  today as (select public.shop_day(now()) as d)
  select
    coalesce(sum(amount) filter (where day = (select d from today)), 0)::integer,
    -- Monday-to-Sunday, the UK trading week and the same one item 8's
    -- "last week" preset uses. date_trunc('week') is ISO: Monday.
    coalesce(sum(amount) filter (
      where day >= date_trunc('week', (select d from today))::date
    ), 0)::integer,
    coalesce(sum(amount) filter (
      where day >= date_trunc('month', (select d from today))::date
    ), 0)::integer
  from paid;
$$;

comment on function public.card_payment_usage is
  'Change request item 5. What has gone through one card terminal in the current shop day, ISO week (Mon-Sun) and calendar month — sale payments and repair payments together, because the limit belongs to the machine and not to what was being sold. Refunds are not subtracted: this measures throughput, not net position.';

-- ---------------------------------------------------------------------------
-- The block
-- ---------------------------------------------------------------------------
-- Fires on sale_payments and job_payments alike. Inside complete_sale() and
-- record_job_payment() this runs in the caller's transaction, so a refusal
-- rolls the whole sale or payment back rather than leaving half of one.

create or replace function public.card_limit_breach(p_tender tender_method, p_amount pence)
returns text
language plpgsql
stable
as $$
declare
  s public.shop_settings;
  u record;
  v_daily   pence;
  v_weekly  pence;
  v_monthly pence;
begin
  if p_tender not in ('pos1', 'pos2') then
    return null;
  end if;

  select * into s from public.shop_settings limit 1;
  if not found then
    return null;
  end if;

  if p_tender = 'pos1' then
    v_daily := s.card1_daily_limit;
    v_weekly := s.card1_weekly_limit;
    v_monthly := s.card1_monthly_limit;
  else
    v_daily := s.card2_daily_limit;
    v_weekly := s.card2_weekly_limit;
    v_monthly := s.card2_monthly_limit;
  end if;

  -- Nothing set for this machine: nothing to check, and no query to run.
  if v_daily is null and v_weekly is null and v_monthly is null then
    return null;
  end if;

  select * into u from public.card_payment_usage(p_tender);

  -- Shortest period first: the most specific limit is the most useful thing
  -- to be told about, and a day breach usually implies the others anyway.
  if v_daily is not null and u.daily + p_amount > v_daily then
    return format(
      '%s is over its daily limit. %s already taken today, limit %s, this payment %s.',
      case p_tender when 'pos1' then 'Card 1' else 'Card 2' end,
      trim(to_char(u.daily / 100.0, 'FM£999999990.00')),
      trim(to_char(v_daily / 100.0, 'FM£999999990.00')),
      trim(to_char(p_amount / 100.0, 'FM£999999990.00'))
    );
  end if;

  if v_weekly is not null and u.weekly + p_amount > v_weekly then
    return format(
      '%s is over its weekly limit. %s already taken this week, limit %s, this payment %s.',
      case p_tender when 'pos1' then 'Card 1' else 'Card 2' end,
      trim(to_char(u.weekly / 100.0, 'FM£999999990.00')),
      trim(to_char(v_weekly / 100.0, 'FM£999999990.00')),
      trim(to_char(p_amount / 100.0, 'FM£999999990.00'))
    );
  end if;

  if v_monthly is not null and u.monthly + p_amount > v_monthly then
    return format(
      '%s is over its monthly limit. %s already taken this month, limit %s, this payment %s.',
      case p_tender when 'pos1' then 'Card 1' else 'Card 2' end,
      trim(to_char(u.monthly / 100.0, 'FM£999999990.00')),
      trim(to_char(v_monthly / 100.0, 'FM£999999990.00')),
      trim(to_char(p_amount / 100.0, 'FM£999999990.00'))
    );
  end if;

  return null;
end;
$$;

comment on function public.card_limit_breach is
  'Change request item 5. Returns a sentence naming the figures when taking p_amount on p_tender would push it past one of its configured limits, or null when it would not. Null-limit means no limit. Shared by the trigger below and by GET /pos/card-limits, so the message the till shows before the card is run is the same one the database would raise.';

create or replace function public.validate_card_payment_limit()
returns trigger
language plpgsql
as $$
declare
  v_message text;
begin
  v_message := public.card_limit_breach(new.tender, new.amount);
  if v_message is not null then
    raise exception '%', v_message using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger sale_payments_card_limit
  before insert on public.sale_payments
  for each row execute function public.validate_card_payment_limit();

create trigger job_payments_card_limit
  before insert on public.job_payments
  for each row execute function public.validate_card_payment_limit();
