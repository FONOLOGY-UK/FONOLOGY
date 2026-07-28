# Question triage — open questions vs. what the repo already says

Method: every `.md` file in the repo (`README.md`, `NOTES.md`, `INTEGRATION.md`,
`CONTENT-TODO.md`, `.impeccable/critique/2026-07-20T10-03-27Z__apps-web.md` —
the full set; there are no others, no `docs/` folder, no other notes files),
`git log --all` (15 commits, all with descriptive bodies, no separate
changelog), and the frontend source (`apps/web/src`) — types, Zod schemas,
mock adapter, config, permissions, and components — were searched for each
question below. No code was changed to produce this file.

Verdict key: **CONFIRMED** (a document records the client deciding this) ·
**ASSUMED** (the code/docs do something, but no client sign-off is recorded)
· **PARTIAL** (part of it is settled) · **NOT FOUND**.

---

## Structural

### 1. Buy Now Pay Later (Clearpay)

**ASSUMED.** Clearpay is fully present in code as a UI-only mock, not
confirmed by the client.

- `apps/web/src/lib/payments/provider.ts:11` — `PaymentMethodId = 'stripe' | 'clearpay'`, and `PAYMENT_PROVIDERS.clearpay` (lines 44–49) has label "Clearpay" and blurb "4 interest-free payments, every 2 weeks." `pay()` is a mock that resolves after a delay — no real charge.
- `apps/web/src/lib/data/types/order.ts:28` — `paymentMethodSchema = z.enum(['stripe', 'clearpay'])`, part of the persisted `Order` contract.
- The only doc mention is `NOTES.md:42-51` ("Phase 2 flags — **approved by Tanoli, pending client sign-off**"): "Payment is UI-only behind a `PaymentProvider` interface (Stripe/Clearpay mocks resolve after a delay — NO real charge)." That heading itself says pending sign-off, not confirmed.
- Open question 2 in `NOTES.md:100-103` explicitly asks "Any real payment provider (Stripe?) intended" — Clearpay isn't even named there, reinforcing that its presence is a dev placeholder, not a client decision.

### 2. Repair parts and stock

**NOT FOUND** — and the gap is real, not just undocumented.

- `jobInputSchema` / `jobSchema` (`apps/web/src/lib/data/types/job.ts:77-98`) has no parts list, no productId reference, nothing that ties a repair job to inventory at all.
- `completeSale` (`apps/web/src/lib/data/adapters/mock.adapter.ts:576-636`) is the **only** place stock is deducted (`product.stockQty -= line.quantity`), and it only runs for POS/shop-catalogue lines. Moving a `Job` through `updateJob` (line 257) never touches `adminDb.products`.
- No document mentions repair parts consuming stock. This needs a client/Raja decision before the schema is designed — currently the two are entirely unconnected.

### 3. Trade-ins becoming stock

**PARTIAL.** The code captures the _intent_, not the automation, and this exact question is already logged as open.

- `tradeInPayoutInputSchema` (`apps/web/src/lib/data/types/finance.ts:185-201`) carries `addToStock: boolean` and `resalePrice`. The doc comment on lines 179-183 is explicit: "`addToStock` is a request, not a guarantee — creating the resale listing is the backend's job."
- `INTEGRATION.md:194` repeats it: "`addToStock` + `resalePrice` are the counter's INTENT: creating the resale listing is yours."
- `NOTES.md:127-131`, open question 8, asks the client directly: "Does the client want each used device as its own inventory record, or handled outside the system until it sells?" — unanswered.

### 4. Cost basis for profit

**ASSUMED**, and it's a single-value model with no batching.

- `stockMetaSchema.costPrice` (`apps/web/src/lib/data/types/inventory.ts:18-22`) is one field per product — there is no cost history, no batches, no FIFO/average logic anywhere in the types or mock.
- `saleLineSchema.costPrice` (`apps/web/src/lib/data/types/pos.ts:24`) is described as "Unit cost at time of sale" — i.e. whatever `AdminProduct.costPrice` happens to be when the sale is rung up. That is effectively **latest cost**, by construction, not a deliberate choice between latest/average/batch.
- No document discusses cost-basis method. This is invisible until two batches of the same product are bought at different prices — worth flagging to the client even though it's cheap to explain (see list 3 below).

### 5. Returns

**PARTIAL** — staff scope and window are settled in the mock; refund-tender behaviour is an undisclosed gap.

- Staff scope is **ASSUMED, but already logged as an open question with a clear answer today**: `permissions.config.ts:38-46` — `EMPLOYEE_PERMISSIONS` does **not** include `returns.manage`; only `MANAGEMENT_PERMISSIONS` (owner/manager) has it (lines 48-58). `NOTES.md:121-126`, open question 7, states this outright: "Returns stay owner/manager-only (`returns.manage`) because the original brief listed what employees may do and returns was not on it... If the client wants it, it is a one-line change." So today: **admin/owner/manager only**, and the code says exactly what to flip if the client says otherwise.
- Return window: `RETURN_WINDOW_DAYS = 30` (`apps/web/src/lib/config.ts:11`), comment: "Matches the prototype's '30-DAY' copy (6.7)." So the number's origin is **the prototype's display copy**, not a client instruction — this is ASSUMED, inherited from the earlier design phase.
- Refunds against original tender: `refundInputSchema` (`apps/web/src/lib/data/types/finance.ts:148-163`) has a free-choice `tender` field with no link back to the original sale's tender — nothing stops staff refunding cash against a card sale. **NOT FOUND / ASSUMED-by-omission** — no doc addresses this, and it is a real-money-handling gap worth a formal question, not a passing mention.

### 6. Bulk discount scope

**PARTIAL.** The implemented behaviour is settled and documented three times; whether the client wants something different is an open question.

- Implemented: per-product only. `promotion.ts:29-32` (comment) + `promoUnitPrice`/`promotionFor` (lines 47-60): a tier fires when `quantity` of **one** covered product is reached; buying 1 of each of two covered products never triggers a tier.
- `NOTES.md:115-120`, open question 6: "Does the client want true mixed-basket bundles — 'any 2 from this list for £20'? That is a different pricing rule... it needs an answer before it is built."
- `INTEGRATION.md:206-210` repeats the same logic and the same open flag.
- Verdict: **CONFIRMED-shape** for what the code does today (three consistent sources agree), **NOT FOUND** for what the client actually wants.

### 7. Staff logins

**PARTIAL**, with a real attribution gap.

- Individual logins: `staffSignIn` (`apps/web/src/lib/data/adapters/mock.adapter.ts:700-720`) matches by individual staff email (`adminDb.staff.find(s => s.email...)`) and returns that person's name/role — not a shared login. **ASSUMED** (never client-confirmed, but unambiguous in code).
- Attribution: **NOT FOUND** for POS sales specifically. `saleSchema` (`pos.ts:55-67`) has no staff field at all, and `components/pos/pos-view.tsx` never references a staff name or session when calling `completeSale`. `CashEntry`, `Refund`, and `TradeInPayout` do carry `staffName` (`finance.ts:98,159,194`), but it is a **free-text string typed by whoever is at the counter**, not a reference to a `Staff.id` — anyone can type any name. This is a real gap for "who did this" reporting and should go to the client/Raja as a defined question, not be assumed fixed.

### 8. Mail-in repair completion

**NOT FOUND.**

- `bookingStatusSchema` (`apps/web/src/lib/data/types/repair.ts:96-103`): `received | in-progress | ready | dispatched | cancelled`. `dispatched` exists as a status but there is no tracking-number field, no carrier field, anywhere on `Booking`.
- `NOTES.md:26-34` only documents the **inbound** leg: "a prepaid shipping label is sent via the preferred contact" when the customer sends the device in. Nothing documents the return leg beyond the bare `dispatched` status.

### 9. Repair cost overrun

**NOT FOUND.** No field on `Job` or `Booking` represents a quote revision, a re-approval request, or a "customer notified of new price" state. `JobPatch` (`job.ts:101-103`) allows editing `quote` freely with no history/audit of the change. No document discusses this flow.

### 10. Guest order lookup

**CONFIRMED (in code — reference alone, no email check).**

`getTracking` (`apps/web/src/lib/data/adapters/mock.adapter.ts:202-212`):

```
const ref = reference.trim().toUpperCase();
const booking = mockDb.bookings.find((b) => b.reference === ref);
```

— matches purely on the uppercased trimmed reference against bookings, orders, then sell requests, in that order. No email or other secondary check anywhere in the function. `INTEGRATION.md:121-129` documents the same single-argument `getTracking(reference)` contract. This is a security-relevant fact worth surfacing even though it's unambiguous — see list 3.

---

## Money and payments

### 11. VAT

**ASSUMED** — stated as a firm internal rule, not shown to be a documented client decision.

- `pricing.ts:12-19`: "HARD RULE #3 — NO VAT, ANYWHERE. This is a deliberate business decision: Fonology is NOT VAT registered... Do not add VAT handling later without an explicit change to Fonology's VAT-registration status."
- `README.md:69`: "No VAT anywhere — Fonology is not VAT registered (HARD RULE #3)."
- `NOTES.md:320-321` (Decisions): "NO VAT anywhere (HARD RULE #3) — Fonology is not VAT registered."
- None of these cite a client email, meeting note, or "confirmed with client" — they state it as settled fact from the brief, three times, consistently, but the repo contains no record of the client actually saying it. Given the trigger question says "the requirements doc mentions VAT twice" (a doc not present in this repo, so unverifiable here), this is exactly the kind of thing that reads as certain but has no traceable confirmation inside the repo — flag for a quick client double-check, not a blocking question.

### 12. Deposits

**PARTIAL.**

- `Job` has `jobPaymentSchema = z.enum(['unpaid', 'paid-advance', 'paid'])` (`job.ts:44`) — a tri-state flag, so "paid in advance" as a _concept_ exists. But there is **no amount field** anywhere recording how much was paid in advance vs. owed — it's binary-ish, not a running balance.
- `Booking` (mail-in repair) has **no payment field at all** — `bookingSchema` (`repair.ts:106-113`) carries `price` but nothing about payment status.
- No document discusses partial payment beyond the label itself.

### 13. Trade-in payouts — cash vs bank transfer

**ASSUMED (code allows both; not client-confirmed).**

`tradeInPayoutInputSchema.tender` (`finance.ts:193`) uses the full `tenderSchema` = `cash | pos1 | pos2 | transfer | stripe` — no restriction to cash. The seeded fixture `tip-1` (`apps/web/src/lib/data/mock/admin.ts:744-758`) is in fact paid via `'transfer'`. So bank transfer is supported in the data model today; no doc states the client asked for this.

### 14. End-of-day cash-up reconciliation

**NOT FOUND.**

`CashView` (`apps/web/src/components/admin/cash/cash-view.tsx:36-60`) computes an `expected` figure (`float + petty-in − petty-out + today's cash takings`) and displays it as a target (comment: "an expected-drawer figure... so a till count has a target" — `NOTES.md:76-79` calls it "a count-up target"). There is **no field anywhere** — not in `CashEntry`, not in the UI — that records an actual counted amount or a variance against `expected`. It shows a number to count against; it doesn't record the count.

### 15. Below-cost sales

**CONFIRMED (config-driven, warning-only today) — but no reason is captured.**

- `POS_CONFIG.blockBelowCost = false` (`apps/web/src/lib/config.ts:29-31`), comment: "selling below the combined cost price shows a clear warning but still completes; flip to `true` to make it blocking — no code change needed."
- `components/pos/pos-view.tsx:93,104,476-488` implements exactly that: computes `belowCost`, shows a warning banner, and only blocks the Complete button when `POS_CONFIG.blockBelowCost && belowCost`.
- **No typed reason field** exists for a below-cost override — unlike refunds (`refundInputSchema.reason`, required) or window-override refunds, a below-cost sale requires no explanation on record. The critique doc flags this too: `.impeccable/critique/...md:64` — "Does the owner want the below-cost warning to require a reason (like refund overrides) even while non-blocking?" is listed as an open question **by the previous reviewer**, not the client.

---

## Stock, products, till

### 16. Delivery prices — and a genuine doc/code contradiction

**CONFIRMED for the numbers actually used by the mock — but INTEGRATION.md contradicts them.**

- What the checkout/mock actually charges: `DELIVERY_OPTIONS` (`apps/web/src/lib/config.ts:33-43`) — Click & collect free, Standard £3.95, Next day £6.95 ("Order before 2pm" — display text only, not enforced anywhere), Remote (NI/Highlands/islands) £9.95. `createOrder` (`mock.adapter.ts:151`) looks the fee up from this table by `input.delivery`. `NOTES.md:49-51` states the same four numbers and calls them "client-confirmable" (i.e. not yet confirmed).
- **Contradiction:** `INTEGRATION.md:119` tells Raja: "Server computes `subtotal`, `deliveryFee` (**£2.99** for delivery, else 0), `total`." That £2.99 figure matches the _separate_, apparently superseded `DELIVERY_FEE = pounds(2.99)` constant still sitting in `pricing.ts:43` — which nothing in the current checkout flow calls. INTEGRATION.md was not updated when the tiered `DELIVERY_OPTIONS` model replaced the flat fee. **Flag this to Raja directly** — the integration doc currently tells the backend the wrong number.
- No free-delivery threshold exists anywhere in code (collect is a separate free _method_, not a spend threshold on delivery). No cut-off time is enforced — "Order before 2pm" is copy only.

### 17. Low stock

**CONFIRMED in code, all consistent.**

- Default 5, configurable: `ShopSettings.lowStockThreshold` (`settings.ts:15`), `DEFAULT_SETTINGS` (`admin.ts:235`) = 5, editable in `components/admin/settings/settings-view.tsx:37-46` (field "Low-stock alert threshold").
- Global, not per-product: `isLowStock(stockQty, threshold)` (`inventory.ts:78-80`) takes one threshold applied to every product; there is no per-product override field anywhere.
- Who can change it: `settings.manage` is management-only (`permissions.config.ts:56-58`) — owner/manager, not counter/technician.
- Notification mechanism: **NOT FOUND.** The only effect is a visual one — `inventory-view.tsx:22,226` ("Low-stock rows glow amber at the alert threshold") and the admin overview KPI (`overview-view.tsx:33`). No email, no banner outside the inventory/overview screens, no push notification of any kind.

### 18. Vaping products

**ASSUMED (till-sellable and stock-tracked; online-blocked is the only confirmed-by-code half).**

- Not purchasable online: `isPurchasable`/`canAddToCart` (`product.ts:85,88-89`) explicitly return `false` for `kind === 'vape'`. Comment on `product.ts:9`: "informational only, NEVER purchasable online ('in store only')."
- Sellable at the till: `mock/admin.ts:255` — comment directly above `SELLABLE = MOCK_PRODUCTS`: "**Everything sells at the counter — vapes and plates included (in-store).**" `completeSale` has no kind-based filter, so nothing in code stops a vape line reaching the POS ticket.
- Stock-tracked: yes, identically to every other product — `MOCK_STOCK_META` (`admin.ts:152-167`) has full entries (cost, qty, supplier, barcode) for `vape-berry-ice` and `vape-mango-pod`.
- No document states the client confirmed till-sale of vapes; it's inferred purely from the "online only" framing plus this one dev comment.

### 19. Stock write-offs

**NOT FOUND — and it's a real gap, not just a documentation absence.**

`adjustStock(id, delta)` (`mock.adapter.ts:302-309`, contract at `types.ts:123-124`: "Quick +/- stock adjustment from the table (never below 0)") takes a raw signed number with **no reason field, no category (damage/loss/internal-use), no audit trail** — it's indistinguishable from a stocktake correction. There is no dedicated write-off flow anywhere in the admin inventory module or its types.

### 20. EPOS import

**NOT FOUND.** No import code, no sample file, no reference to an existing EPOS system's export format anywhere in the repo (grepped for "EPOS", "import", "migrat*" — the only "import" hits are ES module imports and the CSV **export** helper, `lib/export.ts`, which is one-way: admin → CSV, never CSV → system).

### 21. Receipt printer

**NOT FOUND.** `PrintService` (`apps/web/src/lib/print/print-service.ts:1-9`) is deliberately hardware-agnostic: "A local print agent will drive the thermal printer + cash-drawer kick later; until then the browser print dialog is the fallback." No brand, model, or purchase decision is named anywhere.

### 22. Walk-in customer records

**PARTIAL — split by transaction type.**

- Counter _product_ sales are anonymous: `saleSchema`/`saleInputSchema` (`pos.ts:37-67`) carry no customer name/id field whatsoever.
- Repair jobs ("Add job" walk-ins) **do** capture a customer: `jobInputSchema.customerName/phone/email` (`job.ts:77-88`) — but this is a free-text record on the `Job`, not a reusable `Customer` entity; nothing links a repeat customer's job to their earlier till sales.

---

## Repairs, trade-ins, documents

### 23. Repair pricing coverage

**PARTIAL.**

- `tierPricesSchema` is nullable per repair type (`repair.ts:32-38`); three of six mock repair types are `base: null` — "Water damage", "Data recovery", "Other" (`mock/repairs.ts:47-66`), each with `time: 'Free diagnosis'`/`'Assessed first'`. So "price on request" is a real, supported state, not a gap.
- Unlisted model: there **is** a catch-all — `MOCK_DEVICES` includes `{ id: 'other', name: 'Something else', brand: 'other', priceMultiplier: 1.0 }` (`mock/repairs.ts:21`), and `repair-flow.tsx:45,178,349-350` collects free text (`deviceOther`) appended to the booking notes when it's picked. So the UI never truly dead-ends on an unlisted model — it substitutes a 1.0 multiplier and free text, rather than declining to quote. Whether a 1.0×-multiplier "guess" price is what the client wants for a genuinely unknown device is not addressed anywhere — that part is **NOT FOUND**.

### 24. Trade-in grading

**ASSUMED — explicit mock formula, explicitly flagged as not real.**

`computeSellEstimate` (`apps/web/src/lib/data/sell-pricing.ts:9-24`): `basePounds = 200 × device.priceMultiplier`, multiplied by hand-picked modifiers for screen condition (`flawless 1 / good 0.78 / cracked 0.4`), body condition (`1 / 0.9 / 0.78`), powers-on (`1 / 0.35`), network-lock (`locked 0.85 / unlocked 1`), floored at £5. The doc comment on the same file and `NOTES.md:35-40` both say this is "INDICATIVE" and "the grading model is pending client confirmation." Staff do **not** enter a price manually at submission time — the estimate is fully formulaic; a human only re-prices later via `TradeInPayout.amount` at actual buy-in.

### 25. Number plate verification

**NOT FOUND — no review/hold/rejection path exists.**

`createOrder` (`mock.adapter.ts:148-172`) sets `status: 'paid'` unconditionally and immediately, regardless of whether `input.verification` (the uploaded V5C + licence filenames) is present. `orderStatusSchema` (`order.ts:65-73`) has no "pending verification" or "awaiting review" state, and no admin screen was found that lists orders needing plate-document review. `orderVerificationSchema` (`order.ts:34-38`) only carries filename strings — comment: "Files are handled by the backend; here we only carry references." There is no code path for rejecting a plate order or refunding it specifically for failed verification (a normal `Refund` could be used, but nothing ties it to verification failure as a reason category).

### 26. ID document retention (30 days)

**ASSUMED — copy only, not a real deletion job, and not sourced to the client.**

The "30 days" figure appears as **checkout/PDP copy**, not as an implemented deletion mechanism: `checkout-flow.tsx:347` ("...deleted after 30 days"), `product-detail.tsx:189,290` (same wording). `order.ts:32` and `NOTES.md:48-49` repeat the number as a privacy-notice fact. There is no cron, no timestamp field, no deletion code anywhere — it's a promise made in the UI copy with nothing behind it yet, and no document states where "30" came from (it reads as inherited from the same source as the 30-day returns window, but that is not stated).

---

## Settings and config

### 27. Settings tab scope

**CONFIRMED for what exists; PARTIAL for what's missing.**

- Route exists: `app/(dashboard)/admin/settings/page.tsx`, module `components/admin/settings/settings-view.tsx`.
- Current contents, from `shopSettingsSchema` (`settings.ts:11-22`): `returnWindowDays`, `lowStockThreshold`, `idleLockMinutes`, `adminPin` (4-digit screen-lock PIN, not real auth), `floatTarget`.
- Config elsewhere that would sensibly belong here but currently doesn't: `DELIVERY_OPTIONS` and `RETURN_WINDOW_DAYS` (`lib/config.ts` — note `RETURN_WINDOW_DAYS` is a **separate, hardcoded constant** from `ShopSettings.returnWindowDays`; see the cross-reference in the findings list below), `POS_CONFIG.blockBelowCost` (`lib/config.ts:29-31`), the demo promo code `FIXED10` (`lib/data/promo.ts:11`), and the Stripe/Clearpay provider list (`lib/payments/provider.ts:37-50`) — all currently source-level constants, none of them settings-editable.

### 28. Notification recipients

**NOT FOUND.** The only email address in the codebase is the public contact address `hello@fonology.co.uk` (`lib/site.ts:23-24`) and the seeded staff roster's own emails (`mock/admin.ts:198-227`, used only for staff login matching). No code sends, queues, or configures a recipient for order/repair/low-stock notifications — there is no notification system at all in the frontend (expected, since there's no backend yet, but confirming it's not even stubbed).

### 29. Outstanding content

**CONFIRMED — fully enumerated in `CONTENT-TODO.md`.** Reproduced in full:

- Homepage stats (kept verbatim from prototype): 12,400+ repairs, 38 min average screen fix, 4.9★/900+ reviews, 90-day minimum warranty.
- Contact details (nav/footer/menu/JSON-LD): phone `01234 567 890`, email `hello@fonology.co.uk`, address `Unit 4, The Parade, High Street, Yourtown, YT1 2AB`, hours Mon–Fri 9–6, Sat 9:30–5, Sun closed.
- Grade example prices (homepage): Original iPhone 14 screen £161, OEM £121, Copy £83.
- Shop promo copy: "accessories are 10% off with any same-day fix" — display copy only, no engine behind it.
- Socials: Instagram/TikTok/Google are placeholder `#` links.
- Pages awaiting content (routed, styled, "Content to be finalised" placeholder shown): `/terms`, `/privacy`, `/returns-policy` (window is 30d, wording pending), `/shipping` (rates provisional), `/cookies` (pending final analytics stack too), `/about`, `/contact`, `/faq`. (`/returns` redirects to `/returns-policy`.)
- POS receipt template: placeholder layout; final logo/wording/footer messaging pending.

---

## List 1 — Still needs the client

Send these; the repo does not resolve them.

1. **Repair parts vs. counter stock** (Q2) — completely unmodelled; needs a decision before schema design.
2. **Cost basis for margin** (Q4) — latest/average/batch is currently "whichever `costPrice` happens to be" by construction, never a deliberate choice.
3. **Refund tender vs. original payment tender** (Q5) — can staff refund cash against a card sale? Nothing in code or docs constrains this.
4. **Staff attribution on POS sales** (Q7) — `Sale` has no staff field at all; other money-movement records only have a free-typed name, not an id.
5. **Mail-in return postage / tracking** (Q8) — `dispatched` status exists with nothing behind it.
6. **Repair cost overrun / re-approval** (Q9) — no flow exists.
7. **VAT registration status** (Q11) — asserted three times internally, no traceable client confirmation in this repo.
8. **Deposits / partial repair payment** (Q12) — `paid-advance` is a flag, not an amount.
9. **End-of-day cash reconciliation** (Q14) — an "expected" figure is shown; nothing records or compares an actual count.
10. **Below-cost sale reason requirement** (Q15) — currently no reason captured; previous reviewer already flagged this as worth asking.
11. **Delivery figures — client sign-off, plus fix the INTEGRATION.md contradiction** (Q16) — the £3.95/£6.95/£9.95 tiers are unconfirmed by the client _and_ INTEGRATION.md still tells Raja £2.99 flat. Needs both a client answer and a doc fix.
12. **Stock write-off flow** (Q19) — `adjustStock` has no reason/category; decide if a dedicated flow is needed.
13. **EPOS migration** (Q20) — no information exists; ask whether one-time import is even in scope.
14. **Receipt printer hardware** (Q21) — no decision recorded.
15. **Unlisted repair model pricing** (Q23) — currently silently uses a 1.0× multiplier; confirm that's acceptable or needs "quote on request" instead.
16. **Number-plate verification review/rejection path** (Q25) — orders complete immediately with no hold; confirm this is acceptable pre-launch.
17. **ID retention "30 days"** (Q26) — copy exists, no deletion job exists, no source for the number is recorded.
18. **Settings scope** (Q27) — confirm which of the currently-hardcoded values (delivery rates, below-cost blocking, promo codes, payment providers) the owner actually wants to tune live.
19. **Notification recipients** (Q28) — none configured; ask whether email alerts are in scope at all for v1.

Also carried over unchanged from `NOTES.md`'s own open-questions list (still unanswered as of this repo state): the `/sell` flow's real pricing model, checkout-as-page confirmation, the customer/staff auth model, which admin/POS mutations Raja already knows the backend will expose, legal-page copy ownership timing, and trade-in-as-stock (all summarised above where they overlap the new list).

## List 2 — Answered, no need to ask

1. **Repair flow is mail-in, not appointment-based** (Q — general context). No date/time picker, no appointment number; step 4 collects contact + address instead. (`NOTES.md:26-34`)
2. **Promotions are till-only** — the storefront never reads the promotions table; online prices are always listed price. (`promotion.ts:9-12`, `INTEGRATION.md:205`)
3. **Bulk-tier evaluation is per-product, not mixed-basket**, as currently built (whether the client wants mixed-basket is separately open — see List 1). (`promotion.ts:29-32`)
4. **Returns are owner/manager-only today**, and the one-line change to make them counter-accessible is already identified (`EMPLOYEE_PERMISSIONS` + `POS_TABS`). (`permissions.config.ts:38-58`)
5. **Vapes: online-blocked, till-sellable, stock-tracked** — internally consistent across every touchpoint (`product.ts`, `mock/admin.ts:255` + stock fixtures).
6. **Guest order tracking is reference-only**, no email/account required. (`mock.adapter.ts:202-212`)
7. **Customer accounts are optional everywhere** — no storefront flow (browse/buy/repair/sell/track) is ever gated behind login. (`auth.ts:9-12`, `INTEGRATION.md:258-260`)
8. **Money is integer GBP pence, domain-wide, no VAT fields exist anywhere in the schema.** (`pricing.ts`)
9. **Low-stock threshold defaults to 5, is global, and is owner/manager-configurable in Settings.** (`settings.ts`, `admin.ts:235`, `permissions.config.ts`)
10. **Trade-in payout intent (`addToStock`/`resalePrice`) is captured but resale-listing creation is explicitly the backend's job**, not the frontend's. (`finance.ts:179-183`, `INTEGRATION.md:194`)

## List 3 — Assumptions worth confirming cheaply (mention in passing, don't formally ask)

1. **Return window "30 days"** — inherited from the prototype's display copy, not a fresh client number; worth a one-line "still 30?" rather than a formal question.
2. **Clearpay as a checkout option** — already built and working as a mock; just needs a yes/no rather than a design discussion.
3. **Bank transfer as a valid trade-in payout tender** — already supported in the schema and used in a seed fixture; mention it's available, no need to design anything.
4. **`RETURN_WINDOW_DAYS` (storefront copy) vs. `ShopSettings.returnWindowDays` (admin-enforced)** — two separate values that happen to both default to 30 today. If the client ever changes the Settings value, the storefront copy (receipt, auth panel, PDP, returns-policy page) will silently go stale, since it reads the hardcoded constant, not the setting. Worth a heads-up now, cheap to fix later (see also the frontend-inconsistency note in `BACKEND-INPUTS.md` §13).
5. **"Something else" repair devices price at a flat 1.0× multiplier** — reasonable placeholder, but flag that this is a guess dressed as a real number, not a considered default.
6. **PIN lock demo value `1234`** — obviously a placeholder, not worth a formal question, just confirm it gets replaced before go-live.

---

## Contradictions found between documents (or between docs and code)

- **INTEGRATION.md vs. `lib/config.ts` / `NOTES.md` — delivery fee.** `INTEGRATION.md:119` says the server should compute "`deliveryFee` (£2.99 for delivery, else 0)". The actual, currently-running mock (`mock.adapter.ts:151`) and the values `NOTES.md:49-51` documents are tiered: Standard £3.95, Next day £6.95, Remote £9.95 (`lib/config.ts:33-43`). The £2.99 figure only survives as an unused constant (`pricing.ts:43`, `DELIVERY_FEE`). This is a stale doc, not a deliberate two-tier system — Raja should be told to ignore the £2.99 line in INTEGRATION.md.
- No other direct contradictions were found between Hashir's docs and the current code — the three narrative docs (`NOTES.md`, `INTEGRATION.md`, `CONTENT-TODO.md`) are otherwise consistent with each other and with the source, likely because they're kept by the same author in the same sitting-by-sitting log rather than written once and left stale. The one exception above is the single spot where a later refactor (tiered delivery, evidenced by the `Money-out, multi-product promotions & recording returns` and earlier phase commits) wasn't back-ported into `INTEGRATION.md`.
