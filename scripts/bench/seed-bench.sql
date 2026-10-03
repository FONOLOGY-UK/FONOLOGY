-- Synthetic shop for the stage-2 baseline: ~400 products (a quarter with
-- variants), 3000 till sales, 300 orders. Runs ONLY against the throwaway
-- `fonology_bench` database (scripts/bench/run.mjs creates it) — never the
-- real local one. Everything goes through complete_sale()/create_order(), so
-- the rows are the ones the app itself would write.
\set ON_ERROR_STOP on

do $$
declare
  cats text[] := array['cases','power','audio','protection','mounts','mobiles'];
  c text; cid uuid; pid uuid; i int; n int := 0;
begin
  if exists (select 1 from products where slug = 'bench-1') then return; end if;
  for i in 1..400 loop
    c := cats[1 + (i % 6)];
    select id into cid from categories where slug = c;
    insert into products (slug, name, sub, description, kind, category, price, cost_price, stock_qty,
                          barcode, category_id, has_variants, is_active, compatibility)
    values ('bench-' || i, 'Bench product ' || i, 'sub ' || i, 'Description of bench product ' || i,
            'accessory', case when c = 'mobiles' then 'cases' else c end::product_category,
            500 + (i * 37) % 4000, 150 + (i * 13) % 1500, 20 + i % 40,
            '5000' || lpad(i::text, 9, '0'), cid, (i % 4 = 0), true, 'iPhone 13, iPhone 14')
    returning id into pid;
    if i % 4 = 0 then
      for n in 1..3 loop
        insert into product_variants (product_id, options, sku, barcode, price_adjustment, cost_price, stock_qty, is_active)
        values (pid, jsonb_build_object('Colour', (array['Black','Blue','Red'])[n]),
                'BENCH-' || i || '-' || n, '6000' || lpad((i*10+n)::text, 9, '0'), 0, 150 + (i * 13) % 1500, 30, true);
      end loop;
    end if;
  end loop;
end $$;

-- 3000 sales: 1-3 lines each, cash or card (pos1), spread over the last 120 days.
do $$
declare
  staff uuid := (select id from staff where role = 'employee' limit 1);
  prods uuid[]; p record; lines jsonb; total int; k int; s int; sid uuid;
begin
  select array_agg(id) into prods from products where slug like 'bench-%' and not has_variants;
  for s in 1..3000 loop
    lines := '[]'::jsonb; total := 0;
    for k in 1..(1 + s % 3) loop
      select id, price into p from products where id = prods[1 + (s * 7 + k * 31) % array_length(prods, 1)];
      lines := lines || jsonb_build_object('product_id', p.id, 'quantity', 1, 'unit_price', p.price, 'list_price', p.price);
      total := total + p.price;
    end loop;
    sid := complete_sale(staff, lines,
      jsonb_build_array(jsonb_build_object('tender', case when s % 3 = 0 then 'pos1' else 'cash' end, 'amount', total)), 0, null);
    update sales set created_at = now() - (s % 120) * interval '1 day' - (s % 600) * interval '1 minute' where id = sid;
  end loop;
end $$;

-- Keep stock positive for later sales/queries.
update products set stock_qty = 1000 where slug like 'bench-%';
update product_variants set stock_qty = 1000;

-- 300 online orders (guest, delivery) in mixed states.
do $$
declare
  prods uuid[]; p record; s int; oid uuid;
begin
  if (select count(*) from orders) >= 300 then return; end if;
  select array_agg(id) into prods from products where slug like 'bench-%' and not has_variants;
  for s in 1..300 loop
    select id, price into p from products where id = prods[1 + (s * 11) % array_length(prods, 1)];
    oid := create_order(jsonb_build_array(jsonb_build_object('product_id', p.id, 'quantity', 1 + s % 2)),
                        'collect', null, ('guest' || s || '@bench.test')::citext, 'Guest ' || s,
                        null, null, null, null, null, 0, null, 'stripe');
    update orders set created_at = now() - (s % 90) * interval '1 day',
                      status = 'paid',
                      paid_at = now() - (s % 90) * interval '1 day'
     where id = oid;
    if s % 3 = 0 then update orders set status = 'ready' where id = oid; end if;
  end loop;
end $$;

-- 150 refunds against till sales (full-amount, cash).
do $$
declare staff uuid := (select id from staff where role = 'employee' limit 1); r record;
begin
  if exists (select 1 from refunds) then return; end if;
  for r in select id, subtotal - discount as amt from sales order by created_at desc limit 150 loop
    perform create_refund(staff, r.amt, 'cash', 'bench refund', '[]'::jsonb, r.id);
  end loop;
end $$;

-- A few suppliers and photos, so list endpoints exercise those lookups too.
do $$
declare sid uuid;
begin
  if exists (select 1 from suppliers where name = 'Bench Supplier') then return; end if;
  insert into suppliers (name) values ('Bench Supplier') returning id into sid;
  update products set supplier_id = sid where slug like 'bench-%' and substring(slug from 7)::int % 3 = 0;
  insert into product_images (product_id, url, position)
    select id, 'https://example.test/' || slug || '-' || n || '.jpg', n
      from products, generate_series(0, 1) n where slug like 'bench-%' and substring(slug from 7)::int % 2 = 0;
end $$;
