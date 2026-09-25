# @fonology/e2e

Real-browser tests against a **deployed** Fonology — by default the staging site on
Render. They drive the actual screens in Chromium: the till, the job board, the
admin, the storefront.

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

Cleanup runs automatically at the end and needs `apps/api/.env.local` (the dev
service key), because deleting rows is the API package's job, not this one's.

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
