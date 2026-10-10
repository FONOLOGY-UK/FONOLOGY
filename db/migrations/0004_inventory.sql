-- 0004 — Inventory
-- Stock movements, weighted average cost, oversell protection.
--
-- The frontend keeps one number per product and overwrites it. Nothing records
-- how a count got to where it is, so "why does the shelf say 3 and the system
-- say 7" has no answer.
--
-- Here the movements are the truth and the number on the product is a running
-- total kept in step by trigger. Every change leaves a row saying what
-- happened, why, and who did it.

create type stock_movement_kind as enum (
  'receipt',        -- delivery from a supplier
  'buy_in',         -- bought from a customer over the counter
  'sale',           -- sold at the till
  'online_order',   -- sold on the website
  'repair_part',    -- used on a repair job
  'refund_restock', -- came back on a return
  'write_off',      -- damaged, lost, or used internally
  'correction'      -- stocktake adjustment
);

create table public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete restrict,
  kind         stock_movement_kind not null,

  -- Signed. Positive brings stock in, negative takes it out.
  qty_delta    integer not null check (qty_delta <> 0),

  -- Cost per unit, inbound movements only. Drives the weighted average.
  unit_cost    pence check (unit_cost is null or unit_cost >= 0),

  -- Why. Required for write-offs and corrections, because those are the ones
  -- someone will ask about later.
  reason       text,

  -- What caused it — a sale, an order, a repair job. Left loose on purpose so
  -- this table doesn't need a foreign key to every other table in the schema.
  source_type  text,
  source_id    uuid,

  staff_id     uuid references public.staff (id),
  created_at   timestamptz not null default now(),

  constraint stock_movements_inbound_has_cost
    check (
      kind not in ('receipt', 'buy_in')
      or unit_cost is not null
    ),

  constraint stock_movements_reason_required
    check (
      kind not in ('write_off', 'correction')
      or (reason is not null and length(btrim(reason)) > 0)
    ),

  constraint stock_movements_direction
    check (
      (kind in ('receipt', 'buy_in', 'refund_restock') and qty_delta > 0)
      or (kind in ('sale', 'online_order', 'repair_part', 'write_off') and qty_delta < 0)
      or kind = 'correction'
    )
);

create index stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);

create index stock_movements_source_idx
  on public.stock_movements (source_type, source_id);

create index stock_movements_day_idx
  on public.stock_movements (public.shop_day(created_at));

create index stock_movements_staff_idx on public.stock_movements (staff_id);

comment on table public.stock_movements is
  'Every change to every stock count, ever. The product total is derived from this.';

-- ---------------------------------------------------------------------------
-- Keeping the running total in step
-- ---------------------------------------------------------------------------
-- This trigger does three jobs:
--
--   1. Applies the movement to products.stock_qty.
--   2. Recalculates the weighted average cost when stock comes in cheaper or
--      dearer than what's already on the shelf.
--   3. Stops an oversell. The CHECK on products.stock_qty >= 0 fails the
--      update, which aborts the whole transaction — so the second of two
--      simultaneous sales of the last item is rejected outright rather than
--      quietly clamped to zero.
--
-- The UPDATE takes a row lock on the product, so two tills hitting the same
-- product queue up instead of both reading the same stale number.

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
as $$
declare
  v_qty_before  integer;
  v_cost_before pence;
  v_new_cost    pence;
begin
  select stock_qty, cost_price
    into v_qty_before, v_cost_before
    from public.products
   where id = new.product_id
     for update;

  if not found then
    raise exception 'Product % does not exist', new.product_id;
  end if;

  -- Weighted average, inbound only.
  --
  -- Worked example: 10 cases on the shelf at 400p each, 10 more arrive at
  -- 500p. New average is (10*400 + 10*500) / 20 = 450p.
  --
  -- If the shelf is empty or would go negative, the incoming price simply
  -- becomes the new cost — there's nothing to average against.
  if new.qty_delta > 0 and new.unit_cost is not null then
    if v_qty_before > 0 then
      v_new_cost := round(
        ((v_qty_before::numeric * v_cost_before) + (new.qty_delta::numeric * new.unit_cost))
        / (v_qty_before + new.qty_delta)
      )::integer;
    else
      v_new_cost := new.unit_cost;
    end if;
  else
    v_new_cost := v_cost_before;
  end if;

  update public.products
     set stock_qty  = stock_qty + new.qty_delta,
         cost_price = v_new_cost,
         updated_at = now()
   where id = new.product_id;

  return new;
end;
$$;

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- Movements are history. Editing or deleting one would make the running total
-- a lie — a mistake gets a correction row, not a rewrite.
create or replace function public.block_stock_movement_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Stock movements cannot be changed or deleted. Add a correction instead.';
end;
$$;

create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.block_stock_movement_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Taking stock out. Raises if there isn't enough, which is what should happen
-- at a till — a sale that can't be fulfilled shouldn't quietly complete.
create or replace function public.stock_consume(
  p_product_id  uuid,
  p_qty         integer,
  p_kind        stock_movement_kind,
  p_source_type text default null,
  p_source_id   uuid default null,
  p_staff_id    uuid default null,
  p_reason      text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_qty <= 0 then
    raise exception 'Quantity must be positive, got %', p_qty;
  end if;

  insert into public.stock_movements
    (product_id, kind, qty_delta, source_type, source_id, staff_id, reason)
  values
    (p_product_id, p_kind, -p_qty, p_source_type, p_source_id, p_staff_id, p_reason)
  returning id into v_id;

  return v_id;
exception
  when check_violation then
    raise exception 'Not enough stock for product %', p_product_id
      using hint = 'Check the shelf count before completing the sale.';
end;
$$;

-- Bringing stock in.
--
-- p_reason exists because 'correction' is a valid inbound kind (the
-- direction constraint above explicitly allows a positive correction) but
-- stock_movements_reason_required demands a reason for every correction —
-- without a way to pass one through, this function could never actually be
-- used for a positive stocktake adjustment, only receipts and buy-ins. Found
-- by trying to write a test for it, not by reading the function.
create or replace function public.stock_receive(
  p_product_id  uuid,
  p_qty         integer,
  p_unit_cost   pence,
  p_kind        stock_movement_kind default 'receipt',
  p_source_type text default null,
  p_source_id   uuid default null,
  p_staff_id    uuid default null,
  p_reason      text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_qty <= 0 then
    raise exception 'Quantity must be positive, got %', p_qty;
  end if;

  insert into public.stock_movements
    (product_id, kind, qty_delta, unit_cost, source_type, source_id, staff_id, reason)
  values
    (p_product_id, p_kind, p_qty, p_unit_cost, p_source_type, p_source_id, p_staff_id, p_reason)
  returning id into v_id;

  return v_id;
end;
$$;

-- The three words a customer is allowed to see. Never a number.
create or replace function public.stock_status_for(p_product_id uuid)
returns stock_status
language sql
stable
as $$
  select case
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
