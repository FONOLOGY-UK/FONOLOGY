-- 0122 — More than one barcode on a product or a variation (client changes, October 2026, #8).
--
-- The same item can arrive with different barcodes (two suppliers, a new pack). products.barcode and
-- product_variants.barcode stay the MAIN barcode — the one a shelf label prints and everything that
-- already reads a barcode keeps reading. Any others live here, typed or scanned in, and scan to the
-- same product or variation at the till.
--
-- One barcode, one thing, per shop: a scan has to find exactly one product or variation. The unique
-- index covers this table; the triggers below stop a main barcode and an extra one from clashing in
-- either direction. They raise unique_violation (23505) naming 'barcode_in_use', so the API tells
-- the person which product already has it. (A main product barcode and a main variation barcode
-- are not compared with each other here — that was never enforced and existing rows may rely on it.)
--
-- Adding or removing an extra barcode is a change to the product, so it goes in the change log
-- (0104) like any other field.

create table public.product_barcodes (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops (id),
  product_id  uuid not null references public.products (id) on delete cascade,
  -- Set when the barcode belongs to one variation rather than the plain product.
  variant_id  uuid references public.product_variants (id) on delete cascade,
  barcode     text not null check (btrim(barcode) <> '' and length(barcode) <= 64),
  created_at  timestamptz not null default now()
);

create unique index product_barcodes_shop_barcode_idx on public.product_barcodes (shop_id, barcode);
create index product_barcodes_product_idx on public.product_barcodes (product_id);

alter table public.product_barcodes enable row level security;
alter table public.product_barcodes force row level security;

comment on table public.product_barcodes is
  'Extra barcodes for a product or one of its variations (0122). The main barcode stays on products/product_variants.';

-- ---------------------------------------------------------------------------
-- One barcode, one thing, per shop
-- ---------------------------------------------------------------------------

create function public.extra_barcode_must_be_free() returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.products
              where shop_id = new.shop_id and barcode = new.barcode)
     or exists (select 1 from public.product_variants
                 where shop_id = new.shop_id and barcode = new.barcode and removed_at is null) then
    raise exception 'That barcode is already in use in this shop.'
      using errcode = 'unique_violation', constraint = 'barcode_in_use';
  end if;
  return new;
end;
$$;

create trigger product_barcodes_must_be_free
  before insert or update of barcode, shop_id on public.product_barcodes
  for each row execute function public.extra_barcode_must_be_free();

create function public.main_barcode_must_not_be_extra() returns trigger
language plpgsql
as $$
begin
  if new.barcode is not null and exists (
       select 1 from public.product_barcodes
        where shop_id = new.shop_id and barcode = new.barcode) then
    raise exception 'That barcode is already in use in this shop.'
      using errcode = 'unique_violation', constraint = 'barcode_in_use';
  end if;
  return new;
end;
$$;

create trigger products_barcode_not_extra
  before insert or update of barcode on public.products
  for each row execute function public.main_barcode_must_not_be_extra();

create trigger product_variants_barcode_not_extra
  before insert or update of barcode on public.product_variants
  for each row execute function public.main_barcode_must_not_be_extra();

-- A removed variation (soft delete, 0107) frees its extra barcodes, as it frees its main one.
create function public.drop_extra_barcodes_of_removed_variant() returns trigger
language plpgsql
as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    delete from public.product_barcodes where variant_id = new.id;
  end if;
  return null;
end;
$$;

create trigger product_variants_drop_extra_barcodes
  after update of removed_at on public.product_variants
  for each row execute function public.drop_extra_barcodes_of_removed_variant();

-- ---------------------------------------------------------------------------
-- The change log
-- ---------------------------------------------------------------------------

create function public.log_extra_barcode_change() returns trigger
language plpgsql
as $$
declare
  v_row        public.product_barcodes := case when tg_op = 'DELETE' then old else new end;
  v_actor      uuid := public.current_actor();
  v_actor_name text;
  v_name       text;
  v_label      text;
begin
  if v_actor is not null then
    select name into v_actor_name from public.staff where id = v_actor;
  end if;
  select name into v_name from public.products where id = v_row.product_id;
  if v_row.variant_id is not null then
    select string_agg(value, ', ') into v_label
      from public.product_variants v, jsonb_each_text(v.options)
     where v.id = v_row.variant_id;
  end if;

  insert into public.inventory_change_log
    (shop_id, product_id, variant_id, product_name, variant_label, change, field, old_value, new_value,
     actor_id, actor_name)
  values
    (v_row.shop_id, v_row.product_id, v_row.variant_id, coalesce(v_name, ''), v_label, 'field',
     'extra_barcode',
     case when tg_op = 'DELETE' then to_jsonb(old.barcode) end,
     case when tg_op = 'INSERT' then to_jsonb(new.barcode) end,
     v_actor, v_actor_name);
  return null;
end;
$$;

create trigger product_barcodes_log
  after insert or delete on public.product_barcodes
  for each row execute function public.log_extra_barcode_change();
