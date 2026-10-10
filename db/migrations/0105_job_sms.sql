-- 0105 — Text the customer at each stage of a repair job
-- ---------------------------------------------------------------------------
-- Client change request (October 2026, "Fonology Remaining Features" #1): an
-- SMS at every stage of a repair job, through Brevo, with the wording editable
-- per stage AND per shop from a new admin tab. Jobs only: an online repair
-- booking is texted once it has been converted into a job. Every stage sends by
-- default; each can be switched off.
--
--   jobs.sms_updates      the customer's own opt-out, per job (default on).
--   job_sms_templates     one row per (shop, stage). shop_id null is the default
--                         every shop falls back to; a shop row overrides it.
--   job_sms_log           every text the API tried to send — sent, failed, or
--                         skipped with the reason (switched off, no mobile,
--                         SMS not configured) — so the counter can see whether
--                         the customer was told, and resend.
--
-- Sending happens in the API after the status change has committed
-- (lib/jobSms.ts), never inside the database: a provider outage must not
-- block or roll back a repair moving on. Phone numbers and message bodies in
-- the log are personal data: purge-sms-log blanks them after 180 days.

alter table public.jobs
  add column sms_updates boolean not null default true;

comment on column public.jobs.sms_updates is
  'Text the customer at each stage (0105). The customer''s opt-out; on by default.';

create table public.job_sms_templates (
  id          uuid primary key default gen_random_uuid(),
  -- Null: the default for every shop without its own wording for this stage.
  shop_id     uuid references public.shops (id),
  status      job_status not null,
  enabled     boolean not null default true,
  body        text not null check (length(btrim(body)) between 1 and 612),
  updated_by  uuid references public.staff (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint job_sms_templates_shop_status_unique unique nulls not distinct (shop_id, status)
);

create index job_sms_templates_updated_by_idx on public.job_sms_templates (updated_by);

create trigger job_sms_templates_updated_at
  before update on public.job_sms_templates
  for each row execute function public.set_updated_at();

comment on table public.job_sms_templates is
  'SMS wording per repair stage, per shop (shop_id null = the default). Placeholders: {firstName} {customerName} {jobNumber} {device} {status} {quote} {shopName} {shopPhone} {courier} {tracking}.';

-- Plain GSM-7 text (no curly quotes or dashes) so each fits one or two SMS parts.
insert into public.job_sms_templates (shop_id, status, body) values
  (null, 'new',
   'Hi {firstName}, we''ve booked in your {device} at {shopName}. Your job number is {jobNumber}. We''ll text you as it moves along.'),
  (null, 'in_progress',
   'Hi {firstName}, we''ve started work on your {device} (job {jobNumber}). We''ll let you know when it''s done.'),
  (null, 'waiting_approval',
   'Hi {firstName}, your {device} needs your OK before we carry on. The updated price is {quote}. Please call us on {shopPhone}. Job {jobNumber}.'),
  (null, 'done',
   'Hi {firstName}, good news - your {device} is repaired and ready. Job {jobNumber}. {shopName}, {shopPhone}.'),
  (null, 'sent_back',
   'Hi {firstName}, your {device} is on its way back to you with {courier}. Tracking: {tracking}. Job {jobNumber}.'),
  (null, 'collected',
   'Thanks for collecting your {device}, {firstName}. Any problems, call us on {shopPhone}. {shopName}'),
  (null, 'cancelled',
   'Hi {firstName}, your repair job {jobNumber} has been cancelled. Any questions, call us on {shopPhone}.');

create type sms_state as enum ('sent', 'failed', 'skipped');

create table public.job_sms_log (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs (id) on delete cascade,
  shop_id             uuid not null references public.shops (id),
  status              job_status not null,
  -- As sent, 447… — blanked by purge-sms-log after 180 days.
  to_phone            text,
  body                text,
  state               sms_state not null,
  -- Why it was skipped or failed, in words.
  reason              text,
  provider_message_id text,
  staff_id            uuid references public.staff (id),
  created_at          timestamptz not null default now()
);

create index job_sms_log_job_idx on public.job_sms_log (job_id, created_at desc);
create index job_sms_log_shop_idx on public.job_sms_log (shop_id, created_at desc);
create index job_sms_log_staff_idx on public.job_sms_log (staff_id);
create index job_sms_log_created_idx on public.job_sms_log (created_at);

comment on table public.job_sms_log is
  'Every repair-stage text the API tried to send: sent, failed or skipped with the reason. Phone and body are blanked after 180 days.';

alter table public.job_sms_templates enable row level security;
alter table public.job_sms_templates force row level security;
alter table public.job_sms_log enable row level security;
alter table public.job_sms_log force row level security;
