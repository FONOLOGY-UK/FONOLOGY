-- 0089 - A till session that can never reach the Admin dashboard
-- ---------------------------------------------------------------------------
-- Change request item 4 (the doc's A4), and specifically its SECURITY
-- RESTRICTION: "Fast PIN-switching must be strictly limited to the Till/POS
-- dashboard. It cannot be used to access the Admin dashboard — Admin access
-- must always require a standard, full login."
--
-- WHY A COLUMN EXISTS AT ALL
--
-- Because that restriction cannot be met by not building a button. PIN
-- switching hands someone a real, working session on the strength of four
-- digits. If that session is indistinguishable from one obtained with an
-- email and a password, then "it cannot be used to access Admin" is a
-- statement about which screens have a link on them, which is not a security
-- control — the API is reachable directly, and the whole point of this
-- project's permission model is that the UI gate is never the real one.
--
-- So the session itself is marked, and the API refuses the admin surface for
-- a marked session regardless of what permissions the person holds. An owner
-- who PIN-switches into the till gets the till; to reach Admin they sign in
-- properly, exactly as the doc requires.
--
-- WHAT MAKES THE MARK UNDROPPABLE
--
-- On its own a column would not be enough: the marker is read via the
-- `fnl_staff_session` cookie, and a session whose cookie is simply deleted
-- would come back unmarked. That is closed in resolveSession (lib/session.ts)
-- by making the staff_sessions row MANDATORY for every staff request —
-- a staff auth session with no live row is now no session at all, rather
-- than an unlocked, unmarked one.
--
-- That is a hardening in its own right and closes a second, pre-existing
-- hole: the PIN lock is stored on this same row, so before this change
-- deleting that one cookie also lifted the lock. Both now fail the same
-- way — logged out, which is the safe direction.
--
-- HOW A SWITCH LEAVES THE FIRST PERSON
--
-- Their session is ENDED, not parked. ended_at is stamped and their auth
-- tokens are revoked, so attribution stays unambiguous: every sale, every
-- payment, every job note belongs to whoever was actually signed in, with no
-- window where two people share a device and one of them is dormant. The
-- cost, accepted deliberately: a half-built ticket on screen is discarded
-- when the account changes. Parking the first session instead would mean two
-- live sessions per device, which the row-per-device model that the idle
-- lock and Admin/POS routing both depend on does not have.

alter table public.staff_sessions
  add column pos_only boolean not null default false;

comment on column public.staff_sessions.pos_only is
  'Change request item 4. True when this session was obtained by PIN-switching at the till rather than by a full email-and-password sign-in. The API refuses the entire admin surface for such a session, whatever permissions the person holds — the doc requires that Admin always needs a real login, and a restriction enforced only by not drawing a link is not a restriction. Cannot be shed by deleting the cookie: resolveSession treats a staff request with no live staff_sessions row as unauthenticated.';

-- Finding a device's live session is what a switch does first (to end it) and
-- what the account picker needs. Partial: ended sessions are the vast
-- majority of the table over time and are never the one being looked for.
create index staff_sessions_live_idx
  on public.staff_sessions (staff_id)
  where ended_at is null;
