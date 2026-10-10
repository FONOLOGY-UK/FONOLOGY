-- Round 3 follow-up #4: adds the `reviews.manage` permission ahead of the
-- reviews table itself (0053).
--
-- Its own file, on purpose — same reason 0012 exists as a standalone
-- migration: Postgres refuses to let a freshly-added enum value be used
-- (in a CHECK, a function body, an INSERT, anything) inside the same
-- transaction that added it. 0053 both creates the reviews admin routes'
-- permission grants AND rewrites `default_permissions()` to include this
-- value — either of those in the same file as the ALTER TYPE below would
-- fail with "unsafe use of new value of enum type".

alter type permission add value 'reviews.manage';
