-- 0120 — Checking and flagging the change log (client changes, October 2026, #4).
--
-- An admin can mark each entry of the inventory change log (0104) as checked (reviewed, a green
-- tick) or flagged (worth looking into), and filter the log by Checked / Flagged / Unchecked / All.
--
-- The log itself stays immutable (0104's trigger refuses any UPDATE or DELETE), so the decision
-- lives beside it, one row per entry: no row = unchecked. Changing a decision replaces the row,
-- and clearing it deletes the row; the row says who decided and when, by id and by name at the
-- time, like the log does.

create table public.inventory_change_reviews (
  change_id   uuid primary key references public.inventory_change_log (id),
  status      text not null check (status in ('checked', 'flagged')),
  staff_id    uuid not null references public.staff (id),
  staff_name  text not null,
  reviewed_at timestamptz not null default now()
);

create index inventory_change_reviews_status_idx on public.inventory_change_reviews (status);

alter table public.inventory_change_reviews enable row level security;
alter table public.inventory_change_reviews force row level security;

comment on table public.inventory_change_reviews is
  'An admin''s decision on one change-log entry (0120): checked or flagged. No row = unchecked. The log itself is never edited.';
