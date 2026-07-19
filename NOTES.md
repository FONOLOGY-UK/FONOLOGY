# Fonology — build notes

Working log for the frontend build. Owner: Tanoli (frontend). Backend: Raja.

---

## Phase map

| Phase             | Scope                                                                                     | Status   |
| ----------------- | ----------------------------------------------------------------------------------------- | -------- |
| **1 (items 1–5)** | Foundation: monorepo, design tokens, data layer, shared primitives, route shells          | **done** |
| **2 (item 6)**    | Storefront reproduction (home, shop, PDP, repair, sell, cart, checkout, track) — verbatim | **done** |
| **3 (item 7)**    | Admin dashboard — all modules except POS checkout (item 8) and logins (item 9)            | **done** |
| 4 (items 8–12)    | Employee POS + auth pages + placeholder pages + closing steps                             | waiting  |

**Phase 1 built _shells only_ for admin, employee and auth.** Every page in
those surfaces renders a neutral `<ScaffoldNotice>` placeholder — no page
design, no information architecture, no invented nav. Those are designed in
their own phases. The route groups + bare layout wrappers exist because item 5
requires "route group layouts and shells".

---

## Phase 2 flags — approved by Tanoli, pending client sign-off

- **Repair flow is MAIL-IN, not appointment-based (6.4).** This is a copy +
  behaviour change to the client-approved prototype design: step 4 is now "YOUR
  DETAILS" (name, phone, email, address, postcode, preferred contact) instead of
  "TIME & DETAILS"; all date/time pickers and slot selection are removed; no
  appointment number is issued. On submit we show a tracking reference and
  mail-in instructions and note a prepaid shipping label is sent via the
  preferred contact. The prototype's visual design (layout, rail, step
  indicators, model grid, price card, colours, motion) is otherwise unchanged.
  Time-slots were removed from the data contract entirely (no `listTimeSlots`).
- **Sell condition-grading fields (6.5) are provisional.** The list — storage,
  screen condition, body condition, powers on/off, network locked/unlocked,
  accessories — follows Mazuma/iDoctor-style trade-in platforms and is PENDING
  CLIENT CONFIRMATION. The value card shows an INDICATIVE estimate from a mock
  formula (`computeSellEstimate`); the real number is confirmed after
  inspection. Backend owns real trade-in pricing.

- **Checkout is a full page, guest-first (6.3).** Multi-step with real routes
  (`/checkout?step=details|verify|pay`) so progress survives refresh/back;
  fields persisted in a `checkout` store. Sign-in is a convenience link only —
  it NEVER gates purchase. Payment is UI-only behind a `PaymentProvider`
  interface (Stripe/Clearpay mocks resolve after a delay — NO real charge).
  Promo field is a single hard-coded demo code (`FIXED10`) — NOT a promotion
  engine (6.7). Number-plate verification uploads are mock (filenames only);
  privacy notice states admin-access-only + 30-day deletion. Delivery rates
  (Standard £3.95 / Next day £6.95 / Remote £9.95, UK only) live in `lib/config`
  and are client-confirmable.

## Phase 3 flags — admin panel (item 7)

- **Design language.** Admin extends the brand (dark `--void` sidebar, paper
  work canvas, Archivo display numerals, vermilion reserved for action/alert)
  — an internal tool, not the storefront show. Minimal motion: 150ms colour
  transitions only. Chart palette (vermilion + steel blue, brass reserve) was
  validated for CVD separation and contrast against the card surface.
- **Jobs are the bench record.** Walk-ins via "Add job" (N shortcut). Mail-in
  bookings/online orders become jobs when Raja links them server-side
  (`source` field); the mock seeds them independently, so a booking's status
  and its jobs-board status don't sync in the mock. Device labels print with
  a real, scannable Code 39 barcode.
- **Inventory truth is admin-only.** Exact counts, cost, margin, supplier,
  barcode live in `AdminProduct`; the storefront still only ever sees the
  three-state `stockStatus` (derived from the count). "Bought locally" swaps
  supplier for a signed buy-in form upload (mock: filename only). Low-stock
  threshold defaults to 5, configurable in Settings.
- **Promotions are till-only** (walk-in bulk pricing). The storefront never
  reads the promotions table — online prices are the listed prices. Applied
  for real at POS (item 8).
- **Exports:** "CSV for Excel" is a real client-side download; "Print / PDF"
  goes through the browser print dialog (Save as PDF). Server-rendered PDF is
  Raja's when/if wanted.
- **Float & petty cash** are tracked apart from sales revenue; the shell
  prompts for the opening float on the first visit of a trading day. The
  cash page shows an expected-drawer figure (float + petty ± + cash-tender
  takings) as a count-up target.
- **Returns window** (default 30 days) is configurable in Settings; refunds
  outside it require a ticked admin override and the reason is kept on
  record. Refunds also post into the payments ledger as money out.
- **PIN lock is a screen lock, not auth** (item 9 owns logins). It's an
  overlay — locking never unmounts pages or loses in-progress work. Idle
  timeout configurable; demo PIN 1234, changeable in Settings.
- **Analytics definitions are the mock's** (revenue = settled positive
  amounts, trade-in payouts excluded) — documented in INTEGRATION.md; the
  backend owns the real definitions but must keep the response shape.

## Open questions (need client / Tanoli / Raja answers)

Per HARD RULE #5 — logged, not guessed:

1. **Sell / trade-in flow (`/sell`)** — brand-new page with no prototype
   reference. What is the flow? (device → condition → instant quote → drop-off
   vs post-in?) What determines a trade-in price? Blocking for building the page
   in a later phase. Route shell exists.
2. **Checkout as a full page (`/checkout`)** — the prototype used a 3-step modal
   (details → mock pay → success). Item 6.3 says build checkout as a full page.
   Confirm: keep the same 3 steps, just as a page? Any real payment provider
   (Stripe?) intended, or stays mock until Raja wires it?
3. **Auth model** — customer accounts vs staff accounts vs both? Does the
   storefront need customer login for checkout/tracking, or is tracking purely
   by reference (as the prototype implies)? Raja owns the implementation; the
   frontend needs to know which pages gate behind auth.
4. **Admin/POS data operations** — the `DataAdapter` currently exposes the
   read surface those panels obviously need (list orders/bookings). Mutations
   (status changes, product CRUD, refunds) get added to the contract as those
   panels are designed (items 8–12). Flag any operation Raja already knows the
   backend will expose so we add it to the contract early.
5. **Legal pages** — final copy for privacy / terms / returns comes from the
   client. Shells exist; content pending.

---

## Standalone build — VERIFIED

The `output: 'standalone'` server (the exact artifact Coolify runs via
`node server.js`) has been **built and booted successfully**, and serves all 20
routes + `/api/health` with HTTP 200 (dynamic PDP included). It is not an
assumption.

Caveat on **how** to build it on Windows: Next's standalone tracer recreates
pnpm's `node_modules` graph with symlinks, and Windows blocks symlink creation
without Administrator / Developer Mode (`EPERM … symlink` at "Collecting build
traces"). Three ways to get a working standalone build:

1. **Linux / Docker (the real deploy target)** — symlinks just work; the
   provided `apps/web/Dockerfile` builds it directly. This is what Coolify uses.
2. **Windows + Developer Mode** — enable Settings → Privacy & security → For
   developers, then `pnpm --filter @fonology/web build` completes normally.
3. **Windows without admin** — recreate directory links as _junctions_ (allowed
   without privilege). This is how it was verified here; the throwaway shim used
   is in the session scratchpad, not committed.

`next dev` and `next start` (non-standalone) work on Windows regardless.
`pnpm typecheck`, lint, and static generation of all routes all pass on Windows.

## Storefront discrepancies

Anything in the prototype that looks like a mistake is reproduced as-is here and
logged below (HARD RULE #1). None recorded yet — will be filled as the
storefront is ported in Phase 2.

- _(none yet)_

---

## Gotchas

- **Never build conditional Tailwind classNames via string concatenation with a
  leading/trailing space** — `prettier-plugin-tailwindcss` strips it (it reads
  the branch as a class list), silently breaking the class. Use full-string
  ternaries (`cond ? 'chip is-active' : 'chip'`) or `cn()`.
- **QA in a FOREGROUND browser tab.** Chromium throttles hidden/background
  tabs: CSS animations freeze (so Radix dialogs, which wait for
  `animationend`, appear to "never close") and hydration/reveal work can sit
  deferred (pages look stuck on "Loading" with no error). Neither is an app
  bug — the same build behaves correctly the moment the tab is visible. If a
  page "hangs" during testing, check `document.visibilityState` before
  touching code.

## Decisions

- **Money = integer GBP pence** everywhere in the domain; pounds only appear at
  the display layer via `formatGBP`. See `src/lib/data/types/pricing.ts`.
- **NO VAT anywhere** (HARD RULE #3) — Fonology is not VAT registered. Enforced
  by the absence of any VAT field/label/number; documented in `pricing.ts`.
- **Fonts self-hosted via `next/font`** (identical typefaces to the prototype's
  Google Fonts) — no third-party font request, better for a self-hosted UK
  deployment. Storefront still renders pixel-for-pixel.
- **Tailwind v3.4 + CSS variables**, tokens copied verbatim from the prototype
  `:root`. shadcn/ui semantic tokens are aliased onto the brand tokens so
  admin/employee/auth inherit the language.
- **Storefront component CSS** (hero, teardown, wizard, cards, etc.) is **not**
  ported yet — it is reproduced verbatim alongside the storefront components in
  Phase 2. Phase 1 ships only the tokens + base reset.
