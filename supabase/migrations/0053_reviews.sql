-- Round 3 follow-up #4: real reviews, in a real table.
--
-- BACKGROUND — worth keeping, because the history here is easy to get wrong
-- a second time. `apps/web/src/lib/data/mock/reviews.ts` has held 8 REAL
-- Google reviews for this business since 21 Jul 2026 (commit 6290add,
-- "supplied by Tanoli", quoted verbatim including typos) — not invented
-- demo copy. They never reached the live site because `listReviews()` on
-- the HTTP adapter was `notImplemented()`: no table, no endpoint. A later
-- commit (4f085b6) added a guard so the homepage section cleanly renders
-- nothing rather than an empty 414px hole when the list comes back empty —
-- correct behaviour, and left alone here. This migration is what makes the
-- guard's happy path real: give it something to find.
--
-- `reviews.manage` (0052, its own file — see that file's header) is the
-- permission gating the admin CRUD in admin.routes.ts. Owner-only by
-- default, same tier as settings.manage/staff.manage — this is homepage
-- marketing content, not an everyday till task the way labels.manage is.

create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  -- First name + last initial, matching the site's existing style — never
  -- a full name, never verified against anything (there's nowhere to
  -- verify a review against; see the note on this in the DMCC Act comment
  -- that used to live on the frontend guard, still true here).
  name        text not null,
  -- What was fixed/bought. Nullable: a review that doesn't say.
  device      text,
  -- The review text itself. Called `body` here (not `text` — matches the
  -- frontend's own Review.text field) mainly so `text` stays free for a
  -- future full-text-search column without a rename.
  body        text not null,
  rating      smallint not null check (rating between 1 and 5),
  -- Off by default would mean every future add is invisible until someone
  -- remembers to flip it — the opposite of what "the client can maintain
  -- these without a developer" should feel like. On by default, with an
  -- explicit unpublish for the one case that actually needs hiding
  -- something (a review pulled at the client's request, a duplicate, etc).
  published   boolean not null default true,
  -- Admin-controlled display order, ascending. Not `created_at` — the
  -- client may well want their favourite review first regardless of when
  -- it was added.
  sort_order  integer not null default 0,
  -- Set only for a review added through the admin UI — the 8 seeded below
  -- came from Tanoli's transcription, not a staff account, so this stays
  -- null for them. Never required: nothing here needs to know who typed a
  -- review in for it to display correctly.
  created_by  uuid references public.staff (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index reviews_published_sort_idx
  on public.reviews (published, sort_order)
  where published;

create trigger reviews_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

comment on table public.reviews is
  'Customer reviews shown on the homepage. Real content only — the DMCC Act 2024 bans publishing fabricated or unverifiable reviews, which is exactly why this table exists instead of the frontend falling back to invented mock copy.';

alter table public.reviews enable row level security;
alter table public.reviews force  row level security;

-- ---------------------------------------------------------------------------
-- The 8 real reviews, exactly as they've sat in the mock adapter since
-- 21 Jul 2026 — same names, same wording, same typos ("iphone" lowercase,
-- "wasn't"/"couldn't" as typed, no Oxford comma cleanup). Anyone tempted to
-- tidy these: don't — see this file's header and mock/reviews.ts's own
-- comment. sort_order mirrors their original array order (rev-1..rev-8).
-- ---------------------------------------------------------------------------

insert into public.reviews (name, device, body, rating, published, sort_order) values
  ('Emma D.', 'iPhone 13 screen', 'Took my wee boys iphone 13 in to this shop to get fixed this morning, the phone was smashed to pieces front and back, the battery had expanded pushing the screen out. The phone was in a right sorry state. Got a message a few hours later to say the phone was ready for collection much to my delight. When I picked it up it looked like a brand new phone! My wee boy is over the moon. Great service and very friendly staff, will definitely use this shop again!', 5, true, 1),
  ('Dillon M.', 'Phone repair', 'Fixed my phone in 20 mins easy and fast service would recommend', 5, true, 2),
  ('Nicole W.', 'iPad screen', 'Fixed my little ones smashed ipad in less than an hour for an affordable price, very happy and saved lots of tiny tears', 5, true, 3),
  ('Sarah W.', 'MacBook repair', 'The best place! Really helped me when I was having problems with my MacBook - so quick and affordable and amazing communication. On top of that, the staff are so friendly and kind. Would recommend to everyone & anyone :)', 5, true, 4),
  ('Hasnat R.', 'Screen replacement', 'Was quoted £50 to repair the screen on my phone which was much cheaper than others and the job was done in 30 mins! Zak and his team are a delight to deal with and would highly recommend them', 5, true, 5),
  ('Steven C.', 'Charging port', 'Great service phone wasn’t charging go it fixed and back the the same day at a reasonable price and the guys couldn’t be more helpful', 5, true, 6),
  ('Thomas B.', 'Screen + accessories', 'These guys replaced my smashed phone screen. A competitive price and they threw in a screen protector, a phone cover and a magnetic holder. First class friendly service and would definitely recommend.', 5, true, 7),
  ('Manjit J.', 'Charging issue', 'Fastest and great service. Had some charging issues with my phone but it was ok within 10-15 minutes thanks Zak and team.', 5, true, 8);

-- ---------------------------------------------------------------------------
-- Grants — the enum value from 0052 is safe to use now that it's in a
-- separate, already-committed migration.
-- ---------------------------------------------------------------------------

-- Existing owner-role staff in dev get it immediately, same as any other
-- management permission would if it had existed when their account was
-- created — `default_permissions()` only runs on INSERT, so this is the
-- one-time backfill for accounts that already exist.
insert into public.staff_permissions (staff_id, permission)
select id, 'reviews.manage'::permission from public.staff where role = 'owner'
on conflict do nothing;

-- Every owner account created from here on gets it by default, same tier as
-- settings.manage/staff.manage. Not added to the employee branch — see the
-- header comment on why this isn't an everyday till permission.
create or replace function public.default_permissions(p_role staff_role)
returns permission[]
language sql
immutable
as $$
  select case p_role
    when 'owner' then array[
      'pos.operate','jobs.manage','inventory.manage','promotions.manage',
      'cash.manage','tradein.manage','sales.today','costs.view','analytics.view',
      'payments.view','reports.view','returns.manage','labels.manage',
      'staff.manage','settings.manage','reviews.manage'
    ]::permission[]
    else array[
      'pos.operate','jobs.manage','inventory.manage','labels.manage',
      'cash.manage','tradein.manage','sales.today'
    ]::permission[]
  end;
$$;
