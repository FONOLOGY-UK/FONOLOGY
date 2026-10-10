-- 0081 - A job with money still owed cannot be handed back to the customer
-- ---------------------------------------------------------------------------
-- Change request item 14. Reproduced on dev before writing this: job
-- FNL-10602, quoted 12000p, one 2000p deposit recorded, moved done ->
-- collected and accepted with 10000p still outstanding. The API's
-- /jobs/:id/status handler checked the per-status paperwork requirements (a
-- revised quote for waiting_approval, tracking + courier for sent_back, a
-- reason for cancelled) and never once looked at the balance;
-- job_status_allowed_next('done') = ['sent_back', 'collected'] is
-- unconditional, so nothing below it looked either. The device goes out of
-- the door and the debt is only discoverable by reading job_payments by hand.
--
-- WHAT COUNTS AS OWED
--
-- Exactly what lib/jobPayments.ts getJobOutstanding() computes, deliberately
-- so — two definitions of "outstanding" that can disagree is the whole class
-- of bug this project keeps hitting:
--
--   target = coalesce(revised_quote, quoted_price)
--   paid   = sum(job_payments.amount)
--   owed   = target - paid
--
-- `deposit_amount` is NOT used. It freezes once payment_status reaches 'paid'
-- (0006_repairs.sql:483-486, deliberate) and can understate the real total
-- from then on, which would make this guard quietly pass jobs it should stop.
--
-- TWO CASES THAT ARE DELIBERATELY NOT BLOCKED
--
-- 1. target is null — the job was never quoted at all. "Blank = on diagnosis"
--    is a real, supported state of a job (see the quote field's own
--    placeholder on the Add Job screen), and a free look-over or a goodwill
--    no-charge repair genuinely owes nothing. There is no figure to check
--    against, so there is nothing to refuse. Blocking here would make it
--    impossible to hand back a device the shop decided not to charge for.
--
-- 2. old.status = 'cancelled' — 0051 allows cancelled -> sent_back so a
--    mail-in device can be posted back after the repair was called off. The
--    customer is not paying for a repair that never happened, and any deposit
--    already taken goes back through create_refund(p_job_id => ...), never
--    through this table (0051's own comment). Requiring payment before the
--    shop is allowed to return someone's phone would be exactly backwards.
--
-- WHY A TRIGGER AND NOT ONLY THE ROUTE
--
-- The route gets the same check a moment earlier, because a 409 that names
-- the figure is far better to read than a raised exception. But this is money
-- leaving the shop, and every other money invariant in this schema is proved
-- by the database rather than trusted to a caller. The route check is the
-- friendly message; this is the one that is actually load-bearing.

create or replace function public.validate_job_handover_is_paid()
returns trigger
language plpgsql
as $$
declare
  v_target pence;
  v_paid   pence;
  v_owed   bigint;
begin
  -- Only the two moves that put the device back in the customer's hands, and
  -- only when the status is genuinely changing (a no-op update to an already
  -- collected job must not start failing).
  if new.status not in ('collected', 'sent_back') or new.status = old.status then
    return new;
  end if;

  -- Case 2 above: posting a cancelled repair's device back owes nothing.
  if old.status = 'cancelled' then
    return new;
  end if;

  v_target := coalesce(new.revised_quote, new.quoted_price);

  -- Case 1 above: never quoted, nothing to check against.
  if v_target is null then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.job_payments
  where job_id = new.id;

  v_owed := v_target::bigint - v_paid::bigint;

  if v_owed > 0 then
    -- Pounds only at the display layer, and only here, in a message a person
    -- reads. Everything above this line is integer pence.
    raise exception
      'Job % still owes £%. Take the remaining payment before marking it %.',
      new.reference,
      trim(to_char(v_owed / 100.0, 'FM9999990.00')),
      case new.status when 'collected' then 'collected' else 'posted back' end
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.validate_job_handover_is_paid is
  'Change request item 14. Refuses done -> collected / done -> sent_back while coalesce(revised_quote, quoted_price) exceeds sum(job_payments.amount). Same arithmetic as lib/jobPayments.ts getJobOutstanding(), on purpose. Two exemptions: a job that was never quoted (target null) owes nothing to check, and cancelled -> sent_back is a device being posted back after the repair was called off, where any deposit returns through create_refund() instead.';

-- Triggers fire in name order, and 'jobs_validate_unpaid_handover' sorts after
-- 'jobs_validate_status_transition' (0006:335) — so an illegal move is
-- reported as an illegal move rather than as an unpaid one.
create trigger jobs_validate_unpaid_handover
  before update on public.jobs
  for each row execute function public.validate_job_handover_is_paid();
