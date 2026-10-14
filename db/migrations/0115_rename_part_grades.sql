-- 0115 — Part grades renamed everywhere (VPS testing report, FON-004):
--   OEM  -> Premium
--   Copy -> Budget
--   Original stays Original.
--
-- The grade names live in the repair_sub_types table (the admin's list, 0109) and, for the old fixed
-- lookup, repair_part_tiers. Every screen, receipt, email and report reads the name from there, so
-- renaming the rows renames existing jobs and requests too (they point at the row, they do not copy
-- the name). Only the exact old names are touched: a grade the admin already renamed is left alone.
-- The internal keys (legacy_tier 'oem' / 'copy', the part_tier enum) are not shown to anyone and
-- stay as they are.

update public.repair_sub_types
   set name = 'Premium'
 where legacy_tier = 'oem' and name = 'OEM';

update public.repair_sub_types
   set name = 'Budget'
 where legacy_tier = 'copy' and name = 'Copy';

update public.repair_part_tiers set name = 'Premium' where id = 'oem' and name = 'OEM';
update public.repair_part_tiers set name = 'Budget' where id = 'copy' and name = 'Copy';
