-- 0012 — Add 'cancelled' to job_status
-- Its own file, deliberately tiny. Postgres will not let a new enum value be
-- referenced — in a CHECK constraint, a function body, anywhere — inside the
-- same transaction that adds it. Every file in this migration set is applied
-- as one implicit transaction (one client.query() per file), so the value
-- has to land in a commit of its own before 0013 can use it in the job
-- status machine, a CHECK constraint, and the cancellation trigger.

alter type public.job_status add value 'cancelled';
