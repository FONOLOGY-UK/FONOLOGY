-- 0080 — Add 'day_report' to print_job_kind
-- Its own file, deliberately tiny, for the same reason 0012 is: Postgres will
-- not let a new enum value be referenced — in a CHECK, a function body,
-- anywhere — inside the transaction that adds it. Every file here is applied
-- as one implicit transaction, so this has to commit before 0081 can use it.
--
-- Change request item 7. A day report is a RECEIPT-target print: it comes off
-- the eposnow POS80GXa, not the label roll.
--
-- Note what this does NOT change: expire_print_leases() decides whether an
-- abandoned job may be auto-requeued by TARGET, not by kind, so a day report
-- inherits the receipt rule — a lease that expires with the on-disk marker
-- present becomes `unconfirmed` and waits for a person, rather than
-- auto-reprinting. That is stricter than a day summary strictly needs (a
-- duplicate summary is harmless, unlike a duplicate sale receipt, which looks
-- like return fraud), but it is the safe direction and it keeps the
-- asymmetry a per-target rule rather than a growing per-kind table.

alter type public.print_job_kind add value 'day_report';
