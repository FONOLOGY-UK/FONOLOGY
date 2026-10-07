-- 0104 — The change log: every change to a product, automatically (Log B)
-- ---------------------------------------------------------------------------
-- Client change request (October 2026, "Fonology Remaining Features" #4): an
-- automatic, uneditable trail of every change to existing inventory — "stock
-- of item X changed from A to B by user Y" — and, per the client, any other
-- change too: price, cost, name, category, barcode and so on. It is never
-- combined with Log A (goods in, 0103).
--
-- Written by triggers, so no route, function or script can change a product
-- without leaving a row:
--
--   * products / product_variants AFTER INSERT OR UPDATE — 'created', one
--     'field' row per changed column, 'retired' / 'restored'.
--   * stock_movements AFTER INSERT (after stock_movements_apply) — one 'stock'
--     row with the quantity before and after, the movement kind and its source
--     (a sale, an order, goods in, a correction ...).
--
-- WHO. The database only knows the person when it is told. Stock movements
-- carry staff_id; for a plain UPDATE the API sets the transaction-local
-- setting app.staff_id (lib/db.ts withActor). A stock movement with a staff_id
-- also sets it for the rest of its transaction when nothing has, so the cost
-- change a goods-in causes is attributed to the person who booked it in. No
-- actor (an online order, a direct SQL change) is shown as "System".
--
-- The product, variant and person are recorded by id AND by name at the time:
-- the ids are deliberately not foreign keys, so a product deleted before it had
-- any sales (014) can still be deleted, and its rows still read correctly.
--
-- Existing stock history is copied in once, with quantities worked back from
-- today's counts, so the log starts with what the movements already know.

create table public.inventory_change_log (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops (id),
  product_id    uuid not null,
  variant_id    uuid,
  product_name  text not null,
  variant_label text,
  change        text not null
    check (change in ('created', 'field', 'stock', 'retired', 'restored')),
  field         text,
  old_value     jsonb,
  new_value     jsonb,
  stock_kind    stock_movement_kind,
  source_type   text,
  source_id     uuid,
  note          text,
  actor_id      uuid,
  actor_name    text,
  created_at    timestamptz not null default now()
);

create index inventory_change_log_shop_idx on public.inventory_change_log (shop_id, created_at desc);
create index inventory_change_log_product_idx on public.inventory_change_log (product_id, created_at desc);
create index inventory_change_log_created_idx on public.inventory_change_log (created_at desc);

comment on table public.inventory_change_log is
  'Log B — every change to a product or variant (fields, stock, retire/restore), written by triggers. Never combined with goods in (0103). Immutable.';

create function public.block_change_log_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'The change log cannot be edited or deleted.';
end;
$$;

create trigger inventory_change_log_immutable
  before update or delete on public.inventory_change_log
  for each row execute function public.block_change_log_change();

alter table public.inventory_change_log enable row level security;
alter table public.inventory_change_log force row level security;

-- ---------------------------------------------------------------------------
-- Who is acting
-- ---------------------------------------------------------------------------

create function public.current_actor() returns uuid
language sql stable
as $$ select nullif(current_setting('app.staff_id', true), '')::uuid $$;

comment on function public.current_actor is
  'The staff member the API said is acting in this transaction (set_config(''app.staff_id'', id, true)), or null.';

create function public.stock_movement_remember_actor() returns trigger
language plpgsql
as $$
begin
  if new.staff_id is not null and public.current_actor() is null then
    perform set_config('app.staff_id', new.staff_id::text, true);
  end if;
  return new;
end;
$$;

create trigger stock_movements_b_remember_actor
  before insert on public.stock_movements
  for each row execute function public.stock_movement_remember_actor();

-- ---------------------------------------------------------------------------
-- Product and variant changes
-- ---------------------------------------------------------------------------

create function public.log_product_change() returns trigger
language plpgsql
as $$
declare
  v_new        jsonb := to_jsonb(new);
  v_old        jsonb;
  v_variant    boolean := tg_table_name = 'product_variants';
  v_cols       text[];
  v_col        text;
  v_actor      uuid := public.current_actor();
  v_actor_name text;
  v_product_id uuid;
  v_variant_id uuid;
  v_name       text;
  v_label      text;
begin
  if v_actor is not null then
    select name into v_actor_name from public.staff where id = v_actor;
  end if;

  if v_variant then
    v_product_id := (v_new ->> 'product_id')::uuid;
    v_variant_id := (v_new ->> 'id')::uuid;
    select name into v_name from public.products where id = v_product_id;
    select string_agg(value, ', ') into v_label from jsonb_each_text(v_new -> 'options');
    v_cols := array['options', 'sku', 'barcode', 'price_adjustment', 'cost_price',
                    'low_stock_alert', 'low_stock_threshold'];
  else
    v_product_id := (v_new ->> 'id')::uuid;
    v_name := v_new ->> 'name';
    v_cols := array['name', 'sub', 'description', 'category_id', 'price', 'cost_price', 'barcode',
                    'imei', 'supplier_id', 'low_stock_alert', 'low_stock_threshold', 'in_store_only',
                    'tag', 'compatibility', 'has_variants', 'free_delivery'];
  end if;

  if tg_op = 'INSERT' then
    insert into public.inventory_change_log
      (shop_id, product_id, variant_id, product_name, variant_label, change, new_value, actor_id, actor_name)
    values
      ((v_new ->> 'shop_id')::uuid, v_product_id, v_variant_id, coalesce(v_name, ''), v_label, 'created',
       case when v_variant then jsonb_build_object('stock_qty', v_new -> 'stock_qty')
            else jsonb_build_object('price', v_new -> 'price', 'stock_qty', v_new -> 'stock_qty') end,
       v_actor, v_actor_name);
    return null;
  end if;

  v_old := to_jsonb(old);

  if (v_old -> 'is_active') is distinct from (v_new -> 'is_active') then
    insert into public.inventory_change_log
      (shop_id, product_id, variant_id, product_name, variant_label, change, field, old_value, new_value,
       actor_id, actor_name)
    values
      ((v_new ->> 'shop_id')::uuid, v_product_id, v_variant_id, coalesce(v_name, ''), v_label,
       case when (v_new ->> 'is_active')::boolean then 'restored' else 'retired' end,
       'is_active', v_old -> 'is_active', v_new -> 'is_active', v_actor, v_actor_name);
  end if;

  foreach v_col in array v_cols loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      insert into public.inventory_change_log
        (shop_id, product_id, variant_id, product_name, variant_label, change, field, old_value, new_value,
         actor_id, actor_name)
      values
        ((v_new ->> 'shop_id')::uuid, v_product_id, v_variant_id, coalesce(v_name, ''), v_label, 'field',
         v_col, v_old -> v_col, v_new -> v_col, v_actor, v_actor_name);
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.log_product_change is
  'Writes Log B rows for a product or variant: created, one row per changed column, retired/restored. Stock is logged from stock_movements, not here.';

create trigger products_log_change
  after insert or update on public.products
  for each row execute function public.log_product_change();

create trigger product_variants_log_change
  after insert or update on public.product_variants
  for each row execute function public.log_product_change();

-- ---------------------------------------------------------------------------
-- Stock changes
-- ---------------------------------------------------------------------------

create function public.log_stock_movement() returns trigger
language plpgsql
as $$
declare
  v_after      integer;
  v_name       text;
  v_label      text;
  v_actor      uuid := coalesce(new.staff_id, public.current_actor());
  v_actor_name text;
begin
  select name into v_name from public.products where id = new.product_id;
  if new.variant_id is not null then
    select stock_qty, (select string_agg(value, ', ') from jsonb_each_text(options))
      into v_after, v_label
      from public.product_variants where id = new.variant_id;
  else
    select stock_qty into v_after from public.products where id = new.product_id;
  end if;
  if v_actor is not null then
    select name into v_actor_name from public.staff where id = v_actor;
  end if;

  insert into public.inventory_change_log
    (shop_id, product_id, variant_id, product_name, variant_label, change, field, old_value, new_value,
     stock_kind, source_type, source_id, note, actor_id, actor_name, created_at)
  values
    (new.shop_id, new.product_id, new.variant_id, coalesce(v_name, ''), v_label, 'stock', 'stock_qty',
     to_jsonb(v_after - new.qty_delta), to_jsonb(v_after),
     new.kind, new.source_type, new.source_id, new.reason, v_actor, v_actor_name, new.created_at);
  return null;
end;
$$;

-- AFTER INSERT triggers fire in name order: stock_movements_apply has already moved the count.
create trigger stock_movements_log
  after insert on public.stock_movements
  for each row execute function public.log_stock_movement();

-- ---------------------------------------------------------------------------
-- The stock history so far
-- ---------------------------------------------------------------------------
-- Quantities are worked back from today's count (count now, minus everything that moved after
-- each row), so the last row always ends on the real shelf figure.

insert into public.inventory_change_log
  (shop_id, product_id, variant_id, product_name, variant_label, change, field, old_value, new_value,
   stock_kind, source_type, source_id, note, actor_id, actor_name, created_at)
select m.shop_id, m.product_id, m.variant_id, p.name,
       (select string_agg(value, ', ') from jsonb_each_text(v.options)),
       'stock', 'stock_qty',
       to_jsonb(h.after_qty - m.qty_delta), to_jsonb(h.after_qty),
       m.kind, m.source_type, m.source_id, m.reason, m.staff_id, s.name, m.created_at
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  left join public.product_variants v on v.id = m.variant_id
  left join public.staff s on s.id = m.staff_id
  join lateral (
    select coalesce(v.stock_qty, p.stock_qty)
           - coalesce((select sum(later.qty_delta)
                         from public.stock_movements later
                        where later.product_id = m.product_id
                          and later.variant_id is not distinct from m.variant_id
                          and (later.created_at, later.id) > (m.created_at, m.id)), 0) as after_qty
  ) h on true;
