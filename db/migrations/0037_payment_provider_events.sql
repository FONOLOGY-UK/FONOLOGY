-- 0037 — payment_provider_events: the reconciliation log for online payments
-- ---------------------------------------------------------------------------
-- 0030 deferred this table on purpose, and wrote down what had to be answered
-- before anyone built it:
--
--   "what provider payloads get stored, for how long, and do they contain
--    cardholder PII? That is a retention and data-protection question, not a
--    schema question."
--
-- Those are answered here, and the answers shape the table.
--
-- WHAT GETS STORED: EXTRACTED FIELDS, NEVER THE RAW PAYLOAD
--
-- A raw Stripe webhook body carries the customer's name, email, billing
-- address and card last4 — a second, uncontrolled copy of personal data that
-- the orders table already holds under its own retention rules. Storing the
-- payload would mean every webhook silently re-created customer PII in a table
-- nobody purges, which is precisely the failure 0020 exists to prevent for ID
-- documents.
--
-- So this table stores only what reconciliation actually needs: which event,
-- which order, which provider reference, how much, and what the outcome was.
-- No name, no email, no address, no card last4, no brand, no raw JSON.
--
-- HOW LONG: INDEFINITELY, AND THAT IS THE POINT
--
-- There is deliberately no purge job here, and that is a consequence of the
-- decision above rather than an omission. Once no personal data is stored, the
-- rows are financial records — "£24.00 against FNL-10047, intent pi_x,
-- succeeded" — and a shop needs those to answer "did this order's money
-- actually arrive" years later. Adding a 30-day purge would delete the
-- accounting trail to protect PII that was never written in the first place.
-- If anyone later adds a column carrying personal data, that decision changes
-- and this table needs the 0020 treatment; the comment on the table says so.
--
-- IDEMPOTENCY IS THE WHOLE JOB
--
-- Stripe guarantees at-least-once delivery: it retries a webhook until it gets
-- a 2xx, and it will happily deliver the same event twice on its own. The
-- unique index on (provider, event_id) is what makes a replay a no-op, and it
-- is enforced by the DATABASE rather than by a check-then-insert in the
-- handler, because check-then-insert loses the race against a concurrent
-- retry of the same event. The handler inserts and treats a unique violation
-- as "already handled", which is the only version of this that is correct
-- under concurrency.
--
-- Note the order status machine is independently idempotent for the same
-- reason (0005's validate_order_status_transition returns early when the
-- status is unchanged), so a duplicate that somehow got past this table still
-- could not double-consume stock. Two independent guards, deliberately.
--
-- Applied to the DEV project only, per the standing hard rule.

create table public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),

  -- Same two values as orders.payment_provider, and constrained the same way,
  -- so an event can never claim a provider an order could not have used.
  provider text not null check (provider in ('stripe', 'clearpay')),

  -- The provider's own event id (Stripe: evt_...). The idempotency key.
  event_id text not null,

  -- e.g. 'payment_intent.succeeded', 'payment_intent.payment_failed'. Stored
  -- as text rather than an enum: the set of events we subscribe to will change
  -- without a migration, and an unknown value here must be recordable rather
  -- than rejected — an event we failed to classify is exactly the one worth
  -- having a row for.
  event_type text not null,

  -- Nullable on purpose. An event that cannot be matched to an order is the
  -- single most important thing this table can tell anyone (money moved and we
  -- do not know what for), so it must be RECORDABLE, not rejected by a foreign
  -- key. A null here is a row for a human to look at, not a bug to hide.
  order_id uuid references public.orders (id) on delete set null,

  -- The provider's payment reference (Stripe: pi_...). Opaque identifier, not
  -- personal data. Mirrored onto orders.provider_reference when a payment
  -- succeeds — here it is the event's own record of it, there it is the
  -- order's current one.
  provider_reference text,

  -- What the PROVIDER says was charged, in integer pence like every other
  -- money value in this schema. Kept separate from orders.total precisely so
  -- the two can be compared: this column existing is what makes "Stripe took a
  -- different amount than we asked for" a detectable condition rather than an
  -- invisible one.
  amount pence,
  currency text,

  -- The outcome as the provider reported it, plus the decline reason when
  -- there is one. failure_code/message are Stripe's own machine and human
  -- strings ('card_declined' / 'Your card was declined.') — neither identifies
  -- a person or a card.
  status text,
  failure_code text,
  failure_message text,

  -- When the webhook arrived, and when our handler finished acting on it. Two
  -- columns because they answer different questions: received_at proves
  -- delivery, processed_at proves we did something about it. A row with
  -- received_at and no processed_at is a webhook that arrived and then
  -- something went wrong — worth being able to find.
  received_at timestamptz not null default now(),
  processed_at timestamptz,

  constraint payment_provider_events_event_unique unique (provider, event_id)
);

-- 001_structure.sql asserts schema-wide that every foreign key column has a
-- covering index. order_id is the only FK here.
create index payment_provider_events_order_idx
  on public.payment_provider_events (order_id);

-- The reconciliation read: "what happened to this payment intent", and the
-- operational read: "what arrived and never got processed".
create index payment_provider_events_reference_idx
  on public.payment_provider_events (provider_reference)
  where provider_reference is not null;

create index payment_provider_events_unprocessed_idx
  on public.payment_provider_events (received_at)
  where processed_at is null;

comment on table public.payment_provider_events is
  'Online payment events from Stripe/Clearpay, as EXTRACTED FIELDS ONLY — never the raw webhook payload, which carries customer name, email, address and card last4. Because no personal data is stored, these rows are financial records and are deliberately kept indefinitely with no purge job. If a column carrying personal data is ever added here, that reasoning breaks and this table needs the same retention treatment as order_documents (0020).';

comment on column public.payment_provider_events.event_id is
  'The provider''s event id. Unique per provider — this is the idempotency key that makes a redelivered webhook a no-op. Enforced by the unique index rather than by a check-then-insert in the handler, which would lose the race against a concurrent retry.';

comment on column public.payment_provider_events.order_id is
  'Nullable on purpose: an event we cannot match to an order must still be recorded. Money that moved with no known order is the most important thing this table can surface.';

comment on column public.payment_provider_events.amount is
  'What the PROVIDER reported charging, integer pence. Deliberately separate from orders.total so a mismatch between what we asked for and what was taken is detectable.';
