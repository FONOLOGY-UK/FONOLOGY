-- 0095 — the `manager` staff role (stage 3, multi-shop).
--
-- Its own file for the same reason as 0012 and 0052: Postgres won't let a freshly
-- added enum value be used in the transaction that added it, and 0096 uses it.

alter type staff_role add value if not exists 'manager';
