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
- **Returns now record goods, not just money** (see "Money-out & returns"
  below). Counter sales can be returned; the earlier gap is closed.
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
6. **Mixed-basket promotions** — a promotion now covers many products, but the
   tier is evaluated PER PRODUCT (2× the same covered item hits the price;
   1 + 1 across two covered items does not). Does the client want true
   mixed-basket bundles — "any 2 from this list for £20"? That is a different
   pricing rule, not a bigger multi-select, so it needs an answer before it is
   built. Flagged in the dialog copy so nobody assumes the other behaviour.
7. **Can counter staff process returns?** Returns stay owner/manager-only
   (`returns.manage`) because the original brief listed what employees may do
   and returns was not on it. In a real shop the counter usually handles them.
   If the client wants it, it is a one-line change to
   `EMPLOYEE_PERMISSIONS` in `permissions.config.ts` plus a `POS_TABS` entry.
   Not guessed either way (HR#5).
8. **Trade-in device as stock** — recording a buy-in captures `addToStock` and
   an asking price, but the resale listing itself is a backend concern (a
   used device is a one-of-a-kind item, not a catalogue SKU with a count).
   Does the client want each used device as its own inventory record, or
   handled outside the system until it sells?

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
logged below (HARD RULE #1).

- **Footer heading order** — the prototype's footer uses `<h4>` column titles
  directly after higher-level sections (Lighthouse `heading-order`).
  Reproduced as-is; changing the tags risks the element-selector CSS.
- **Colour contrast (35 elements on the home page)** — the marquee items,
  teardown step numbers and the manifesto's dimmed words (which deliberately
  start faint and ink-in on scroll) fail WCAG AA contrast in their designed
  state. These are the prototype's approved colour choices; raising the
  Lighthouse accessibility score past ~90 means changing them — **client
  decision required**, not ours to make.

## Lighthouse (item 11) — measured on the dev machine, production build

- Accessibility: ~93 after fixing our own issues (closed cart drawer made
  `inert`, bag button accessible-name mismatch). The remaining gap to 95 is
  entirely the prototype-owned contrast items above — capped pending the
  client decision.
- Performance: the storefront is deliberately animation-heavy (GSAP/Lenis per
  the approved prototype); under Lighthouse's mobile 4× CPU throttle **on
  this busy dev machine** the home page scored 63 mobile / 77 desktop
  (CLS 0, no payload opportunities — the cost is main-thread animation JS).
  Treat the absolute numbers as environment-deflated; re-measure on the
  VPS/CI before drawing conclusions. Score-chasing here would mean stripping
  the prototype's animation, which Hard Rule #1 forbids.

---

## Money-out, multi-product promotions & recording returns

Three gaps found in review — all frontend + contract only; the backend fills
them in later against the same shapes.

**1. Trade-ins had no way in.** The payments ledger already carried negative
`trade-in` rows, but nothing could create one. New module
(`components/admin/tradeins/tradeins-view.tsx`) at `/admin/trade-ins` and
`/pos/trade-ins`: record the device, who it came from, an optional sell-request
reference, what was paid and how, plus whether it goes back out for resale and
at what price. Each payout posts a NEGATIVE `trade-in` transaction, so it comes
off revenue for the period instead of reading as a sale. Payout references use
their own `BUY-` series so a payout can never be mistaken for a sale.
New permission `tradein.manage`, granted to employees — buying a phone in is a
counter action, like petty cash. Employees still see no margins and no history:
the POS page renders the same module with `compact`, which drops the
month-to-date tile.

**2. Promotions were one product each.** `Promotion.productId` →
`productIds: Id[]`, with a searchable multi-select picker
(`components/admin/product-picker.tsx`) including one-click category
shortcuts ("All protection"). The till matches on `promotionFor()`, so a
single promotion now prices a whole range. **The tier is per-product**, not a
mixed basket — stated in the dialog and logged as open question 6.

**3. Returns could not be recorded.** The old screen only refunded an online
order by reference. A return is stock coming back, so the module now records
WHAT came back and where it goes. Three sources: online order (lines prefill
with per-line quantity steppers), counter sale (by receipt reference; items
added by hand until the backend persists sale lines), and no receipt (always
an override). Plus restock-vs-write-off, who processed it, and the refund
amount derived from the returned lines but editable for partials.

Verified in headless Chrome against the production build:

- A buy-in of £120 appeared in the ledger as
  `BUY-2042 · Trade-in payout · Trade-in · Cash · −£120`.
- A category shortcut selected 3 products in one click; the promotion saved and
  summarised as "Tempered Glass Pro, Pocket Repair Toolkit + 1 more".
- At the till, Privacy Glass (the _second_ product on a multi-product promo)
  dropped £15 → £12 each at qty 2 with the BULK DEAL badge.
- An online-order return auto-filled £24 from one returned line and recorded
  as "1× Aegis Mag Case · −£24 · Restocked".
- A no-receipt return was blocked until the override was ticked, then recorded
  and moved Braided USB-C Cable stock 41 → 42.

## Auth surface redesign (post-fix-pass)

The auth pages were rebuilt from a centred form on empty paper into a split
editorial door. Design authority here is ours (auth is not prototype-frozen),
and the language is still the storefront's: void black, plaster paper, Archivo
display with the Instrument Serif italic accent, the red used once per screen.

- **All auth CSS lives in `src/styles/auth.css`**, imported only by
  `app/(auth)/layout.tsx`. Nothing leaks into the storefront or the admin shell.
- **Left panel** (`components/auth/auth-panel.tsx`): blueprint grid, a drifting
  ember bloom, an outline wordmark used as texture, a per-route headline, the
  storefront's own three promises, a rotating verbatim Google review and a
  services ticker. Every claim on it is either existing site copy or computed
  live through `useReviews` — no invented business facts (HR#5).
- **Panel is hidden below 1024px.** That is deliberate: it is what keeps every
  auth route inside one viewport with no scrolling on small laptops and phones.
  A compact `AuthTrustRow` carries the same three facts on those sizes.
- **Password fields now have a show/hide toggle** (`AuthPasswordInput`).
- **`.spark` had to be re-declared in `auth.css`.** The shared `<Spark>` SVG is
  sized by a rule in `storefront.css`, which the auth routes deliberately do
  not load — without the redeclaration the SVG expands to fill its flex line
  (it was rendering 316px tall and adding ~300px to every card).

Verified in headless Chrome (CDP) across `login` / `register` /
`forgot-password` / `staff-login` at 1920×1080, 1512×800, 1440×900, 1280×720,
1100×800, 900×800 and 430×900: **28/28 combinations — no page scroll, no column
scroll, card fully inside the viewport.** The only horizontal overflow is the
duplicated marquee track inside its own `overflow: hidden` mask, by design.

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
- **A page that "fits" is not the same as a page that does not scroll.** When a
  column has `overflow-y: auto`, `document.scrollHeight` stays equal to the
  viewport while the content is quietly clipped inside the column. Measure
  `column.scrollHeight > column.clientHeight` _and_ the target element's
  `getBoundingClientRect()` against the viewport — the first auth measurement
  pass reported "no scroll" on layouts that were visibly cut off.
- **The mock DB is module state — a full page load resets it.** Recording
  something on one screen and then hard-navigating to another to check it will
  always show "nothing happened". Verify cross-screen effects by following the
  in-app `<Link>` (client-side navigation), which keeps the store alive.
- **`/admin` opens the daily float prompt over everything.** It is a real
  dialog, so `document.querySelector('[role="dialog"]')` in a test grabs it,
  not the one you just opened. Dismiss it first, or select the dialog by
  something inside it.
- **A stylesheet a route does not import is a stylesheet whose rules do not
  exist.** Shared components (`<Spark>`, storefront atoms) can depend on
  `storefront.css` for their sizing; drop them onto a surface that does not
  load it and they render at whatever the layout gives them.

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
