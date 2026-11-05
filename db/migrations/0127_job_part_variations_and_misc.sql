-- 0127 — Job parts: variations and Miscellaneous Parts (client changes v2, November 2026, section 5).
--
-- 1. A part can be one variation of a product. A variation product holds no stock of its own, so
--    until now such a product could not be fitted at all.
-- 2. A misc part is something not in the system, like a misc line at the till: a name, no product,
--    no stock movement, and a cost that may not be known yet (cost_pending, unit_cost a 0
--    placeholder), which lands in Missing Costs to fill in later.

alter table public.job_parts
  add column variant_id uuid references public.product_variants (id),
  add column name text,
  add column cost_pending boolean not null default false,
  alter column product_id drop not null,
  alter column stock_movement_id drop not null;

alter table public.job_parts
  add constraint job_parts_product_or_name
    check (product_id is not null or nullif(btrim(name), '') is not null),
  add constraint job_parts_pending_cost_is_misc
    check (cost_pending = false or product_id is null);

create index job_parts_cost_pending_idx on public.job_parts (added_at) where cost_pending;

comment on column public.job_parts.cost_pending is
  'A misc part whose cost was not known when it was added, so unit_cost is a 0 placeholder (0127). Cleared by set_job_part_cost().';

-- Dropped and recreated rather than overloaded: two versions would make every named call ambiguous.
drop function public.add_job_part(uuid, uuid, integer, uuid);

create function public.add_job_part(
  p_job_id uuid, p_product_id uuid, p_quantity integer, p_staff_id uuid default null,
  p_variant_id uuid default null)
returns uuid
language plpgsql
as $function$
declare
  v_product public.products;
  v_cost_price pence;
  v_job_shop uuid;
  v_movement_id uuid;
  v_id uuid;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'Product % not found', p_product_id;
  end if;
  select shop_id into v_job_shop from public.jobs where id = p_job_id;
  if v_job_shop is distinct from v_product.shop_id then
    raise exception 'Product % belongs to another shop than job %', p_product_id, p_job_id;
  end if;

  if p_variant_id is not null then
    select cost_price into v_cost_price
      from public.product_variants
     where id = p_variant_id and product_id = p_product_id and removed_at is null;
    if not found then
      raise exception 'That variation of "%" no longer exists', v_product.name;
    end if;
  elsif v_product.has_variants then
    raise exception 'Choose which variation of "%" was fitted', v_product.name;
  else
    v_cost_price := v_product.cost_price;
  end if;

  v_movement_id := public.stock_consume(
    p_product_id, p_quantity, 'repair_part',
    'job', p_job_id, p_staff_id, null, p_variant_id
  );

  insert into public.job_parts
    (job_id, product_id, variant_id, quantity, unit_cost, stock_movement_id, added_by)
  values (p_job_id, p_product_id, p_variant_id, p_quantity, v_cost_price, v_movement_id, p_staff_id)
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.add_job_part is
  'The one correct way to attach a stocked part to a job. Consumes stock (the variation''s, when named) and snapshots its cost.';

create function public.add_job_misc_part(
  p_job_id uuid, p_name text, p_quantity integer, p_unit_cost pence default null,
  p_staff_id uuid default null)
returns uuid
language plpgsql
as $function$
declare
  v_id uuid;
begin
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'A miscellaneous part needs a name';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be positive, got %', p_quantity;
  end if;

  insert into public.job_parts (job_id, name, quantity, unit_cost, cost_pending, added_by)
  values (p_job_id, btrim(p_name), p_quantity, coalesce(p_unit_cost, 0), p_unit_cost is null, p_staff_id)
  returning id into v_id;

  return v_id;
end;
$function$;

create function public.set_job_part_cost(p_part_id uuid, p_cost pence)
returns void
language plpgsql
as $function$
begin
  update public.job_parts
     set unit_cost = p_cost, cost_pending = false
   where id = p_part_id and cost_pending;
  if not found then
    raise exception 'That part already has its cost recorded';
  end if;
end;
$function$;
