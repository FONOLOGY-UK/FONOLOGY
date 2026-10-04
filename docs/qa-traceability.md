# QA reports → tests

Every item in QA's five bug reports (v1–v5), where it is proven, and the ones that cannot be proven by a
script. The specs live in `packages/e2e/tests/` and run with `pnpm --filter @fonology/e2e e2e`
(see `docs/tester-guide.md`). A test number below means "the Nth test in that file".

**Legend:** ✅ proven by an automated browser/API test · 🔎 needs a human's eyes (look/feel) ·
⚠️ the app does something different from the report — a product decision is needed · 🚧 cannot be tested on a laptop.

Spec short names: **money** = `regression-money-two-shops`, **jobs** = `regression-jobs`,
**store** = `regression-storefront`, **prod** = `regression-admin-products`, **staff** = `regression-staff-panel`,
**cust** = `regression-customer-account`, **cfg** = `regression-admin-config`, **rep** = `regression-reports-views`,
**extra** = `regression-extras`, **acct** = `customer-accounts`, **refund** = `till-refund`.

## Both shops — the part to check first

| What                                                                                                          | Test                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Shop 1 price, 2+ tier, 5+ tier at the till; climbs back down as the quantity drops                            | money 1                                                                                         |
| 10% discount comes off the bulk-priced subtotal; the server charges the same figure                           | money 2                                                                                         |
| Shop 2 has its own price (£45) and no bulk deal; split cash + card adds to the penny                          | money 3                                                                                         |
| Each shop's takings are separate; "All shops" is at least their sum; Shop 2 cannot widen its view             | money 4                                                                                         |
| A refund in Shop 2 puts one unit back on Shop 2's shelf and leaves Shop 1 alone                               | money 5                                                                                         |
| Stock typed as 70 saves 70; inline +/- persists; cost is what was typed (no averaging)                        | money 6                                                                                         |
| Online order: hub shelf first, rest from Shop 2, priced at the highest shop price; courier + tracking to ship | money 7, 8                                                                                      |
| Shop isolation of lists, money, staff, promotions, master list                                                | `till-and-shops`, `owner-admin-clickthrough`, `crawl-every-screen`, `e2e-shops.ts` (165 checks) |
| A new shop with no float asks its counter person for one; the Admin is never asked                            | staff 1, 2                                                                                      |
| Day close: expected cash = float + cash sales + cash repairs − refunds − payouts, per shop                    | `e2e-test.ts` §9                                                                                |

## Report v1 (August 20)

| ID           | Item                                                                                 | Status                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BUG-01       | Global inventory crash after a product with images                                   | ✅ prod 3 (three photos at once, crop tool, list still loads)                                                                                                      |
| BUG-02       | Lock screen unreliable                                                               | ✅ staff 7 (locks 3 times in a row)                                                                                                                                |
| BUG-03       | Passcode rejected after ~20 min locked                                               | ✅ staff 7 (25-minute wait on the page clock). A genuinely expired _server_ session shows a "sign in again" message instead of a silent rejection (`pin-lock.tsx`) |
| BUG-04       | Delete = retired; retired out of low-stock                                           | ✅ prod 4                                                                                                                                                          |
| FEATURE-05   | Categories / sub-categories managed in the admin                                     | ✅ prod 2                                                                                                                                                          |
| FEATURE-06   | "In-store only" toggle                                                               | ✅ prod 1; `owner-admin-clickthrough` 5                                                                                                                            |
| BUG-07/08/09 | Cancel a job; cancelled jobs can be collected / posted back                          | ✅ jobs 3, 4, 5                                                                                                                                                    |
| FEATURE-10   | Add a mail-in job                                                                    | ✅ jobs 2                                                                                                                                                          |
| FEATURE-11   | Jobs screen redesign                                                                 | 🔎 subjective                                                                                                                                                      |
| BUG-12       | Online orders workflow (no manual "paid", no "ready to collect", courier + tracking) | ✅ cfg 5, money 7                                                                                                                                                  |
| FEATURE-13   | Counter Sales view                                                                   | ✅ rep 1                                                                                                                                                           |
| BUG-14       | Float pop-up only for counter staff                                                  | ✅ staff 1, 2                                                                                                                                                      |

## Report v2

| ID             | Item                                                                                      | Status                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #15            | Several photos at once hang / crash inventory                                             | ✅ prod 3                                                                                        |
| #2, #3, #4, #6 | Online Orders: no Awaiting-payment box, "Unfulfilled", only To fulfill / All, date filter | ✅ cfg 5                                                                                         |
| #7, #8         | No "Online" jobs filter; one search bar in list view                                      | ✅ jobs 1                                                                                        |
| #10            | Mail-in job without a booking                                                             | ✅ jobs 2                                                                                        |
| #12            | Cancelled walk-in is not auto-collected                                                   | ✅ jobs 3                                                                                        |
| #13, #14       | Finished jobs go to an Archive; cancelled ones keep a "Cancelled" badge                   | ✅ jobs 4, 5                                                                                     |
| #1             | Custom date range made the filter bar jump                                                | ✅ rep 3 — **fixed in this round** (the header bottom-aligned a taller picker)                   |
| #5             | Useless "/" box in search bars                                                            | ✅ staff 6                                                                                       |
| #11            | See customers' forms                                                                      | ✅ rep 5 (Repair Requests), `shop-floor` E (Sell In Requests)                                    |
| #9             | Retired products out of the job-parts picker                                              | ✅ prod 4 — **fixed in this round**: the API now refuses a retired part too, not just the picker |

## Report v3

| ID      | Item                                                                         | Status                                                                                                                 |
| ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1.1     | Order filters freeze the app                                                 | ✅ cfg 5                                                                                                               |
| 1.2     | Online orders must take stock and appear in the admin                        | ✅ money 7, 8; `customer-journeys` 3–4                                                                                 |
| 1.3     | Returns search finds a real order number                                     | ✅ extra 1                                                                                                             |
| 2.1–2.5 | Mail-in: no booking link, courier name, simpler cancel, "Post back", archive | ✅ jobs 2–5                                                                                                            |
| 3.1     | Toggle button padding                                                        | 🔎 visual                                                                                                              |
| 3.2     | Badge shows type only                                                        | ✅ jobs 6                                                                                                              |
| 3.3     | No scrollbars inside columns                                                 | ✅ jobs 6                                                                                                              |
| 4.1     | Stock checked on add; postcode on entry; no promo code                       | ✅ store 4, 5                                                                                                          |
| 5.1     | Photos standardised to 1500×1500                                             | ✅ prod 3                                                                                                              |
| 5.2     | Product page image is a square, undistorted                                  | ✅ extra 2                                                                                                             |
| 6.1     | Testimonials on the homepage                                                 | ✅ rep 6 — the section is shown only when there are approved reviews; it is never filled with made-up ones (by design) |

## Report v4

| ID              | Item                                                  | Status                                                                                                                                 |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-01          | Google sign-in                                        | 🚧 needs real Google credentials; the local API runs the whole flow but cannot be pointed at Google                                    |
| BUG-02          | Mobile layout                                         | ✅ `responsive` (phone / tablet widths: no sideways scroll on public, admin and till). 🔎 how it _looks_                               |
| BUG-03          | Stock + postcode checked early                        | ✅ store 4, 5                                                                                                                          |
| BUG-04          | No promo code                                         | ✅ store 5                                                                                                                             |
| BUG-05          | Valid UK postcodes rejected                           | ✅ `postcode.test.ts` (31 cases) + store 6 (server quotes every shape)                                                                 |
| BUG-06          | No Click & collect                                    | ✅ store 5                                                                                                                             |
| BUG-07          | Sell form "Other" device asks for the model           | ✅ cust 5. ⚠️ the report says the text box is _required_; the app makes it _optional_ ("Which phone? (optional)") like the Repair form |
| FEAT-01         | Device Models admin; forms follow at once             | ✅ cfg 1 — **fixed in this round** (the API told browsers to cache the list for 60 s; it now always revalidates)                       |
| BUG-08 / BUG-09 | Stock +/- persists; typed stock saves exactly         | ✅ money 6                                                                                                                             |
| FEAT-02         | In-store only hides photo upload                      | ✅ prod 1                                                                                                                              |
| BUG-10          | Retired: Restore + edits save                         | ✅ prod 4                                                                                                                              |
| FEAT-03 / 04    | "Repair Requests", "Sell In Requests" names and place | ✅ staff 6                                                                                                                             |
| BUG-11          | No "Ready to collect"; View details                   | ✅ cfg 5                                                                                                                               |
| BUG-12          | Add staff: password; "Admin" label                    | ✅ staff 5                                                                                                                             |
| BUG-13          | Nested-button hydration error                         | ✅ jobs 5 (any console error fails the test)                                                                                           |

## Report v5

| ID     | Item                                                     | Status                                                                                                                                                                                               |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #34    | Orders stuck "unconfirmed" — Stripe webhook              | ✅ the signed webhook route is exercised by money 7/8, store 7, cust 1, cfg 3/5. 🚧 real delivery from Stripe needs the live server and the webhook set up in Stripe's dashboard (`docs/go-live.md`) |
| #24    | Create account → confirm → sign in works                 | ✅ acct 1–3                                                                                                                                                                                          |
| #36    | UK time, not the device's                                | ✅ staff 2 (a device on Pakistan time at its midnight is not asked again)                                                                                                                            |
| #26    | Reset link points at localhost                           | ✅ the API refuses to boot in production with the localhost default (`config.ts`); `go-live-check.mjs` scans for it                                                                                  |
| #25    | Message on a wrong customer password                     | ✅ acct 4                                                                                                                                                                                            |
| #27    | "Account does not exist" on an unknown email             | ⚠️ **deliberately not done**: the reset form answers the same for every address so nobody can discover who has an account. Tell QA, or decide to change it                                           |
| #7     | Staff/Owner stopped at the final step, with a reason     | ✅ store 8, cust 7 — **fixed in this round**: the message was below the fold; it now scrolls into view                                                                                               |
| #9     | Search finds plurals / partial words                     | ✅ store 1                                                                                                                                                                                           |
| #10    | Sub-category filters                                     | ✅ store 2                                                                                                                                                                                           |
| #17    | PDP: badge, compatibility, description in Details        | ✅ store 3                                                                                                                                                                                           |
| #18    | Photo lightbox                                           | ✅ extra 3                                                                                                                                                                                           |
| #21    | Verified reviews, held for approval                      | ✅ cust 4                                                                                                                                                                                            |
| #22    | Customer dashboard (orders, address book)                | ✅ cust 1, 2                                                                                                                                                                                         |
| #23    | Track by Order ID only → courier + tracking              | ✅ store 7                                                                                                                                                                                           |
| #29    | UK only at the card form                                 | ✅ extra 4                                                                                                                                                                                           |
| #30    | "Save my information" signed-in only, and it saves       | ✅ store 5, cust 3                                                                                                                                                                                   |
| #31    | Sell form: free text instead of buttons                  | ⚠️ the form keeps its buttons _and_ adds "Other" tiles that open a free-text box, plus a details box. The report asks for plain text fields. Decision needed                                         |
| #32    | No tracking link after repair / sell                     | ✅ cust 5, 6                                                                                                                                                                                         |
| #33    | Repair "Other" problem; admin controls problems + prices | ✅ cust 6, cfg 2 (incl. the ×1.5 phone multiplier booked as £120)                                                                                                                                    |
| #28    | No raw HTML in toasts                                    | ✅ store 4                                                                                                                                                                                           |
| #35    | View details on requests                                 | ✅ rep 5                                                                                                                                                                                             |
| #12    | Buy-in form saved + downloadable                         | ✅ cfg 4                                                                                                                                                                                             |
| #14    | "Kind" removed; permanent categories                     | ✅ prod 1, 2; vapes cannot be bought online: `customer-journeys` 5                                                                                                                                   |
| #15    | Stock count editable; no averaging                       | ✅ money 6                                                                                                                                                                                           |
| #16    | Variations                                               | ✅ cfg 3                                                                                                                                                                                             |
| #13    | In-store only hides description, badge, compatibility    | ✅ prod 1                                                                                                                                                                                            |
| #19    | Branded PDF reports                                      | ✅ rep 4 (print layout: logo, shop details, shaded table, real PDF bytes)                                                                                                                            |
| #8     | Busiest periods 9am–8pm, am/pm                           | ✅ rep 2                                                                                                                                                                                             |
| #11    | Inventory action buttons cramped                         | 🔎 visual (they are a ⋮ menu now)                                                                                                                                                                    |
| #1, #2 | Staff Archive / Sell Requests stay in the staff area     | ✅ jobs 7                                                                                                                                                                                            |
| #20    | Tiered promotions at the till                            | ✅ money 1                                                                                                                                                                                           |
| #6     | Staff "Repair Requests" tab                              | ✅ staff 6, jobs 7                                                                                                                                                                                   |
| #4     | Staff Settings: own auto-lock                            | ✅ staff 4                                                                                                                                                                                           |
| #3     | Favourite products pinned per person                     | ✅ staff 3                                                                                                                                                                                           |
| #5     | "Sell In Requests" name                                  | ✅ staff 6                                                                                                                                                                                           |

## What a person still has to look at

Subjective or visual: Jobs redesign (v1 FEATURE-11), toggle padding (v3 3.1), inventory button layout (v5 #11),
how the mobile layout _looks_, the legal pages' wording. Everything here also needs real hardware or a live server:
printers, Google sign-in, Stripe delivering its webhook, email DNS.

## Fixed while writing these tests

1. A retired product could still be fitted to a job by calling the API directly (the picker hid it; the server did not refuse it).
2. Admin changes to phone models, repair prices and categories took up to a minute to show on the website (browser cache).
3. The Custom date range made the filter bar jump.
4. A signed-in Owner pressing "Start my repair" was refused by the server but the message sat below the fold, so nothing seemed to happen.
5. Pages that read the shop's details were baked at build time with an empty address (earlier this session).
