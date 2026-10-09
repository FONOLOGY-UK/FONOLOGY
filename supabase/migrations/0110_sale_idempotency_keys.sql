-- 0110 — Till sale idempotency keys
--
-- POST /pos/sales had no duplicate protection: if the browser's request reached the API but the response
-- was lost (a dropped connection, a double tap), the cashier retried and the sale was recorded twice —
-- stock taken twice, cash counted twice, two receipts.
--
-- The till now sends one key per attempt. The API reserves the key (this table's primary key makes the
-- reservation atomic: two requests with the same key cannot both get it), runs complete_sale(), then
-- records the sale against the key. A repeat of the same key returns the sale already made instead of
-- making another. A failed sale releases its key so the retry can go through.
--
-- Additive only: a new table; nothing existing changes. complete_sale() is untouched.

create table public.sale_idempotency_keys (
  shop_id    uuid        not null references public.shops (id),
  key        text        not null check (char_length(key) between 8 and 100),
  sale_id    uuid        references public.sales (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shop_id, key)
);

create index sale_idempotency_keys_created_idx on public.sale_idempotency_keys (created_at);
create index sale_idempotency_keys_sale_idx on public.sale_idempotency_keys (sale_id);

comment on table public.sale_idempotency_keys is
  'One row per till sale attempt key. sale_id is null while the sale is being made and set once it exists. Rows older than a few days are deleted by the purge job; they only matter for retries within minutes.';

alter table public.sale_idempotency_keys enable row level security;
alter table public.sale_idempotency_keys force row level security;
