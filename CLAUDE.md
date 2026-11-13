# CLAUDE.md — running Fonology and keeping it up

Fonology (fonology.co.uk) is a UK phone-repair and accessories shop in Thornliebank, Glasgow. This file and
`docs/` are the **only** documentation in the repo. This file holds what every session needs: how a change goes
live, what runs where, the rules in the code that must not be broken, and local development. `docs/` holds the
rest: how the site is run, what to check, and what to do when something breaks. If this file and the repo disagree, the repo is right — fix this
file in the same change.

**This repository is public.** Never commit secrets, IP addresses, personal data or customer data. Server
addresses, passwords and keys live in the owner's password manager and in Coolify, never here.

## Where the rest lives

Sections 2–10 and 12–14 are in `docs/`, one file each, numbered as before, so "section 5" anywhere means
`docs/05-deploying.md`. **Read the file before doing what it covers**; do not work from memory. If you change how
something there works, fix that file in the same change.

| Section                                      | File                               | Read it when                                                                                          |
| -------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2. Getting in (operator)                     | `docs/02-getting-in.md`            | Getting onto the server, Coolify or the netcup panels                                                 |
| 3. Alerts and what to do                     | `docs/03-alerts.md`                | A Discord alert arrives, or changing the watchdog, uptime check or alerting                           |
| 4. Routine maintenance                       | `docs/04-maintenance.md`           | Doing the daily, weekly or monthly checks, or about to deploy                                         |
| 5. Deploying and rolling back                | `docs/05-deploying.md`             | Deploying by hand, a migration going live, a rollback, web build variables, Coolify quirks            |
| 6. Backups and restore                       | `docs/06-backups.md`               | Backups, a restore drill, a real restore, or a lost server                                            |
| 7. Configuration reference                   | `docs/07-configuration.md`         | Adding or changing an environment variable, one-off commands, scheduled tasks                         |
| 8. Security posture                          | `docs/08-security.md`              | Touching the firewall, SSH, Coolify access, Postgres roles, file access, sessions or secrets          |
| 9. When something breaks                     | `docs/09-when-something-breaks.md` | The site is down, the API is unhealthy, payments or emails fail, or a secret leaked                   |
| 10. Going live (still to do)                 | `docs/10-going-live.md`            | Moving off test mode (live Stripe keys, opening-day steps), a hostname change, or the local rehearsal |
| 12. Print agent and the shop hardware        | `docs/12-print-agent.md`           | Anything about printing, the till PC, receipts, labels or card machines                               |
| 13. Legal assumptions the owner must confirm | `docs/13-legal.md`                 | Editing legal pages or anything they state                                                            |
| 14. Known open items (as of the last audit)  | `docs/14-open-items.md`            | Before testing customer flows, and before picking up or reporting a known problem                     |

## 0. Start here if you are new (a contributor, or their Claude)

Two people work on this. **Kashir** is the operator: he built the system, holds the server, Coolify, Stripe and
Brevo access, and does anything in sections 2–9 by hand. **Hashir** (and his Claude) changes the code through
GitHub and puts it live with the **Deploy button**. That needs no server access; do not ask for it.

**The system in plain words.** The code lives on GitHub (`FONOLOGY-UK/FONOLOGY`). The live site runs on one rented
Linux server from **netcup** (a German hosting company; the account is Kashir's). On it, **Coolify** (a self-hosted
dashboard like Heroku or Vercel) runs everything as Docker containers. To deploy, Coolify pulls `main` from GitHub,
builds `apps/api/Dockerfile` and `apps/web/Dockerfile`, starts the new container, waits for its health check, and
only then moves traffic to it. If a build or health check fails, the old container keeps serving. Traefik (inside
Coolify) does HTTPS. Postgres and Garage (S3-style file storage) are containers on the same server and cannot be
reached from the internet, so nothing outside the server can run SQL against the live database.

**GitHub never deploys on its own**, except while Fast ship is on (below). Otherwise merging to `main` changes nothing on
the live site until someone presses Deploy.

| Workflow (`.github/workflows/`) | Runs                         | Does                                                                                                   |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ci.yml` — CI                   | every push and PR            | typecheck, lint, both production images build                                                          |
| `rehearsal.yml`                 | every push to `main` (~5 m)  | the real images + Postgres + Garage + TLS on the runner: migrations, jobs, backup drill, go-live-check |
| `deploy.yml` — Deploy           | only when someone presses it | checks, then deploys `main` (API, then web) through Coolify and checks the site answers                |
| `uptime.yml`                    | asks for every 10 minutes    | calls the live site; posts `SITE DOWN` to Discord if it fails (GitHub really runs it every 5–8 hours)  |
| `fast-ship.yml` — Fast ship     | CI passing on a PR           | only while repo variable `FAST_SHIP=true`: merges Raja's/Hashir's PR and starts Deploy in fast mode    |

**The normal loop for a change:**

1. Branch off an up-to-date `main` (`git switch main && git pull && git switch -c short-name`). Never push to `main`.
2. Run it locally (section 15) and make the change within the rules in section 11.
3. `pnpm typecheck && pnpm lint`. Touched dependencies, a Dockerfile, `deploy/` or the entrypoint? Build the image
   too (section 11); the rehearsal on `main` will also catch it, but later.
4. Click through what you changed in a browser on localhost. There is **no automated test suite**, on purpose.
5. Push and open a PR; say what changed and how you checked it. CI must be green.
6. Merge it (merge commit, like the history). Then wait for **Production rehearsal** on `main` to go green (~5 min).
7. **Deploy:** GitHub → Actions → Deploy → Run workflow → branch `main`, or `gh workflow run deploy.yml --ref main`
   then `gh run watch`. About 5–10 minutes. Discord `#fonology-alerts` gets "Deployed abc1234 (by you)".
8. Look at the live site yourself: the page you changed, `https://api.fonology.co.uk/health/ready` and
   `https://fonology.co.uk/api/health`. Customer flows need a private window (section 14).

**Fast ship (busy shop days):** `gh variable set FAST_SHIP --body true` makes every non-draft PR from `askkashir` or
`FONOLOGY-UK` merge itself when CI passes and go live without the rehearsal wait (about 7–8 minutes from opening the PR).
Migration PRs are still left for Kashir. Turn it off with `--body false` when the day is over. Its merges start no CI or
rehearsal on `main`, so the next normal Deploy refuses until a normal merge (or a by-hand rehearsal run) has passed.

**When Deploy refuses or fails, it says why.** Not run from `main` / main moved on: run it again from `main`. CI or
rehearsal not passed: wait, or fix the red run. **Migration changes**: the change adds or edits a file in
`db/migrations`, which needs Kashir to deploy it by hand (section 5); tell him the PR and stop. **Pinned**: Kashir
rolled back; ask him. **Deployment failed / site not answering**: the old version usually keeps running; tell Kashir
(he reads the Coolify log) and do not keep re-running it. The run log is public, so it shows states, never logs.

**Only the operator does:** anything on the server; Coolify variables and secrets (including the web build variables
in section 5, which need a rebuild); putting a migration live; rollback; restores; DNS; the Stripe, Brevo, Google and
Backblaze dashboards. If a change needs one of these, say so in the PR.

**The shop has been trading on the live site since 9–10 November 2026** (real inventory, real till). Deploy outside shop
hours unless it fixes something broken, and check the till after. Online card payments are still Stripe **test** keys
(section 10). Test logins are in the gitignored `TEST-LOGINS.md`: get a copy from Kashir,
never commit it. Stripe test card: `4242 4242 4242 4242`, any future date, any CVC.

## 1. What runs where

| Piece              | What / where                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `apps/web`         | Next.js 15 storefront + admin dashboard + till (`/pos`). Docker image, port 3000.                  |
| `apps/api`         | Express + TypeScript. Only holder of DB and storage credentials. Docker image, port 4000.          |
| `apps/print-agent` | Runs on the shop's till PC (not on the server). Drives the label and receipt printers.             |
| `db/migrations`    | Numbered, additive SQL. Applied by the API image's entrypoint when `MIGRATE_DATABASE_URL` is set.  |
| Server             | netcup VPS (Ubuntu 24.04), managed by **Coolify** (Traefik proxy, Let's Encrypt).                  |
| Coolify resources  | `postgres` (Postgres 17, **Debian image**), `fonology-api`, `fonology-web`, `garage` (S3 storage). |
| Off-server backups | Backblaze B2 bucket `fonology-backups` (database dumps + Garage mirror).                           |
| Alerts             | Discord channel `#fonology-alerts`.                                                                |
| Third parties      | Stripe (online card payments), Brevo (email + SMS), Google (sign-in), GitHub (code, CI, uptime).   |

Public hostnames at launch: `fonology.co.uk` (web), `api.fonology.co.uk`, `product-images.web.fonology.co.uk`
(public photos), `s3.fonology.co.uk` (signed links to private files). Web and API **must** share one registrable
domain: the session cookie is `SameSite=Lax` only when they are same-site.

Postgres, Garage's admin port and Coolify's dashboard are **never** published to the internet.

## 11. Code rules that must not be broken

- **No component calls `fetch()`.** Component → `src/lib/data/hooks` → `DataAdapter` → `http.adapter.ts` → API. Every
  response is parsed by a Zod schema in `apps/web/src/lib/data/types/`; change the schema in the same commit as the endpoint.
- **All money is integer pence; the server computes every figure.** The till and checkout send ids and quantities.
- **Staff attribution and the shop come from the session, never the request body** (`lib/shopScope.ts`).
- **References come only from `issue_shop_reference()`** (`F01-JOB-061026001`: shop, prefix, shop-day DDMMYY, counter).
  Never generate one in app code; never sort by reference — sort by `created_at`.
- **No VAT anywhere** (not VAT registered). **Customers never see stock counts, cost or margin.** Cost fields go out
  only through `hideCosts()` for staff without `costs.view`. `shop_settings` is the single source of shop facts.
- Permissions in the web app only control what renders; real checks are in the API and `staff_can()`. Never trust `staff.role`.
- **Money-out rules** (refunds and trade-in payouts), enforced in the API before any money moves: a refund can never exceed what is left on the sale or order (checked before Stripe is called); money goes back the way it came (a sale's refund per method is capped at what was paid by that method, an online order paid through Stripe is refunded to Stripe); a cash refund or cash payout must not take the drawer below zero; a payout cannot exceed the accepted offer. The last three are exceptions an authorised person (`returns.override`) can approve with the admin override box, and the exception is written into the refund reason or payout note. Online-order refunds email the customer; the order list shows Refunded / Part refunded.
- **Petty cash is its own pot** (0121, `lib/pettyCash.ts`), not part of the drawer, from `shop_settings.petty_cash_separate_from` on: a day opens with what the week's last day close counted in the tin (or the week's entries), every Monday starts again at £0, a Petty Cash Out can't exceed what the tin holds, and no petty entry is taken once today is closed. The day close counts the tin separately (blind, like the drawer) and stores its own figures; the End Day print shows it as its own section.
- **Barcodes and Goods in** (0122, 0123): a product or variation has one main barcode (`barcode` column, the one labels print) plus any number of extras (`product_barcodes`); one barcode belongs to one thing per shop, enforced by triggers. Shop-generated barcodes stay 13 digits starting `29` (GS1 in-store range) and shelf labels print FONOLOGY above the bars. Goods in (`record_goods_in_v2`) receives stock per product line, registers a barcode nothing had on the product it turns out to be, and puts an unknown one in the "to link" list (`goods_in_barcodes`) whose stock is received only when linked (`link_goods_in_barcode`). Admin → Barcode register is the audit report. A quick Goods in product is till-only (unlinked from the master list). Since 0124 a Goods in line can register several new barcodes at once, and a quick Goods in phone (Mobiles or under) asks for one IMEI per handset and becomes one variation per IMEI. The printed End Day summary has a CASH DRAWER section from the same calculation as the day close (`lib/cashDrawer.ts`).
- **Categories** (0125) nest to any depth. Anything that asks "is this under Vape / Mobiles?" must walk every ancestor (`category_is_under()` in SQL, `lib/category-tree.ts` in the web app): checking one parent would list a nested vape online. What the website can see is decided in one place, the `online_copies` view, which excludes `categories_hidden_online` (Show on Website off, and Vape always). Never copy that switch onto `in_store_only`. The till's folders are the category tree; `product_folders` is unused and stays in the database.
- **Promotions** (0126) are till-only. A tier is a total ("2 for £10"); its per-item rate applies from that quantity until a bigger tier takes over, so with 2 for £10 and 4 for £16, 3 cost £15 and 5 cost £20. One rule, two copies that must match: `apps/api/src/lib/promoPricing.ts` (charges) and `apps/web/src/lib/promo-pricing.ts` (the ticket on screen); a difference makes the payments not add up and the sale is refused. A deal that doesn't divide evenly becomes two sale lines of whole-pence prices. Mix & Match counts everything the offer covers together. A product deal beats a category deal, a nearer category a further one, the newest wins a tie, and offers never stack.
- **Variations** are entered line by line (`addVariationRows`): each line is one value of a single option, so the combination code in `lib/variations.ts` still stores them. The matrix UI is archived on the branch `archive/variation-matrix`, unmerged, to bring back if the client asks.
- **Cost** (0128): a receipt with a unit cost sets the weighted average of what is on the shelf and what came in. A cost typed on the product form overrides it. Edit forms (product form, variation row and pop-up) send the stock and cost they opened with (`stockQtyWas`, `costPriceWas`; `apps/api/src/lib/stockEdits.ts`): an untouched box moves nothing, and a changed count is refused if a sale or delivery moved stock while the form was open — saving used to undo it. Keep sending both from any new edit screen. **Scheduled Petty Cash In** is a future-dated `cash_entries` row: nothing runs on the day, and because a day's petty cash is calculated from £0 on Monday, an entry dated on a Monday lands after the reset. Do not add a job for this; that is what would make the order matter.
- **Scanning into the product form**: while Add / Edit product is open, a scan goes into the focused barcode box, or else the first empty one (`data-scan-target`, `lib/scanner/use-scan-into-boxes.ts`), and its Enter never saves the form. Scan timing uses each key's own timestamp, so a busy page cannot stretch a scan into "typing".
- **Job parts** (0127) can be a variation, or a misc part with no product and no stock movement; a misc part with no cost waits in Missing costs.
- **PIN sessions**: everything under `/admin` is refused except the lists in `middleware/auth.ts`. When the till gets a new module, add its routes there (each route still checks its own permission). The till's other days of cash are closed to everyone without `reports.view`, in the API.
- **No sideways scrolling in admin or the till.** The shop PCs have a mouse only, so nothing may sit out of reach to the right. Tables fit their width and wrap (`DataTable`, the variant tables use `table-fixed`), tab rows wrap. Check at 1280 and 1024 wide. Where something truly cannot fit, it gets a visible horizontal scrollbar; never a hidden one.
- `/shop/[slug]` is `revalidate = 0` on purpose (vapes must stop being purchasable the instant a product moves category).
- `any` is banned by lint. Use `createRouter()` for new API routers. Arrays written to `jsonb` need `JSON.stringify`.
- `storefront.css` is the client-approved design, copied verbatim: new rules go in `storefront-extend.css`.
- There is **no automated test suite** (deleted on purpose). Checks are `pnpm typecheck`, `pnpm lint`, the images
  building, and clicking the flow in a browser. After touching checkout, sell or till code, run the whole flow.
- Changing dependencies: write the lockfile with the pinned pnpm (`npx pnpm@11.0.9 install --lockfile-only`), install
  with the local pnpm, then **build the web Docker image** — pnpm 9 and 11 hoist differently. Do not add
  `kysely-codegen` as a dependency.
- Never print `.env*` values. `.env.local` files and `TEST-LOGINS.md` are gitignored.

**Database:** numbered additive migrations in `db/migrations`; **a migration is frozen the moment it is pushed** (the
runner checksums each file) — fix mistakes with a new one. A new enum value cannot be used in the transaction that adds
it, so adding and using it takes two files. RLS is deny-all with no policies; authorization is in the API. After a
migration run `pnpm --filter @fonology/api db:types`. Roles: `fonology_owner` (owns the schema, runs migrations),
`fonology_api` (the app's login, BYPASSRLS, no DDL).

**Multi-shop:** every till-owned row has a `shop_id`; the shop is never taken from a field an employee controls
(`readShop` / `writeShop`). The public site and online orders, repairs and trade-ins belong to the hub shop. Stock is
per shop; online stock is the sum across shops. Refunds come out of the refunding shop's drawer.

**Checkout:** cart → `POST /orders` (server prices everything, including delivery) → Stripe PaymentIntent → signature-verified
webhook marks it paid and consumes stock. Sell/trade-in (`POST /sell/requests`) is public. The till's `completeSale` is
one transaction; split payments must sum exactly to the total.

## 15. Local development

Needs Docker Desktop, Node 22 and pnpm (`corepack enable` picks the version pinned in `package.json`).
`pnpm setup:env` writes the local `.env.local` files with dev-only values; nothing from production is needed.
Card checkout locally needs your own Stripe **test** keys in them (see the top of `scripts/setup-env.mjs`).

```bash
pnpm install
pnpm setup:env && pnpm stack:up && pnpm db:migrate && pnpm storage:setup && pnpm db:seed   # first time
cd apps/api && npx tsx src/server.ts      # wait for "[api] listening on :4000"
cd apps/web && pnpm run dev               # http://localhost:3000
pnpm typecheck && pnpm lint
```

`docker-compose.dev.yml` gives Postgres 17 on `:55432`, Garage on `:3900`/`:3902` and Mailpit (SMTP `:1025`, inbox
`http://localhost:8025`). The local database is a **test** database; copy nothing from it to production. Use
`localhost`, never `127.0.0.1`, for `NEXT_PUBLIC_API_BASE_URL` (different origin, breaks the cookie). From Git Bash,
`docker compose exec … /garage …` and any `docker exec`/`docker cp` with a /path needs `MSYS_NO_PATHCONV=1` or Git Bash rewrites the path.
