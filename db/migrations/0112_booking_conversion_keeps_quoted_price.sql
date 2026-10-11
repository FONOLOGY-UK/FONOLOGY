-- A repair request keeps the price the customer was quoted when it becomes a job.
--
-- 0109 made the quote floor ("staff can quote more, never less") apply when a job is first inserted.
-- convert_booking_to_job() inserts the job at the request's quoted price, so once the shop raised a
-- device's price, every request booked at the older, lower price stopped converting:
--   "That quote is below the shop price for this repair (£99.00). Staff can quote more, never less."
-- The customer had been quoted £89 by the site and the shop could not honour it.
--
-- The floor exists to stop STAFF quoting below the shop price. A price the website itself quoted to the
-- customer is not a staff quote. So when a job is inserted from a request and its quote equals the
-- request's quoted price, that quote is exempt from the floor. Everything else is unchanged: a different
-- quote on the same job, a revised quote, and any job not created from a request are still checked.
--
-- The only change from 0109's version is the `v_from_booking` exemption.

create or replace function public.validate_job_quote_floor()
returns trigger
language plpgsql
as $$
declare
  v_floor   pence;
  v_quote   boolean := tg_op = 'INSERT' or new.quoted_price is distinct from old.quoted_price;
  v_revised boolean := tg_op = 'INSERT' or new.revised_quote is distinct from old.revised_quote;
  v_from_booking boolean := false;
begin
  if not (v_quote or v_revised) then
    return new;
  end if;
  v_floor := public.job_quote_floor(new);
  if v_floor is null then
    return new;
  end if;

  -- The request's own price, as quoted to the customer, is honoured.
  if tg_op = 'INSERT' and new.booking_id is not null and new.quoted_price is not null then
    select b.quoted_price = new.quoted_price into v_from_booking
      from public.bookings b
     where b.id = new.booking_id;
    v_from_booking := coalesce(v_from_booking, false);
  end if;

  if v_quote and not v_from_booking and new.quoted_price is not null and new.quoted_price < v_floor then
    raise exception
      'That quote is below the shop price for this repair (£%). Staff can quote more, never less.',
      trim(to_char(v_floor / 100.0, 'FM9999990.00'))
      using errcode = 'check_violation';
  end if;

  if v_revised and new.revised_quote is not null and new.revised_quote < v_floor then
    raise exception
      'That revised quote is below the shop price for this repair (£%). Staff can quote more, never less.',
      trim(to_char(v_floor / 100.0, 'FM9999990.00'))
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
