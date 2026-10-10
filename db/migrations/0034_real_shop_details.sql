-- 0034 — The shop's REAL contact details and opening hours.
--
-- Until now the codebase carried placeholder details copied from the design
-- prototype: "01234 567 890", "Unit 4, The Parade, High Street, Yourtown
-- YT1 2AB". They appeared in FIVE independent places, one of which was the
-- schema.org LocalBusiness JSON-LD that Google reads for search and Maps, and
-- another of which was the API's default Brevo sender address — so customer
-- email would have gone out FROM an address that does not exist.
--
-- These values were cross-checked against the shop's own live site plus three
-- independent directories before being written down. The locality
-- (Thornliebank) came out of that check; the brief had it missing.
--
-- Weekday closing is 19:00, taken from the shop's own Google Business Profile,
-- which they control. Several scraped directories say 18:00 and are stale.
-- Saturday and Sunday agree across every source.
--
-- The trading name is "Fonology" — NOT "Zakaso Limited T/A Fonology".
-- Client-confirmed, and consistent with their own site.
--
-- Applied to the DEV project only, per the standing hard rule.

-- Guarded on shop_address being unset so that re-applying this to an
-- environment where an owner has already edited their own details cannot
-- clobber them. On a fresh database the guard is always true and this simply
-- seeds the row 0009 created.
update public.shop_settings
   set shop_name    = 'Fonology',
       shop_address = '61c Main Street, Thornliebank, Glasgow, G46 7RX',
       shop_phone   = '+44 141 374 0365',
       shop_email   = 'info@fonology.co.uk',
       opening_hours = '[
         {"day": "Mon", "open": "09:30", "close": "19:00", "closed": false},
         {"day": "Tue", "open": "09:30", "close": "19:00", "closed": false},
         {"day": "Wed", "open": "09:30", "close": "19:00", "closed": false},
         {"day": "Thu", "open": "09:30", "close": "19:00", "closed": false},
         {"day": "Fri", "open": "09:30", "close": "19:00", "closed": false},
         {"day": "Sat", "open": "10:00", "close": "17:00", "closed": false},
         {"day": "Sun", "open": null,    "close": null,    "closed": true}
       ]'::jsonb,
       -- The receipt's standing small print.
       --
       -- NOTE what is deliberately NOT in here: the returns window. That stays
       -- generated from return_window_days at render time, so the printed
       -- promise can never drift from the value the refund screen actually
       -- enforces. Putting "30 days" into free text would recreate exactly the
       -- bug this whole pass exists to kill — except in a column an owner can
       -- edit, which is worse.
       receipt_footer_text = 'Repairs carry a 90-day warranty. Void if the device suffers physical or liquid damage.'
 where shop_address is null;

comment on column public.shop_settings.opening_hours is
  'Trading hours, one entry per day: {"day","open","close","closed"}. Read by the storefront, the JSON-LD Google indexes, and the print agent health check (which uses it to tell "shop is shut" from "agent is down"). Times are Europe/London wall-clock.';
