-- 0062 — Product reviews (Round 5 Phase 4 #21)
--
-- DELIBERATELY separate from `reviews` (0053 — the homepage testimonials,
-- hand-curated by the client, real Google review text). This table is
-- customer-submitted, per-product, gated on having actually bought the
-- thing. Different provenance, different moderation model, different
-- audience — merging them would blur "the client's hand-picked homepage
-- voice" with "whatever a customer typed after checkout", which is exactly
-- the mixing the task said to avoid.
--
-- THE CORE RULE: only a customer who actually bought this product may
-- review it, once. Enforced server-side, at the DATABASE level, not just
-- the API — a trigger checks real order history before the insert is even
-- allowed to land, so this can't be bypassed by any future caller that
-- forgets to check first.
--
-- "Purchased" is scoped to ONLINE orders only (orders.customer_id), because
-- that's the only purchase path in this schema with customer attribution at
-- all — a POS till sale has no customer_id (sale_lines was never given one;
-- the till doesn't require an account, matching the standing "customer
-- accounts stay optional" rule). A customer who only ever bought a product
-- in-store cannot review it here; there is no reliable way to link them to
-- that sale.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

create table public.product_reviews (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  customer_id  uuid not null references public.customers (id) on delete cascade,
  rating       smallint not null check (rating between 1 and 5),
  -- Length-capped here too, not just at the API boundary (basic anti-spam,
  -- per the task) — a wall-of-text review can't reach the table at all,
  -- regardless of what wrote it.
  body         text not null check (char_length(btrim(body)) between 1 and 2000),

  -- Every review lands pending. No "rejected" state — the task's own words
  -- are "approves or deletes": a review that shouldn't be public is
  -- removed outright, not kept around in a third state nobody reads.
  is_approved  boolean not null default false,
  approved_by  uuid references public.staff (id) on delete set null,
  approved_at  timestamptz,

  created_at   timestamptz not null default now(),

  -- One review per product per customer — the DB's own guarantee, not just
  -- a check the API remembers to run first.
  constraint product_reviews_one_per_customer unique (product_id, customer_id),

  constraint product_reviews_approval_consistency check (
    (is_approved = false and approved_by is null and approved_at is null)
    or (is_approved = true and approved_by is not null and approved_at is not null)
  )
);

create index product_reviews_product_idx
  on public.product_reviews (product_id, created_at desc)
  where is_approved;

create index product_reviews_customer_idx on public.product_reviews (customer_id);

create index product_reviews_pending_idx
  on public.product_reviews (created_at)
  where not is_approved;

create index product_reviews_approved_by_idx
  on public.product_reviews (approved_by)
  where approved_by is not null;

comment on table public.product_reviews is
  'Customer-submitted, per-product reviews — purchase-verified, moderated. Kept separate from reviews (0053, the homepage testimonials) on purpose; see this file''s header.';

alter table public.product_reviews enable row level security;
alter table public.product_reviews force  row level security;

-- ---------------------------------------------------------------------------
-- Purchase verification — the actual enforcement
-- ---------------------------------------------------------------------------

create or replace function public.customer_purchased_product(p_customer_id uuid, p_product_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id
    where o.customer_id = p_customer_id
      and ol.product_id = p_product_id
      -- Genuinely happened, not still pending payment and not cancelled —
      -- same "did this actually complete" bar order_status_allowed_next
      -- treats 'paid' as crossing (0005).
      and o.status not in ('pending', 'cancelled')
  );
$$;

comment on function public.customer_purchased_product is
  'Whether a customer has a real (paid-or-further, not cancelled) online order containing this product. Scoped to orders only — POS sale_lines carries no customer_id in this schema, so an in-store purchase can''t be verified here. The one thing product_reviews_require_purchase actually checks before allowing a review.';

create or replace function public.product_reviews_require_purchase()
returns trigger
language plpgsql
as $$
begin
  if not public.customer_purchased_product(new.customer_id, new.product_id) then
    raise exception 'You can only review a product you have bought from us';
  end if;
  return new;
end;
$$;

create trigger product_reviews_require_purchase
  before insert on public.product_reviews
  for each row execute function public.product_reviews_require_purchase();

comment on trigger product_reviews_require_purchase on public.product_reviews is
  'The actual server-side enforcement of "only customers who purchased may review" — fires before ANY insert, regardless of which API route or future caller wrote it.';
