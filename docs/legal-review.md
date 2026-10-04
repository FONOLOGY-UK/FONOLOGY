# Legal pages — what the draft assumes

Drafted 2026-10-04 for: `/privacy`, `/terms`, `/cookies`, `/returns-policy`, `/shipping`.
Address, phone, email, returns window, ID-document retention and next-day cut-off come live
from `shop_settings`. Everything else below is **my wording, not the owner's decision** —
have the owner confirm each line, and ideally a solicitor read the whole set before opening day.

## Policy choices the owner must confirm

| Page     | Statement in the draft                                                           | Why it needs confirming                                                |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Returns  | Faulty goods: reject for refund within 30 days; we pay return costs              | Mirrors the Consumer Rights Act 30-day right; shop may offer more      |
| Returns  | Opened vape products / e-liquids not returnable for change of mind               | Common practice, not verified as the shop's rule                       |
| Returns  | Unlocked/reset phones and completed repairs not returnable for change of mind    | Same                                                                   |
| Returns  | Online change-of-mind: at least 14 days (statutory) plus the shop's window       | Statutory minimum must stay                                            |
| Returns  | Repair warranty excludes accidental/liquid damage and third-party work           | Warranty length itself is read from the repair tier (`warranty_label`) |
| Shipping | Dispatch same or next working day; UK only; carriers not named                   | Delivery promise                                                       |
| Shipping | Collect in store: bring order number                                             | Till process                                                           |
| Terms    | Governed by Scots law; Scottish courts                                           | Shop is in Glasgow                                                     |
| Terms    | Uncollected repairs: storage fee / disposal after reasonable attempts to contact | Needs a real period and fee if the shop wants it enforceable           |
| Terms    | Trade-ins: offer can change after in-shop inspection; ID may be asked for        | Matches the sell flow, wording is mine                                 |
| Terms    | Not VAT registered, so no VAT added                                              | From CLAUDE.md                                                         |
| Privacy  | Order/repair/payment records kept six years                                      | HMRC-style retention; confirm                                          |
| Privacy  | Sessions expire after 30 days idle                                               | From code (`authSessions`)                                             |
| Privacy  | Third parties: Stripe, carriers, email provider, Google sign-in, hosting         | Name the actual email provider and host once chosen                    |
| Cookies  | No analytics/marketing cookies, so no banner                                     | True today; **revisit if analytics is ever added**                     |

## Not in the drafts (needs the owner)

- Legal entity: registered company name / number, or sole-trader name and trading address.
  Privacy and Terms currently say only "Fonology".
- ICO registration number (UK controllers generally must pay the ICO fee).
- A named contact for data requests (currently the shop email).

## Still placeholders

`/about`, `/faq` still render the "content to be finalised" block — they are shop copy, not
legal text, and need the client's words.
