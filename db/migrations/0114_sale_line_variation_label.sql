-- A till sale line for a variation product now carries the variation in its name.
--
-- Online order lines have always been snapshotted as "Aegis Soft Case — M, Black" (0061), but complete_sale()
-- copied only the product name, so a till sale of the same item read "Aegis Soft Case" on the receipt, the sales
-- list and any refund made against it — staff could not tell which size or colour went out.
--
-- Rather than rewrite complete_sale(), a BEFORE INSERT trigger adds the label the same way create_order() builds
-- it: the option values, comma-joined. A name that already has a label (" — ") is left alone, so a later change
-- to complete_sale() that does it itself cannot double up. Existing rows are history and are not touched.

create or replace function public.sale_lines_label_variation()
returns trigger
language plpgsql
as $$
declare
  v_label text;
begin
  if new.variant_id is null or position(' — ' in new.name) > 0 then
    return new;
  end if;

  select string_agg(value::text, ', ')
    into v_label
    from public.product_variants v, jsonb_each_text(v.options)
   where v.id = new.variant_id;

  if v_label is not null and v_label <> '' then
    new.name := new.name || ' — ' || v_label;
  end if;
  return new;
end;
$$;

create trigger sale_lines_label_variation
  before insert on public.sale_lines
  for each row execute function public.sale_lines_label_variation();
