-- 0035 — Refunds get their own customer-facing reference.
--
-- WHY THIS EXISTS
-- The refund receipt (print kind `refund_receipt`) is a document the customer
-- keeps, and until now a refund had nothing to identify itself by. Every other
-- customer-facing record in this schema mints one through issue_reference():
-- orders (0005), bookings and jobs (0006), sell requests and trade-in payouts
-- (0007), sales (0008). `refunds` (0008) was the one that did not.
--
-- The API papered over that by BORROWING the original sale's or order's
-- reference (toApiRefund in pos.routes.ts). On screen that reads fine. On paper
-- it breaks, and specifically on PARTIAL refunds: refund £20 of a £60 sale on
-- Monday and £15 more on Thursday, and the customer holds two receipts printed
-- with the same FNL- number, differing only by date and amount. Neither the
-- shop nor the customer can quote a number that identifies which one they mean,
-- because nothing indexes a refund by it.
--
-- The receipt therefore carries BOTH: this refund's own REF- number, and the
-- original sale reference it was taken against. They answer different
-- questions — "which refund is this" and "which sale did it come out of".
--
-- WHY A NEW PREFIX
-- `BUY-` already exists for trade-in payouts (0007) on the reasoning that money
-- going OUT stays visibly separate from money coming in. A refund is also money
-- out, and telling a REF- from an FNL- at a glance across a counter is the
-- whole point of a prefix. It draws from the same reference_seq, so the numbers
-- are still globally unique.
--
-- Additive only, per the standing rule: a column, a backfill, a trigger. No
-- existing statement is altered and no existing row loses anything.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

alter table public.refunds
  add column if not exists reference text;

-- ---------------------------------------------------------------------------
-- Backfill, before the NOT NULL
-- ---------------------------------------------------------------------------
-- Existing dev refunds pre-date the column. They get real references from the
-- same function rather than a synthesised placeholder — a fabricated
-- "REF-LEGACY-1" would be a reference that issue_reference() never issued and
-- reference_registry has never heard of, which is exactly the thing the hard
-- rule about issue_reference() exists to prevent.
--
-- Ordered by created_at so the numbers run in the same direction as the
-- refunds themselves. Guarded on reference is null so re-running is a no-op.

do $$
declare
  r record;
begin
  for r in
    select id from public.refunds where reference is null order by created_at
  loop
    update public.refunds
       set reference = public.issue_reference('refund', r.id, 'REF')
     where id = r.id;
  end loop;
end;
$$;

alter table public.refunds
  alter column reference set not null;

-- Matches the uniqueness every other reference column has. reference_registry
-- already makes a duplicate impossible at the source; this makes it impossible
-- here too, which is where a query would actually hit it.
create unique index if not exists refunds_reference_unique_idx
  on public.refunds (reference);

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
-- BEFORE INSERT, exactly like trade_in_payouts_set_reference (0007). The row's
-- `id` default is applied before BEFORE triggers fire, so new.id is a real uuid
-- here — the same thing every other reference trigger in this schema relies on.
--
-- Note create_refund() (0008/0013) is NOT modified. It inserts into refunds and
-- the trigger fires underneath it, so the function keeps working unchanged and
-- there is no second code path that could forget to mint one.

create or replace function public.refunds_set_reference()
returns trigger
language plpgsql
as $$
begin
  -- Only when the caller has not supplied one. Nothing supplies one today; the
  -- guard means a future backfill or data import cannot be silently renumbered.
  if new.reference is null then
    new.reference := public.issue_reference('refund', new.id, 'REF');
  end if;
  return new;
end;
$$;

drop trigger if exists refunds_issue_reference on public.refunds;
create trigger refunds_issue_reference
  before insert on public.refunds
  for each row execute function public.refunds_set_reference();

comment on column public.refunds.reference is
  'This refund''s own customer-facing reference, REF- series, from issue_reference(). Distinct from the original sale/order reference the refund was taken against — a partial refund needs both to be identifiable on paper.';
