# @fonology/e2e

Real-browser tests against a running Fonology — by default the local one (web
`http://localhost:3000`, API `http://localhost:4000`; override with `E2E_WEB_BASE` /
`E2E_API_BASE`). They drive the actual screens in Chromium: the till, the job
board, the admin, the storefront. The live site (`fonology.co.uk`) is refused unless
`ALLOW_TEST_WRITES=true`, which only exists before opening day.

## Why this exists

The rest of the test suite is thorough about the database (pgTAP) and has
scripts that prove the API. Neither sees what happens between loading a page
and saving it back. The first run of this suite found two bugs that everything
else had passed:

- **Editing a handset erased its IMEI.** The edit form opened with the field
  blank and the save sent `imei: null`. The API was fine throughout.
- **After a PIN switch the till had nothing to sell.** The rule that keeps a
  PIN session out of Admin also refused the till's own catalogue.

The second one passed this suite's own first draft too — the test treated the
refusal as the security property. It was caught from the screenshot. So every
test takes screenshots, and **a green run is not proof until the pictures
agree**.

## Running it

From the repo root, once per machine:

```bash
pnpm --filter @fonology/e2e e2e:install
```

Then:

```bash
pnpm --filter @fonology/e2e e2e
```

The HTML report, with every screenshot attached, lands in
`packages/e2e/report/`:

```bash
pnpm --filter @fonology/e2e exec playwright show-report report
```

Cleanup runs automatically at the end and needs `apps/api/.env.local` (DATABASE_URL for the
target), because deleting rows is the API package's job, not this one's.

## What it does to the target — read before running

It **writes real data**, then removes it. Every fixture is named with a run tag
(`PW` + digits) and `apps/api/scripts/e2e-cleanup.ts` deletes exactly those rows.
Along the way it:

- creates jobs, a repair request, a trade-in request and two products
- **rings a £5 sale through the till** and fills in its cost
- queues a receipt reprint and an End Day summary
- sets Card 1's daily limit to £50, then restores whatever was there before
- **PIN-switches the owner test account into the employee's** — which ends the
  owner test account's session everywhere. Anyone signed in as that account on
  staging at the time is signed out. It runs last for that reason.

**It refuses to run against production** (`fonology.co.uk`), and the cleanup
refuses the production database. There is no override: none of this belongs in
the shop's real records.

## The specs

| file                               | what it is                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `change-request-sept-2026.spec.ts` | the 14 items of the September change request                                                                                                                                                      |
| `crawl-every-screen.spec.ts`       | every storefront, back-office and till screen as a guest, the owner, a Shop 2 manager and a Shop 2 employee — fails on page errors, console errors, 5xx and error pages, and photographs each one |
| `customer-journeys.spec.ts`        | owner adds + edits a product through the form; a guest finds it, bags it, pays with Stripe's test card; the order shows in Online orders                                                          |
| `shop-floor.spec.ts`               | a repair booked through the wizard → Repair Requests → the bench; a trade-in sent in through the sell wizard → the owner's queue                                                                  |
| `till-and-shops.spec.ts`           | the till (cash sale, repair deposit, cancel-with-refund) and the second shop: no leakage from Shop 1, add from the master list, own price and stock                                               |
| `owner-admin-clickthrough.spec.ts` | Shops, Staff, shop switcher, promotions "Runs in", Till only, paged lists                                                                                                                         |
| `responsive.spec.ts`               | phone and tablet widths: nothing scrolls sideways                                                                                                                                                 |

Fixtures are named with the run tag so `e2e-cleanup.ts` can remove them; the shops and staff accounts these
specs make are switched off, not deleted.

**Locally Stripe never delivers its webhook**, so a card payment leaves the order `pending`.
`customer-journeys` runs `apps/api/scripts/simulate-stripe-paid.ts <reference>`, which sends the signed
`payment_intent.succeeded` event the way Stripe would; the real handler does the rest.

**Two traps when writing a spec here.** Playwright's `isVisible({ timeout })` does not wait — use
`locator.waitFor`. And its screenshots put `caret-color: transparent` on inputs, which React reports as a
hydration warning in the console; the specs filter that one message out.

**Card limits.** `e2e-test.ts` rings a £5 card payment; if Card 1's daily limit is low and enough card takings
have built up that day, the till correctly refuses it and that script fails. It is the limit working, not a bug.

## Settings

| variable                                                        | default                                            |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `E2E_WEB_BASE`                                                  | `https://fonology-web.onrender.com`                |
| `E2E_OWNER_EMAIL` / `E2E_OWNER_PASSWORD`                        | the standing dev fixture owner                     |
| `E2E_EMPLOYEE_EMAIL` / `E2E_EMPLOYEE_NAME` / `E2E_EMPLOYEE_PIN` | the standing dev fixture employee                  |
| `E2E_SKIP_CLEANUP=1`                                            | leave the run's fixtures in place, to inspect them |

The defaults are dev-only accounts that exist only in the dev database — the
same ones `apps/api/scripts/e2e-test.ts` uses.

## If a test fails

Look at the screenshot and the trace before deciding it is the app. Most
failures while writing this were the test being wrong about the page — a
table where it expected a list, an accessible name carrying a price, a list
read before it had loaded. Two were real. Telling them apart is the job.

Render's free plan hibernates idle services; while one wakes it answers
`429` with `x-render-routing: hibernate-rate-limited`. The global setup waits
that out, but a cold run is slow.

## Production build (when `next dev` will not start)

On a Windows machine where Application Control blocks Next's native compiler, run the web app from its
Docker image instead. Two details matter, and getting either wrong looks like an app bug:

- `localhost` inside the container must reach the API on the host: `--add-host localhost:host-gateway`.
  Without it `/shop` returns 500 ("Could not reach the server").
- The Stripe publishable key is baked in at build time: pass `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` as a build
  arg, or the checkout has no card form.

```bash
docker build -f apps/web/Dockerfile -t fonology-web-local \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
  --build-arg STORAGE_PUBLIC_URL=http://localhost:3902 \
  --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<your pk_test key> .
docker run -d --name fnl-web -p 3000:3000 --add-host localhost:host-gateway fonology-web-local
```
