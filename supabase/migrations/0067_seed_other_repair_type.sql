-- 0067 — Bug fix: the repair form's "Other" problem path was unreachable
--
-- Client report #3: after picking a phone, the problem-selection step
-- needs an "Other, describe it yourself" option. The frontend code for it
-- already existed (apps/web/src/components/storefront/repair/repair-flow.tsx)
-- but compared the selected repair_types.id — a real uuid — against the
-- literal string 'other', which can never be true. Unlike the device step
-- (whose "Other / not listed" tile is a real seeded devices row with
-- brand = 'other', a genuine category column), repair_types has no
-- category column to key a catch-all off — so the fix is a real seeded
-- catch-all row, at a fixed, reserved id matching this project's existing
-- pattern for special seeded rows (00000000-0000-0000-0000-0000000bNNNN),
-- which the frontend now matches directly instead of the never-true
-- literal comparison.
--
-- Diagnosis-only, like "Water damage diagnosis": base_price_* all null, so
-- `repair_types_all_or_no_pricing` is satisfied and the frontend's own
-- isDiagnosis rule ("free to look") applies — there is no fixed price for
-- a problem nobody has described yet.
--
-- Applied to the DEV project (ohkvwqqtppvnxbvvdsfr) only.

insert into public.repair_types (
  id, name, description, estimate_label,
  base_price_original, base_price_oem, base_price_copy, is_active
) values (
  '00000000-0000-0000-0000-0000000b5099',
  'Something else',
  'Not sure what it is? Tell us and we''ll take a look — free diagnosis.',
  'Free diagnosis',
  null, null, null, true
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  estimate_label = excluded.estimate_label,
  base_price_original = excluded.base_price_original,
  base_price_oem = excluded.base_price_oem,
  base_price_copy = excluded.base_price_copy,
  is_active = excluded.is_active;
