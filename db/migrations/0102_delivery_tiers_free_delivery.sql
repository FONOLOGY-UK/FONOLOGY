-- 0102 — Delivery tiers, remote postcodes and free delivery over a threshold
-- ---------------------------------------------------------------------------
-- Client change request (October 2026, "Fonology Remaining Features" #2/#3):
--
--   Standard delivery, mainland UK            £3.00
--   Next-day delivery, mainland UK only       £5.50  (standard + £2.50)
--   Standard delivery, remote + Channel Is.   £5.50  (standard + £2.50)
--   Next-day to a remote postcode             not offered
--   Free delivery when the goods come to MORE than £50.00 (exactly £50.00
--   does not qualify) — mainland standard only; next-day and the remote rate
--   are still charged.
--
-- The remote list is the one the sister shop's checkout already uses (Jeez
-- Mart, apps/api/src/lib/deliveryPricing.ts), widened to deliver the Channel
-- Islands and the Isle of Man as remote — Jeez Mart refuses those, the client's
-- spec delivers them. BFPO addresses are refused outright.
--
-- What changes in the functions:
--
--   * delivery_zone_for() matched a stored prefix against the START of the
--     outward code, so a stored 'PH3' would also have caught PH30-PH39. The new
--     list has single districts like PH3, so it now matches the outward code,
--     the district (outward without a trailing sub-district letter) or the bare
--     area letters — never a partial district number. Longest match still wins.
--   * delivery_quote() returned a NULL fee when a rate row was missing. A rate
--     can now be switched off (delivery_rates.available), and an unavailable or
--     missing rate is an error, so remote next-day is refused by the database —
--     not just hidden on the checkout screen.
--   * delivery_quote() requires a postcode for anything but collect: a direct
--     API call with no postcode used to be priced as mainland.
--   * The fee logic moves into delivery_quote_detail(), which also returns the
--     goods subtotal and whether delivery came out free; delivery_quote() keeps
--     its signature and return type, so create_order() (0099) is untouched and
--     still charges exactly what the checkout showed.
--
-- Prices and postcodes stay rows, editable from the admin Delivery screen.

-- ---------------------------------------------------------------------------
-- Settings and rate availability
-- ---------------------------------------------------------------------------

alter table public.shop_settings
  add column free_delivery_threshold pence not null default 5000
    constraint shop_settings_free_delivery_threshold_nonnegative check (free_delivery_threshold >= 0);

comment on column public.shop_settings.free_delivery_threshold is
  'Goods subtotal (pence) that must be EXCEEDED for free mainland standard delivery. Strictly greater than: at exactly this amount delivery is still charged.';

alter table public.delivery_rates
  add column available boolean not null default true;

comment on column public.delivery_rates.available is
  'False = this method is not offered to this zone; delivery_quote refuses it.';

update public.delivery_zones
   set label = 'Remote areas & Channel Islands'
 where code = 'remote';

update public.delivery_rates dr
   set price = v.price, available = v.available
  from public.delivery_zones dz,
       (values
         ('standard', 'standard'::delivery_method, 300, true),
         ('standard', 'next_day'::delivery_method, 550, true),
         ('remote',   'standard'::delivery_method, 550, true),
         ('remote',   'next_day'::delivery_method, 550, false)
       ) as v(zone_code, method, price, available)
 where dz.id = dr.zone_id
   and dz.code = v.zone_code
   and dr.method = v.method;

-- ---------------------------------------------------------------------------
-- Remote postcodes
-- ---------------------------------------------------------------------------

delete from public.delivery_postcode_prefixes
 where zone_id = (select id from public.delivery_zones where code = 'remote');

-- Whole postcode areas.
insert into public.delivery_postcode_prefixes (prefix, zone_id)
select p, (select id from public.delivery_zones where code = 'remote')
  from unnest(array[
    'BT',             -- Northern Ireland
    'HS',             -- Outer Hebrides
    'IV',             -- Inverness / Highlands
    'KW',             -- Caithness, Orkney
    'ZE',             -- Shetland
    'GY', 'JE',       -- Channel Islands
    'IM'              -- Isle of Man
  ]) as p;

-- Single districts inside otherwise-mainland areas, one row each.
insert into public.delivery_postcode_prefixes (prefix, zone_id)
select r.area || n, (select id from public.delivery_zones where code = 'remote')
  from (values
         ('AB', 35, 38), ('AB', 53, 56),            -- Aberdeenshire
         ('FK', 17, 22),                            -- Stirling / Trossachs
         ('KA', 27, 28),                            -- Arran, Cumbrae
         ('PA', 17, 18), ('PA', 20, 38), ('PA', 41, 80),  -- Argyll and the islands
         ('PH',  3,  3), ('PH',  5,  7), ('PH', 10, 11), ('PH', 13, 50),  -- Highland Perthshire
         ('PO', 30, 33), ('PO', 35, 41),            -- Isle of Wight
         ('TR', 21, 25)                             -- Isles of Scilly
       ) as r(area, low, high),
       generate_series(r.low, r.high) as n;

-- ---------------------------------------------------------------------------
-- Zone lookup — whole outward code, district, or area; never a partial number
-- ---------------------------------------------------------------------------

create or replace function public.delivery_zone_for(p_postcode text)
returns uuid
language plpgsql
stable
as $$
declare
  v_clean    text;
  v_outward  text;
  v_district text;
  v_area     text;
  v_zone_id  uuid;
begin
  v_clean := upper(regexp_replace(coalesce(p_postcode, ''), '\s+', '', 'g'));

  if length(v_clean) < 5 then
    return (select id from public.delivery_zones where code = 'standard');
  end if;

  -- UK inward code is always exactly 3 characters (digit + 2 letters).
  v_outward  := left(v_clean, length(v_clean) - 3);
  v_district := substring(v_outward from '^[A-Z]{1,2}[0-9]+');
  v_area     := substring(v_outward from '^[A-Z]{1,2}');

  select zone_id into v_zone_id
    from public.delivery_postcode_prefixes
   where prefix in (v_outward, v_district, v_area)
   order by length(prefix) desc
   limit 1;

  return coalesce(v_zone_id, (select id from public.delivery_zones where code = 'standard'));
end;
$$;

comment on function public.delivery_zone_for is
  'UK postcode -> delivery zone id. A stored prefix matches the whole outward code, the district (PH3 matches PH3 only, not PH30) or the bare area (BT). Longest match wins; unrecognised postcodes fall back to standard.';

-- ---------------------------------------------------------------------------
-- The fee, with its reasons
-- ---------------------------------------------------------------------------

create function public.delivery_quote_detail(
  p_lines           jsonb,   -- [{"product_id": "...", "variant_id": null, "quantity": 2}, ...]
  p_delivery_method delivery_method,
  p_postcode        text default null
)
returns table (delivery_fee pence, zone_code text, subtotal pence, free_delivery boolean)
language plpgsql
stable
as $$
declare
  v_line       jsonb;
  v_product    public.products;
  v_variant_id uuid;
  v_unit_price pence;
  v_subtotal   pence := 0;
  v_all_free   boolean := true;
  v_clean      text;
  v_zone_id    uuid;
  v_zone_code  text;
  v_price      pence;
  v_available  boolean;
  v_threshold  pence;
  v_fee        pence := 0;
  v_free       boolean := false;
begin
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A quote needs at least one line';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_line ->> 'product_id')::uuid;
    if not found then
      raise exception 'Product % not found', v_line ->> 'product_id';
    end if;
    if not v_product.free_delivery then
      v_all_free := false;
    end if;

    -- Priced exactly as create_order (0099) prices the line.
    v_variant_id := nullif(v_line ->> 'variant_id', '')::uuid;
    v_unit_price := coalesce(public.online_unit_price(v_product.id, v_variant_id), v_product.price);
    v_subtotal := v_subtotal + v_unit_price * (v_line ->> 'quantity')::integer;
  end loop;

  if p_delivery_method <> 'collect' then
    v_clean := upper(regexp_replace(coalesce(p_postcode, ''), '\s+', '', 'g'));
    if v_clean like 'BFPO%' or v_clean ~ '^BF[0-9]' then
      raise exception 'We can''t deliver to BFPO addresses.';
    end if;

    v_zone_id := public.delivery_zone_for(p_postcode);
    select code into v_zone_code from public.delivery_zones where id = v_zone_id;

    select price, available into v_price, v_available
      from public.delivery_rates
     where zone_id = v_zone_id and method = p_delivery_method;
    if not found or not v_available then
      raise exception '% delivery isn''t available to this postcode.',
        case p_delivery_method when 'next_day' then 'Next-day' else 'Standard' end;
    end if;

    select free_delivery_threshold into v_threshold from public.shop_settings limit 1;

    if v_all_free then
      v_free := true;
    elsif v_zone_code = 'standard' and p_delivery_method = 'standard'
          and v_threshold is not null and v_subtotal > v_threshold then
      v_free := true;
    else
      v_fee := v_price;
    end if;
  end if;

  return query select v_fee, v_zone_code, v_subtotal, v_free;
end;
$$;

comment on function public.delivery_quote_detail is
  'delivery_quote plus the goods subtotal and whether delivery came out free (every line free_delivery, or mainland standard over shop_settings.free_delivery_threshold). Refuses an unavailable method and BFPO.';

-- Same signature and return type as 0021, so create_order keeps calling it unchanged.
create or replace function public.delivery_quote(
  p_lines           jsonb,
  p_delivery_method delivery_method,
  p_postcode        text default null
)
returns table (delivery_fee pence, zone_code text)
language plpgsql
stable
as $$
begin
  if p_delivery_method <> 'collect' and btrim(coalesce(p_postcode, '')) = '' then
    raise exception 'A delivery postcode is required.';
  end if;

  return query
    select d.delivery_fee, d.zone_code
      from public.delivery_quote_detail(p_lines, p_delivery_method, p_postcode) d;
end;
$$;

comment on function public.delivery_quote is
  'What create_order charges for delivery. Requires a postcode unless collecting. Logic lives in delivery_quote_detail.';

-- Every delivery method for a postcode's zone, with what this basket would pay
-- for it — null (and available = false) where the method isn't offered there.
create function public.delivery_options(
  p_lines    jsonb,
  p_postcode text default null
)
returns table (method delivery_method, available boolean, delivery_fee pence)
language plpgsql
stable
as $$
declare
  v_rate record;
  v_fee  pence;
begin
  for v_rate in
    select dr.method, dr.available
      from public.delivery_rates dr
     where dr.zone_id = public.delivery_zone_for(p_postcode)
       and dr.method <> 'collect'
     order by dr.method
  loop
    v_fee := null;
    if v_rate.available then
      select d.delivery_fee into v_fee
        from public.delivery_quote_detail(p_lines, v_rate.method, p_postcode) d;
    end if;
    method := v_rate.method;
    available := v_rate.available;
    delivery_fee := v_fee;
    return next;
  end loop;
end;
$$;

comment on function public.delivery_options is
  'Delivery methods offered to a postcode''s zone and this basket''s fee for each (null when not offered). Drives the checkout''s method picker.';
