-- 0008 — The till
-- Sales with real line items, split payments that provably sum to the total,
-- refunds that know both payment methods involved, and cash.
--
-- The biggest gap in the current system lives here: a till sale today is only
-- ever a handful of ledger rows, one per payment portion, with no record of
-- what was actually sold. That's why a counter refund can't prefill anything
-- and staff re-type the basket by hand. Fixed by giving a sale real lines.

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

create table public.sales (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  staff_id           uuid not null references public.staff (id),

  subtotal           pence not null check (subtotal >= 0),
  discount           pence not null default 0 check (discount >= 0),
  total              pence generated always as (greatest(subtotal - discount, 0)) stored,
  cost               pence not null default 0 check (cost >= 0),

  -- Warns, never blocks — a hard business rule. There is deliberately no
  -- CHECK forcing below_cost_reason to be filled in even when below_cost is
  -- true: the reason is optional by design, not an oversight.
  below_cost         boolean not null default false,
  below_cost_reason  text,

  created_at         timestamptz not null default now()
);

create index sales_staff_idx on public.sales (staff_id);
create index sales_day_idx   on public.sales (public.shop_day(created_at));

create or replace function public.sales_set_reference()
returns trigger
language plpgsql
as $$
begin
  new.reference := public.issue_reference('sale', new.id, 'FNL');
  return new;
end;
$$;

create trigger sales_issue_reference
  before insert on public.sales
  for each row execute function public.sales_set_reference();

create table public.sale_lines (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales (id) on delete cascade,
  product_id   uuid references public.products (id) on delete set null,

  name         text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   pence not null check (unit_price >= 0),   -- actually charged (a bulk tier may have lowered this)
  list_price   pence not null check (list_price >= 0),   -- shelf price, for the receipt's "you saved" line
  cost_price   pence not null check (cost_price >= 0),   -- snapshot at time of sale
  tier_applied boolean not null default false,
  line_total   pence generated always as (unit_price * quantity) stored,

  created_at   timestamptz not null default now()
);

create index sale_lines_sale_idx on public.sale_lines (sale_id);
create index sale_lines_product_idx on public.sale_lines (product_id) where product_id is not null;

create table public.sale_payments (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references public.sales (id) on delete cascade,
  tender     tender_method not null,
  -- >= 0, not > 0: a sale can genuinely total zero (a free item, or a
  -- discount that fully covers the subtotal — sales_discount_not_over_
  -- subtotal in 0013 allows a discount exactly equal to the subtotal). Every
  -- sale still needs at least one payment row (complete_sale() requires
  -- p_payments to be non-empty), so a zero-total sale is recorded as one
  -- payment row of 0 rather than none at all — "nothing changed hands" is
  -- still a fact worth a row, not the same as "we don't know what happened".
  amount     pence not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index sale_payments_sale_idx on public.sale_payments (sale_id);

-- Enforced as a deferred constraint trigger, not a plain CHECK, because the
-- rule spans two tables — a CHECK can only see one row. Deferred means it
-- fires once at COMMIT rather than after each individual payment row is
-- inserted, so a three-way split sale is validated once, correctly, after all
-- three rows exist — not rejected on the first row for not yet equalling the
-- total.
create or replace function public.validate_sale_payments_total()
returns trigger
language plpgsql
as $$
declare
  v_sale_id uuid;
  v_total   pence;
  v_paid    pence;
begin
  v_sale_id := coalesce(new.sale_id, old.sale_id);

  select total into v_total from public.sales where id = v_sale_id;
  select coalesce(sum(amount), 0) into v_paid from public.sale_payments where sale_id = v_sale_id;

  if v_paid <> v_total then
    raise exception 'Sale % payments (%) do not equal the total (%)', v_sale_id, v_paid, v_total;
  end if;

  return null;
end;
$$;

create constraint trigger sale_payments_sum_matches_total
  after insert or update or delete on public.sale_payments
  deferrable initially deferred
  for each row execute function public.validate_sale_payments_total();

-- ---------------------------------------------------------------------------
-- complete_sale — the till's one write
-- ---------------------------------------------------------------------------
-- Lines and payments arrive as jsonb so the whole sale commits in one call:
-- if payments don't sum to the total, the deferred trigger above fires at the
-- end of THIS transaction and the entire sale — lines, stock already
-- consumed, everything — rolls back together. No partial sale, no stock
-- silently deducted for a sale that never actually balanced.

create or replace function public.complete_sale(
  p_staff_id  uuid,
  p_lines     jsonb,   -- [{"product_id", "quantity", "unit_price", "list_price", "tier_applied"}]
  p_payments  jsonb,   -- [{"tender", "amount"}]
  p_discount  pence default 0,
  p_below_cost_reason text default null
)
returns uuid
language plpgsql
as $$
declare
  v_sale_id  uuid;
  v_subtotal pence := 0;
  v_cost     pence := 0;
  v_line     jsonb;
  v_payment  jsonb;
  v_product  public.products;
  v_below_cost boolean;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale needs at least one line';
  end if;
  if jsonb_array_length(p_payments) = 0 then
    raise exception 'A sale needs at least one payment';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;
    v_subtotal := v_subtotal + (v_line ->> 'unit_price')::integer * (v_line ->> 'quantity')::integer;
    v_cost     := v_cost + v_product.cost_price * (v_line ->> 'quantity')::integer;
  end loop;

  v_below_cost := (v_subtotal - p_discount) <= v_cost;

  insert into public.sales (staff_id, subtotal, discount, cost, below_cost, below_cost_reason)
  values (p_staff_id, v_subtotal, p_discount, v_cost, v_below_cost, p_below_cost_reason)
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;

    insert into public.sale_lines (sale_id, product_id, name, quantity, unit_price, list_price, cost_price, tier_applied)
    values (
      v_sale_id, v_product.id, v_product.name,
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      coalesce((v_line ->> 'list_price')::integer, (v_line ->> 'unit_price')::integer),
      v_product.cost_price,
      coalesce((v_line ->> 'tier_applied')::boolean, false)
    );

    perform public.stock_consume(
      v_product.id, (v_line ->> 'quantity')::integer, 'sale',
      'sale', v_sale_id, p_staff_id
    );
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    insert into public.sale_payments (sale_id, tender, amount)
    values (v_sale_id, (v_payment ->> 'tender')::tender_method, (v_payment ->> 'amount')::integer);
  end loop;

  -- The payments-match-total trigger is DEFERRED so a multi-row split isn't
  -- rejected after just its first row — but left alone, "deferred" means
  -- "at the end of whatever transaction the CALLER happens to be running",
  -- which could be much later than this function call if complete_sale is
  -- invoked as one step inside a bigger transaction. Forcing it to fire
  -- right here means a caller gets the error from THIS call, not a
  -- mysterious failure on an unrelated COMMIT much later. Found by testing
  -- "payments that don't sum to the total" and getting no exception at all.
  --
  -- SET CONSTRAINTS is NOT scoped to this function call — it changes the
  -- mode for the rest of the enclosing transaction. Immediately setting it
  -- back to deferred is required, not optional: without it, the first
  -- successful sale in a transaction would leave every later split-payment
  -- sale in that same transaction checking row-by-row instead of once,
  -- failing on its first inserted portion. Found exactly that way — one
  -- passing sale, then the very next split sale failing on its first row.
  set constraints public.sale_payments_sum_matches_total immediate;
  set constraints public.sale_payments_sum_matches_total deferred;

  return v_sale_id;
end;
$$;

comment on function public.complete_sale is
  'The only way a till sale should be created. Stock is consumed line by line inside the same transaction as the payment rows, so if the deferred payments-equal-total check fails at commit, the stock movements roll back with it — nothing is left half-applied.';

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------
-- original_tender and refund_tender are separate columns on purpose — the
-- client confirmed a refund can go back by a different method than the sale
-- came in on (a card sale refunded as cash, say), and the drawer only
-- balances at close if both sides are on record, not just the one that moved.

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),

  sale_id            uuid references public.sales (id),    -- one of these two, or neither (goodwill, no receipt)
  order_id           uuid references public.orders (id),

  amount             pence not null check (amount > 0),
  original_tender    tender_method,                          -- how the sale/order was originally paid, where known
  refund_tender      tender_method not null,                 -- how the money actually went back out
  reason             text not null,

  -- The owner overrides the return window for people he trusts. This records
  -- that it happened rather than blocking it — the business rule is "let him,
  -- but write it down", not "stop him".
  outside_window     boolean not null default false,
  window_override_by uuid references public.staff (id),

  staff_id           uuid not null references public.staff (id),
  created_at         timestamptz not null default now(),

  constraint refunds_window_override_needs_authoriser check (
    not outside_window or window_override_by is not null
  )
);

create index refunds_sale_idx  on public.refunds (sale_id)  where sale_id is not null;
create index refunds_order_idx on public.refunds (order_id) where order_id is not null;
create index refunds_staff_idx on public.refunds (staff_id);
create index refunds_window_override_by_idx on public.refunds (window_override_by) where window_override_by is not null;

create table public.refund_lines (
  id         uuid primary key default gen_random_uuid(),
  refund_id  uuid not null references public.refunds (id) on delete cascade,
  product_id uuid references public.products (id),
  name       text not null,
  quantity   integer not null check (quantity > 0),
  unit_price pence not null check (unit_price >= 0),
  restocked  boolean not null default false,
  created_at timestamptz not null default now()
);

create index refund_lines_refund_idx on public.refund_lines (refund_id);
create index refund_lines_product_idx on public.refund_lines (product_id) where product_id is not null;

create or replace function public.create_refund(
  p_staff_id       uuid,
  p_amount         pence,
  p_refund_tender  tender_method,
  p_reason         text,
  p_lines          jsonb default '[]'::jsonb,   -- [{"product_id","name","quantity","unit_price","restock"}]
  p_sale_id        uuid default null,
  p_order_id       uuid default null,
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
  -- A refund (or the sum of several partial refunds) can never exceed what
  -- was actually paid. No check at all here, previously — found by testing
  -- "refunding more than was sold", not by reading the function. A goodwill
  -- refund (neither sale_id nor order_id given) has nothing to check
  -- against and is left alone, matching the business rule that those are
  -- allowed freely.
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
  end if;

  if v_original_total is not null then
    select coalesce(sum(amount), 0) into v_already_refunded
    from public.refunds
    where (p_sale_id is not null and sale_id = p_sale_id)
       or (p_order_id is not null and order_id = p_order_id);

    if v_already_refunded + p_amount > v_original_total then
      raise exception 'Refund amount (%) plus what has already been refunded (%) would exceed what was paid (%)',
        p_amount, v_already_refunded, v_original_total;
    end if;
  end if;

  insert into public.refunds (
    sale_id, order_id, amount, original_tender, refund_tender, reason,
    outside_window, window_override_by, staff_id
  ) values (
    p_sale_id, p_order_id, p_amount, p_original_tender, p_refund_tender, p_reason,
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
  'The only way a refund should be recorded. A restocked line calls stock_receive with kind refund_restock — unit_cost is left null (the weighted-average cost is unaffected by goods coming back at the price they were sold, not the price they were bought).';

-- ---------------------------------------------------------------------------
-- Cash — float, petty cash, day close
-- ---------------------------------------------------------------------------

create type cash_entry_kind as enum ('float_open', 'petty_in', 'petty_out');

create table public.cash_entries (
  id           uuid primary key default gen_random_uuid(),
  -- The shop_day this belongs to. A DEFAULT, not a GENERATED column: staff
  -- occasionally log a float days late for a day that's already passed, and
  -- a generated column tied to created_at would make that impossible. The
  -- default covers the normal case (today) without anyone having to
  -- remember to compute it; an explicit value overrides it for a backdated
  -- correction.
  trading_day  date not null default public.shop_day(now()),
  kind         cash_entry_kind not null,
  amount       pence not null check (amount > 0),   -- direction comes from kind, not the sign
  note         text not null,
  staff_id     uuid not null references public.staff (id),
  created_at   timestamptz not null default now()
);

create index cash_entries_day_idx on public.cash_entries (trading_day);
create index cash_entries_staff_idx on public.cash_entries (staff_id);

-- The frontend lets two staff both record an opening float for the same day.
-- This is the actual fix: the second INSERT hits the unique index and fails
-- outright, rather than the UI just happening not to show the prompt twice.
create unique index cash_entries_one_float_open_per_day
  on public.cash_entries (trading_day)
  where kind = 'float_open';

create table public.day_close (
  id               uuid primary key default gen_random_uuid(),
  trading_day      date not null unique default public.shop_day(now()),
  -- Snapshots, not a live computation. The expected figure that mattered was
  -- the one the till showed at the moment of closing — if a backdated
  -- correction later changes what "expected" would compute to today, this
  -- row must not silently change with it. Variance is derived from these two
  -- sibling columns only, so it's safe as a generated column.
  expected_amount  pence not null,
  counted_amount   pence not null,
  variance         pence generated always as (counted_amount - expected_amount) stored,
  note             text,
  staff_id         uuid not null references public.staff (id),
  created_at       timestamptz not null default now()
);

create index day_close_staff_idx on public.day_close (staff_id);

comment on table public.day_close is
  'A variance here is almost always a miscount or a bit of petty cash that never got logged, not theft — this table exists so the owner can see the pattern over weeks, not to accuse anyone over one bad Tuesday.';
