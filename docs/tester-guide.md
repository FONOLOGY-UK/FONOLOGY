# Tester guide

What Fonology is, how to run it on your machine, who to sign in as, what to try, and what is
known to be unfinished — so you spend your time finding new problems, not rediscovering these.

> `HOW-TO-RUN.md` still describes the old Supabase setup. **Use this page instead.**

## 1. What you are testing

A phone repair and accessories shop in Glasgow, as one system:

| Part            | Where                   | Who uses it                                                            |
| --------------- | ----------------------- | ---------------------------------------------------------------------- |
| Storefront      | `http://localhost:3000` | Customers: shop, repair booking, sell a phone, track an order, account |
| Admin dashboard | `/admin`                | Owner and managers                                                     |
| Till (POS)      | `/pos`                  | Counter staff                                                          |
| API             | `http://localhost:4000` | Everything above talks to it                                           |

It supports more than one shop (stage 3). A shop's staff see only their own shop's sales, stock and
money; owners and managers can switch between shops.

## 2. Setup (about 15 minutes)

You need: Node 20+, pnpm 11 and Docker Desktop. Nobody needs to send you any files or keys — `pnpm setup:env`
writes the two local env files, and you add your own Stripe **test** keys (see `SETUP.md`).

```bash
pnpm install
pnpm setup:env         # creates apps/api/.env.local and apps/web/.env.local (then add Stripe test keys)
pnpm stack:up          # Postgres, file storage, and Mailpit (email inbox) in Docker
pnpm db:migrate        # create the database tables
pnpm storage:setup     # create the image/document buckets
pnpm db:seed           # the three test logins below
pnpm --filter @fonology/api exec tsx scripts/seed-demo-catalogue.ts   # demo products
```

Then two terminals:

```bash
cd apps/api && npx tsx src/server.ts     # wait for "[api] listening on :4000"
cd apps/web && pnpm run dev              # wait for "Ready", then open http://localhost:3000
```

Always use **`localhost`**, never `127.0.0.1` — they are different origins and sign-in silently breaks.

Every email the system sends (sign-up confirmation, password reset) lands in Mailpit at
**http://localhost:8025**. Nothing is ever really sent.

> If `pnpm run dev` crashes with "An Application Control policy has blocked this file", Windows is
> blocking Next.js's compiler. Run the production build in Docker instead — see the "Production build"
> section of `packages/e2e/README.md`, or ask the developer.

## 3. Test logins

All passwords are `Test1234!`. These exist only on a local database.

| Who      | Email                    | Sign in at     | PIN  |
| -------- | ------------------------ | -------------- | ---- |
| Owner    | `owner@fonology.test`    | `/staff-login` | 1234 |
| Employee | `staff@fonology.test`    | `/staff-login` | 5678 |
| Customer | `customer@fonology.test` | `/login`       | —    |

The till locks and unlocks with the 4-digit PIN. Switching person with a PIN must **never** open the admin.

## 4. What to try

Work through these as a real person would. The automated tests do the same on a fixed script; you are
here for what a script would not think of.

**As a customer (no account needed for any of this)**

- Browse the shop, search, open a product, add to bag, change quantity, remove, check out as far as the card form.
  Use Stripe's test card `4242 4242 4242 4242`, any future date, any CVC.
- Check delivery prices change by postcode (e.g. a Glasgow `G46` against an island `KA27`).
- Try to buy a vape product online — it must not be possible.
- Book a repair in the wizard; sell a phone through `/sell`; look up an order at `/track`.
- Register, confirm by the Mailpit email, sign out, sign in, "forgot password".
- Read every footer page. **Legal pages are drafts** (see section 6).

**As an employee at the till**

- Sell something with cash, with card, and split across both. Apply a discount. Scan or type a barcode.
- Take a refund; try to refund more than was paid (must be refused).
- Take a repair deposit, then the balance. Cancel a paid job (must refund).
- Open and close the day; check the totals match what you took.
- PIN-switch to another person and back.

**As the owner/manager**

- Add, edit and retire products; receive stock; add a promotion; add a category.
- Online orders, repair board, trade-ins and payouts, reviews, reports, settings.
- Add a second shop, add staff to it, sign in as them and check they can see **only** their shop's data.
- Use the shop switcher, including "All shops" (writes there must be refused).

**Always**

- Resize the window to phone width. Nothing should scroll sideways.
- Watch the browser console for red errors.
- Try the wrong thing: empty fields, huge numbers, negative numbers, the back button mid-checkout.

## 5. The automated tests

```bash
pnpm typecheck && pnpm lint
pnpm db:test                                   # 600+ database checks
pnpm --filter @fonology/web test               # unit tests
pnpm --filter @fonology/api exec tsx scripts/e2e-test.ts      # API journey, ~80 checks
pnpm --filter @fonology/api exec tsx scripts/schema-audit.ts  # does the API still match what the website expects
pnpm --filter @fonology/api exec tsx scripts/e2e-shops.ts     # two-shop isolation
pnpm --filter @fonology/e2e e2e                # real-browser tests (Playwright), ~15 min
```

Known quirks of re-running them on the same day (these are test-data limits, not bugs):

- `e2e-test.ts` closes today's trading day as its last step; the till then refuses any further sale
  that day. Delete today's row from `day_close`, or run it once a day.
- A card machine may have a daily limit set on the main shop. If sales are refused with "over its
  daily limit", clear `card1_daily_limit` / `card2_daily_limit` on that shop (or wait until tomorrow).
- Password reset (5 per hour per IP) and customer sign-up are rate-limited, in memory. Several test runs in one
  hour can hit them and the account tests then fail with a 429. Restart the API to clear it.
- The main shop may carry a small card-machine daily limit in the dev data. If till sales are refused with
  "over its daily limit", clear `card1_daily_limit` / `card2_daily_limit` on that shop for the run.
- Playwright writes real rows tagged `PW<number>` and removes them at the end. If you kill a run,
  some can be left behind; they are harmless and tagged.

The regression packs (`regression-*.spec.ts`) are mapped to QA's five bug reports, item by item, in
`docs/qa-traceability.md` — start there to see what is proven and what still needs a human.

**A green run is not proof.** Playwright attaches screenshots of every step to its HTML report
(`packages/e2e/report`). Open them. This suite's own first run found two bugs everything else passed.

**Paying by hand with the Stripe test card?** Stripe's webhook cannot reach a laptop, so the order stays
"pending" (not paid) after you pay. That is expected locally, not a bug. Confirm it the way Stripe would:

```bash
pnpm --filter @fonology/api exec tsx scripts/simulate-stripe-paid.ts FNL-10001   # your order number
```

(Or run `stripe listen --forward-to localhost:4000/webhooks/stripe` with your own Stripe test account and put
the `whsec_` it prints in `apps/api/.env.local`.)

## 6. Known gaps — please don't report these

- **No real catalogue.** Only the demo products from the seed script. The shop enters real stock before opening.
- **Legal pages are drafts** written by the developer (privacy, terms, cookies, returns, shipping).
  A solicitor and the owner still need to confirm them — see `docs/legal-review.md`. About and FAQ are placeholders.
- **Printers are untested on real hardware**: the label printer, the receipt printer, long barcodes on receipts,
  and a second shop's print agent. Printing in the browser queues a job; whether paper comes out is unverified.
- **Not deployed anywhere yet.** The live server does not exist; `docs/go-live.md` is untested on a real VPS.
- **No analytics and no cookie banner**, on purpose — the cookie policy says so.
- Real Google sign-in and live Stripe payments are not configured locally.

## 7. Reporting a bug

Give: the page URL, who you were signed in as, the exact steps, what you expected, what happened, and a
screenshot. If something showed an error, the browser console text and the time. "It didn't work" cannot be fixed.
