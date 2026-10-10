-- Round 3 #2.2/#2.4: a cancelled mail-in job can now be posted back.
--
-- Two things needed for that:
--   1. `jobs` gains `courier` (mirrors `orders.courier` from 0049) — required
--      alongside the tracking number before ANY job reaches `sent_back`, not
--      only one reached from `cancelled`. Existing done->sent_back jobs never
--      recorded a courier at all; this closes that gap too, not just the new
--      path.
--   2. `job_status_allowed_next('cancelled')` gains `sent_back` — previously
--      empty, by deliberate design (see 0013's comment on this function):
--      cancelled was a permanent dead end so a job could never quietly
--      pretend it had actually finished, and any deposit already taken goes
--      back through create_refund(p_job_id => ...), never through this
--      table. That protection is about MONEY, and this migration doesn't
--      touch it: refunds still only ever happen through create_refund(),
--      completely independent of what `jobs.status` says. This only lets
--      the STATUS record "the device genuinely went back in the post after
--      the repair was called off" — which is a true fact worth recording,
--      not a way to un-cancel a job or move money.
--
--   `cancelled` is deliberately NOT given `collected` here — a cancelled
--   walk-in staying at `status = 'cancelled'` (with `device_returned`
--   flipped to true) is enough to answer "has the customer got their phone
--   back", and the API layer already has that path from BUG-15-followup
--   #12. Only mail-in genuinely needs a status that means "left the
--   building", because unlike a walk-in, nobody is standing at the counter
--   to hand it over — the tracking number is the only proof it left.
--
--   `cancellation_reason` is never cleared by this move (this migration
--   doesn't touch it, and neither does any UPDATE that only sets status +
--   courier + tracking) — so a job that went cancelled -> sent_back still
--   carries its cancellation_reason forever. That's what lets the app show
--   a "Cancelled" badge on it in the archive even once its status reads
--   sent_back, instead of it quietly looking like an ordinary successful
--   repair.

alter table public.jobs add column courier text;

create or replace function public.job_status_allowed_next(p_status job_status)
returns job_status[]
language sql
immutable
as $$
  select case p_status
    when 'new'              then array['in_progress', 'cancelled']::job_status[]
    when 'in_progress'      then array['waiting_approval', 'done', 'cancelled']::job_status[]
    when 'waiting_approval' then array['in_progress', 'cancelled']::job_status[]
    when 'done'             then array['sent_back', 'collected']::job_status[]
    -- Round 3 #2.4: the one addition. A cancelled MAIL-IN job (source is
    -- checked below, same as every other sent_back move) can be posted
    -- back — nothing else changes about a cancelled job's dead-end status.
    when 'cancelled'        then array['sent_back']::job_status[]
    else array[]::job_status[]
  end;
$$;

comment on function public.job_status_allowed_next is
  'cancelled is reachable from new, in_progress and waiting_approval, and can now ALSO move on to sent_back (Round 3 #2.4) — mail-in only, still requiring courier + tracking number, same as any other sent_back move — for a device that is genuinely posted back after the repair itself was called off. It cannot reach collected or done; those still mean the repair actually succeeded. Any deposit already taken is returned through create_refund(p_job_id => ...), not through this table, and this change does not touch that path.';

create or replace function public.validate_job_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (new.status = any (public.job_status_allowed_next(old.status))) then
    raise exception 'Job % cannot move from % to %', old.reference, old.status, new.status;
  end if;

  if new.status = 'waiting_approval' and new.revised_quote is null then
    raise exception 'Job % needs a revised quote before it can wait on approval', old.reference;
  end if;

  if old.status = 'waiting_approval' and new.status = 'in_progress'
     and (new.revised_quote_approved_by is null or new.revised_quote_approved_at is null) then
    raise exception 'Job % cannot resume without recording who approved the revised quote', old.reference;
  end if;

  if new.status = 'sent_back' then
    if new.source <> 'mail_in' then
      raise exception 'Only a mail-in job can be sent back — % is %', old.reference, new.source;
    end if;
    if new.return_tracking_number is null then
      raise exception 'Job % needs a return tracking number before it can be sent back', old.reference;
    end if;
    -- Round 3 #2.2: courier is required alongside the tracking number for
    -- EVERY move to sent_back, not only the new cancelled -> sent_back one —
    -- a tracking number with no carrier to look it up on was always half an
    -- answer, this just closes the gap for done -> sent_back too.
    if new.courier is null or btrim(new.courier) = '' then
      raise exception 'Job % needs a courier name before it can be sent back', old.reference;
    end if;
  end if;

  if new.status = 'collected' and new.source = 'mail_in' then
    raise exception 'A mail-in job is sent back, not collected — % is mail-in', old.reference;
  end if;

  return new;
end;
$$;
