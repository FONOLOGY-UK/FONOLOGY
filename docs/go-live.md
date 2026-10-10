# Going live — netcup VPS + Coolify

The runbook for the first production deployment. **Nothing here has been run on the real server yet** — the VPS does
not exist. Everything up to the server itself has been run end to end on a laptop by the dress rehearsal (§9a), and the
steps it proves are marked ✅. `docs/coolify-env-vars.md` is the variable-by-variable checklist; this document says
what to do, in what order, and why.

Order: §2 box → §3 Coolify → §4 resources (Postgres, Garage, API, web) → §4.5 pre-DNS staging pass → §5 first data →
§6 backups → §7 Stripe → §8 email → DNS cutover → §9 prove it → §10 opening day.

## 0. Where the code stands (2026-10-10, `main`)

✅ typecheck, lint, pgTAP (748), `schema-audit` (0 hard failures), both production images build from a clean checkout.

✅ **Dress rehearsal** (`pnpm rehearsal:up && pnpm rehearsal:test`, §9a): the production images on the official
Postgres 17 image and the production Garage compose file, behind a TLS proxy, deployed the way this runbook says.
It covers: all 106 migrations through the entrypoint, `storage-setup` on a blank Garage, a second deploy with the
superuser URL removed, `e2e-test`, `e2e-variations`, `e2e-repair-pricing`, `e2e-shops`, `schema-audit`, every
scheduled job, a backup → restore drill, a graceful SIGTERM stop, and `go-live-check`.

**What the rehearsal caught** (each would have failed on the real server):

1. `storage-setup` could not set up a blank Garage. It never applied a cluster layout, and the runbook told you to copy
   a key it never printed. It now does both (§4.2).
2. The env sheet's `MIGRATE_DATABASE_URL` ended in `/postgres`. The runner migrates the database the URL names, so
   the API's `fonology` database would have stayed empty (§4.1).
3. Alpine Postgres sorts text by raw bytes, unlike dev. Use the Debian `postgres:17` image (§4.1).
4. The web build fetches its two Google Fonts at build time, and one build failed on a network blip. If a web deploy
   fails with `Failed to fetch … from Google Fonts`, redeploy.
5. The security-hardening pass hid database internals from error messages. That also silently broke three routes that
   read the constraint name out of the message: duplicate staff email, duplicate device name, and **duplicate
   barcode**, which should tell the till which product already has the barcode. They now branch on the constraint
   name (`DbError.constraint`).
6. The browser suite (`packages/e2e`) is written against the shop's own categories (Accessories › Cases), not the
   migrations' seed ones, so apply the starting set-up (§5) before running it on a new database.
7. The plan was to copy the shop's set-up from the old Supabase project, but that project no longer answers. Our own
   dev database turned out to be a test database: its products are demo items, its devices and prices are tester-made,
   and it holds about 200 test accounts. The real set-up is now a short reviewed file, `deploy/shop-setup.json` (§5).
   Supabase is not needed for anything.
8. A brand-new owner started **without `reviews.manage`**: Admin → Reviews was blank, so reviews could never be
   approved. Migration 0072 had dropped it from the owner's starting set, and existing owners never showed it. Fixed by
   migration 0111; a pgTAP test now requires the owner to start with every permission.
9. More fallout from the hardening (see 5): refusals our own database functions raise with a specific SQLSTATE were
   hidden behind "That could not be saved". Those were "That quote is below the shop price…", "Job … still owes £…",
   and the card-payment limits. Anything raised by our own functions now passes through again; real constraint
   violations stay hidden.

Already in the code for this deployment:

| what                                          | why                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TRUST_PROXY_HOPS` (default **1**)            | Must match the real proxy chain. Too high lets a visitor forge `X-Forwarded-For` and pick the address the login rate-limiter sees — brute-force protection defeated. `go-live-check` tests it. **2 only if Cloudflare is in front.** |
| `apps/api/docker-entrypoint.sh`               | Applies migrations _before_ the server starts when `MIGRATE_DATABASE_URL` is set. See §4.3 — Coolify's pre/post-deployment hooks cannot do this safely.                                                                              |
| `storage-setup.js` bootstraps Garage          | Applies the single-node layout, imports the API's S3 key, creates the three buckets. Idempotent.                                                                                                                                     |
| `GET /health/ready`                           | Checks the database. `/health` stays shallow (the container's liveness probe; a DB blip must not restart a healthy API). Point the uptime monitor at `/health/ready`.                                                                |
| SIGTERM handling                              | A deploy finishes in-flight requests (a sale, a payment webhook), closes the DB pool, and exits 0.                                                                                                                                   |
| Security headers, CSRF guard, report-only CSP | Web: HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy-Report-Only`. API: `nosniff`, `no-referrer`, no `X-Powered-By`; cookie writes from a foreign `Origin` are refused.        |
| `deploy/`                                     | Production Garage config + compose file (`deploy/docker-compose.garage.yml`), and the rehearsal (`deploy/rehearsal/`).                                                                                                               |

## 1. Shape of the deployment

```
Internet ─▶ Traefik (Coolify, TLS via Let's Encrypt)
              ├─ fonology.co.uk                       ▶ web   (Next.js, :3000)
              ├─ api.fonology.co.uk                   ▶ api   (Express, :4000)
              ├─ product-images.web.fonology.co.uk   ▶ garage (:3902, public photo reads only)
              └─ s3.fonology.co.uk                   ▶ garage (:3900, S3 API — signed links only)
private Docker network:  postgres:5432 · garage:3903 (admin) · the API also reaches garage:3900 directly
```

Web and API on one registrable domain (`fonology.co.uk` / `api.fonology.co.uk`) is **required**: the session cookie is
`SameSite=Lax` only when they are same-site (`lib/cookies.ts`), and browsers call the API directly. (If they are ever
cross-site — possible during §4.5 — the web app routes browser calls through its own `/api-proxy` instead, and
`INTERNAL_PROXY_SECRET` must then be set to the same value on both.)

The web server also calls the API **server-side** (product pages render from the live API on every view), so the web
container must be able to resolve and reach `api.fonology.co.uk` — on a single VPS that is a hairpin back through
Traefik, which works. `go-live-check` proves it ("a product page renders from the API").

DNS: `A` records for `@`, `www`, `api`, `s3`, `product-images.web` → the VPS IP. `www` → redirect to the apex (Coolify domain
setting). Nothing needs a wildcard. Today the domain points at an old, unrelated WordPress install — whoever controls the
registrar has to be found before any of this can change.

## 2. The VPS (netcup)

- VPS 1000 G12 (4 vCore / 8 GB) or bigger — a Next.js build alone peaks at 1–2 GB next to Postgres, Garage and the API.
  Confirm the disk type (NVMe) at order time.
- Ubuntu LTS, a non-root sudo user, **SSH keys only** (disable password and root login), `unattended-upgrades`, `fail2ban`.
- Firewall: allow only 22, 80, 443. **Docker bypasses `ufw`** — a published container port is reachable even if `ufw` says
  deny (Docker's NAT runs before `ufw`'s INPUT rules). So do both: never publish a port you don't mean to (no `5432`, `3900`,
  `3903` on the host), _and_ put the policy in the `DOCKER-USER` chain. Coolify's dashboard (8000) should sit behind its own
  domain over HTTPS, not an open port. Check from outside: `nmap -Pn <ip>` shows 22/80/443 only.
- Turn on netcup snapshots as a _second_ net — they are not the backup (§6).
- Add a few GB of swap; set memory limits on the three apps in Coolify so one runaway cannot take the box down.

## 3. Install Coolify

1. Install Coolify, then **immediately copy `/data/coolify/source/.env` off the server** — losing it means losing access.
2. Give the dashboard its own domain + HTTPS, create the admin with a strong password and **2FA**, add email/Telegram
   notifications for failed deploys and failed backups.
3. Connect the GitHub repo (deploy key). Turn auto-deploy **off** and deploy by hand until you trust it.

## 4. Resources, in this order

Variables for every resource: **`docs/coolify-env-vars.md`**. Generate every secret with `openssl rand -hex 32` (or
`-hex 16` for passwords) and keep them in one password manager entry.

### 4.1 PostgreSQL 17

Coolify one-click Postgres, **image `postgres:17` — the Debian one, not `postgres:17-alpine`**. Coolify asks for the image
when the resource is created (some versions default to an `-alpine` tag); check it under Configuration → General before
the first migration. The rehearsal found why: Alpine's musl libc ignores the `en_US.utf8` collation and sorts text by raw
bytes, so "Zebra" sorts before "apple" and every `ORDER BY name` in the app (product lists, inventory, goods-in lines)
differs from what was tested. Changing it later means a dump and restore, so get it right on day one. The official
image includes `citext`, `fuzzystrmatch`, `pg_trgm`, which the migrations need ✅. Not publicly exposed. Create the database `fonology`. You need two URLs, **both ending in `/fonology`**:

- `MIGRATE_DATABASE_URL` — the `postgres` superuser (migrations create roles cluster-wide):
  `postgres://postgres:<superuser password>@<host>:5432/fonology`. The migration runner migrates _the database named in
  the URL_ — pointing it at `/postgres` would migrate the wrong database and leave `fonology` empty.
- `DATABASE_URL` — the `fonology_api` role the migrations create:
  `postgres://fonology_api:<FONOLOGY_API_DB_PASSWORD>@<host>:5432/fonology`.

### 4.2 Garage

1. Add `deploy/docker-compose.garage.yml` as a Docker Compose resource; set `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`,
   `GARAGE_METRICS_TOKEN` (`openssl rand -hex 32` each).
2. Domains: `product-images.web.fonology.co.uk` → port 3902 (public photos) and `s3.fonology.co.uk` → port 3900 (browsers
   open the 60-second signed links to private files there). **Never** give 3903 (admin) a domain or a published port.
3. Generate the API's S3 key yourself — Garage imports a key in exactly this shape:
   ```bash
   echo "S3_ACCESS_KEY_ID=GK$(openssl rand -hex 12)"
   echo "S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)"
   ```
   Put both in the API's variables (§4.3) before its first deploy.
4. After the API's first deploy, run once in a terminal in the API container (or a Coolify one-off task), with
   `GARAGE_ADMIN_URL=http://garage:3903` and `GARAGE_ADMIN_TOKEN` set for that run:
   `node dist/scripts/storage-setup.js`. ✅ On a blank Garage it applies the single-node layout (Garage refuses all S3
   traffic until it has one), imports the key from step 3, creates `product-images` (public) and `id-documents`,
   `buy-in-forms` (private). Safe to re-run. **Do this before the first upload.**

Garage's own docs say a single node has **no redundancy** and is not recommended for production. It is acceptable here
because it only holds product photos and short-lived ID documents, and §6 backs it up. It deploys as Docker Compose, so it
does not get Coolify's rolling restart — a Garage redeploy is a few seconds without photos.

### 4.3 API (Dockerfile `apps/api/Dockerfile`, build context = repo root, port 4000, domain `api.…`)

Health check path `/health`. Variables: `docs/coolify-env-vars.md` → API.

**Migrations.** Do **not** use Coolify's pre-/post-deployment commands: _pre_ runs in the **old** container (so on the very
first deploy it is skipped, and later it only knows the old migration files) and _post_ runs after the new container is
already serving. Instead, for any deploy that carries a migration: add `MIGRATE_DATABASE_URL` and
`FONOLOGY_API_DB_PASSWORD` to the API's variables, deploy, confirm healthy, then **remove both and redeploy** so the running
API doesn't hold superuser credentials. The entrypoint applies pending migrations first; if one fails the new container
never becomes healthy and Coolify keeps serving the old API. ✅ empty DB → all applied → server start; ✅ the redeploy
without them boots and runs no migrations. Migrations are additive only, so the old API is safe against the migrated
database during the swap.

**Scheduled tasks** (Coolify → API → Scheduled Tasks, run inside the API container) ✅ each exits 0:
`node dist/scripts/purge-documents.js` daily 03:00 · `node dist/scripts/purge-print-jobs.js` daily 03:10 ·
`node dist/scripts/purge-sms-log.js` daily 03:20 (blanks repair-text phone numbers and bodies after 180 days) ·
`node dist/scripts/purge-housekeeping.js` daily 03:30 (deletes sale retry keys, expired sessions and emailed tokens older than 7 days).

### 4.4 Web (Dockerfile `apps/web/Dockerfile`, port 3000, domain `fonology.co.uk`)

Health check `/api/health`. Its three variables are **Build Variables** (Next inlines them at build time; a runtime-only
value bakes in as `undefined`) — see `docs/coolify-env-vars.md` → Web. `go-live-check` reads them back out of the deployed
site ("the web build knows the API address"). After any dependency change, build the web image in Docker before shipping
(pnpm 9 and 11 hoist differently).

The API and web log `INTERNAL_PROXY_SECRET is not set` at boot. In the final same-site topology that is expected and
harmless; it only matters when web and API are cross-site (§1, §4.5).

### 4.5 Pre-DNS staging pass — the whole suite on the real server, before cutover

The VPS will probably exist before the DNS does. Use the gap: deploy everything on temporary hostnames and run every
test suite against the real box, then wipe it and cut over.

1. **Hostnames.** Best: subdomains of a domain you control (e.g. `staging.<yours>`, `api.staging.<yours>`, …) with real
   Let's Encrypt certificates — same shape as production. Fallback: Coolify's generated `*.sslip.io` names. Two caveats
   there: Let's Encrypt limits may be shared with everyone else using sslip.io (a certificate can fail to issue — retry
   later, don't burn attempts), and if web and API end up cross-site the browser uses `/api-proxy`, so set the same
   `INTERNAL_PROXY_SECRET` on both. HTTPS is not optional: the production cookie is `Secure`.
2. **Variables.** As production, with the staging hostnames, plus: Stripe **test** keys (`sk_test_`, `pk_test_`, the test
   webhook's secret), `ALLOW_TEST_WRITES=true`, and `SMTP_URL=smtp://mailpit:1025` with a temporary Mailpit resource
   (`axllent/mailpit`; give its UI a domain with `MP_UI_AUTH` set) so the signup and reset links can be followed.
3. **Run** the §5 set-up first (the browser suite needs the shop's own categories), then from your PC the same
   list as `scripts/rehearsal.mjs test`, with `E2E_API_BASE` / `E2E_WEB_BASE` /
   `E2E_MAILPIT_URL` pointing at staging: `seed-dev` (needs `DATABASE_URL` — open a temporary SSH tunnel to Postgres;
   never publish 5432), `e2e-test`, `e2e-variations`, `e2e-repair-pricing`, `e2e-shops`, `schema-audit`, the Playwright
   suite, then `go-live-check` with the staging URLs. Run each scheduled task once from Coolify. Try a Postgres backup and
   restore (§6) for real.
4. **Wipe.** Stop the API, drop and recreate the `fonology` database, redeploy with `MIGRATE_DATABASE_URL` (fresh schema —
   this also resets shop codes, see §5), delete the test photos (or recreate the Garage volumes and re-run
   `storage-setup`). Remove Mailpit, `SMTP_URL`, `ALLOW_TEST_WRITES` and the test Stripe keys.
5. **Cut over.** Switch every domain in Coolify to the real names, set the live variables (§7, §8), rebuild the web image
   (its build variables changed), then repoint DNS.

## 5. First data

The migrations already give the shop its address, phone, hours, delivery prices, reviews and repair-text wording. What
they don't give lives in **`deploy/shop-setup.json`**, a short file to read and correct before go-live:

- three shop settings: till float £50, auto-lock after 10 minutes, 45-day returns
- the categories (Accessories › Cases, beside the protected Mobiles, Number Plates and Vape)
- the repair types (Screen, Battery, Water damage, beside "Something else")
- the "Other / not listed" phone, which the repair and sell flows offer for a model that isn't on the list. It offers
  only the two free diagnoses, since a priced repair can't be quoted for an unnamed phone.
- the owner account

It is baked into the API image. In a terminal in the API container, after §4.1–4.3:

```bash
node dist/scripts/setup-shop.js --dry-run    # prints what it would do, writes nothing
node dist/scripts/setup-shop.js
```

✅ in the rehearsal. It refuses a database that already has staff, and runs as one transaction. It prints the owner's
**temporary password once**; hand it over directly. The owner signs in at `/staff-login`, sets a till PIN, and
changes the password through "Forgot password" once email works (§8). Every other member of staff is added by the
owner in Admin → Staff.

**`db:seed` / `seed-dev` refuse production** unless `ALLOW_TEST_WRITES=true`; do not run them on opening day.

⚠ **Then, in the admin panel, before opening:**

- **Products**, from the client's list (Inventory → Add product, or a one-off import script once the list arrives).
  An empty catalogue makes the storefront read "Nothing here yet", and `go-live-check` warns about it.
- **Devices and their repair prices** (Admin → Device Models). Without them the storefront's repair booking offers
  only "Other / not listed".

(`import-from-supabase.js` is still in the image, but its source, the old Supabase dev project, no longer answers. It
is not part of this runbook.)

⚠ **Create the real shops before any test run on production.** Shop codes (F01, F02 …) are handed out by the database in
creation order and never reused (0106), and several Playwright specs and `e2e-shops` create shops. Add the real Shop 2
first so it is F02; if test shops were made on production anyway, their codes are spent — check `select code, name from
shops order by code` before opening day.

## 6. Backups — and a tested restore

You have not got a backup until you have restored one.

- **Postgres** (the shop's money): Coolify → the Postgres resource → _Backups_ → daily schedule (and more often during trading
  hours if you like), **Save to S3**, retention ≥ 14 days, pointing at an **off-server** bucket (Backblaze B2, netcup object
  storage, or similar — _not_ the same VPS or the Garage on it). The bucket can be created now, before the VPS exists.
  Test: download the latest dump and restore it into a scratch database ✅ (the rehearsal does exactly this):
  ```bash
  docker exec <postgres container> createdb -U postgres restore_check
  docker exec -i <postgres container> pg_restore -U postgres -d restore_check < fonology.dump   # -i, NOT -it
  docker exec <postgres container> psql -U postgres -d restore_check -tAc 'select count(*) from orders'
  ```
  Do this before opening, then monthly.
- **Garage**: nightly sync of the Garage volumes (meta + data) to the same off-server bucket (restic or rclone from a cron
  on the host). With replication factor 1 a corrupted metadata store means lost photos; the 6-hourly metadata snapshot in
  `garage.toml` helps. Photos are re-uploadable, ID documents are purged on schedule, so this is the lowest-stakes of the three.
- **Coolify itself**: back up `/data/coolify` (config + certificates) and its `.env`.
- Write down, in one place the owner can find, how to restore each.

## 7. Stripe (live)

- Live keys (`sk_live_`, `pk_live_`) in production only; test keys everywhere else. The API refuses a live key outside
  `APP_ENV=production` and a test key inside it (without `ALLOW_TEST_WRITES`).
- Dashboard → Developers → Webhooks → add endpoint `https://api.fonology.co.uk/webhooks/stripe`, event `payment_intent.succeeded`
  (and `refund.updated`); copy **that endpoint's own signing secret** (live and test have different ones) into
  `STRIPE_WEBHOOK_SECRET`. Stripe requires HTTPS.
- **An order stays `pending` until that webhook arrives.** After going live, make one real small purchase and confirm the
  order turns `paid` and the stock drops, then refund it.
- Set the statement descriptor and the business details Stripe asks for before the first live charge.

## 8. Email

Transactional email goes through Brevo (`BREVO_*`) — set it up on the shop's own domain: add Brevo's SPF include, its DKIM
records, and a DMARC record (`_dmarc.fonology.co.uk`, start at `p=none` with a reporting address, tighten later), then send
a real order confirmation to a Gmail and an Outlook address and check it lands in the inbox, not spam. This needs only
DNS access, not the server. If Google sign-in is used, add `https://api.fonology.co.uk/auth/google/callback` to the OAuth
client's redirect URIs; without it the button is simply hidden.

**Repair-stage texts (0105).** The API starts in `SMS_MODE=log`: every text is recorded on the job but nothing is sent.
To send for real: buy SMS credits on the same Brevo account, set `SMS_MODE=brevo` (and `BREVO_SMS_SENDER`, default
`Fonology`, 11 letters/digits at most), redeploy, then create a test job with your own mobile and check the text arrives and
the job's Texts panel says "Sent". The wording is edited under Admin → Notifications.

## 9. Prove it — `scripts/go-live-check.mjs`

```bash
WEB_URL=https://fonology.co.uk API_URL=https://api.fonology.co.uk WWW_URL=https://www.fonology.co.uk \
STORAGE_URL=https://product-images.web.fonology.co.uk S3_URL=https://s3.fonology.co.uk node scripts/go-live-check.mjs
```

Read-only — it only makes requests any visitor could. Checks:

- the web, the API, and the API's database readiness
- certificates valid and more than 14 days from expiry
- HTTPS redirects (web and API), www → apex, HSTS and the other headers
- the web build variables were baked in (read back from the CSP header), and no `localhost` in the page
- CORS allows the storefront and refuses strangers, and the CSRF guard refuses a cookie write from a foreign origin
- every storefront, auth, admin and till page renders, and an unknown page is a 404
- shop facts are real, products exist, a product page renders from the API server-side
- a product photo loads from the photo host and through next/image
- the legal pages have their real text (about/faq/contact are the client's copy and only warn)
- the Stripe webhook is routed (unsigned → 400), and private buckets refuse anonymous access
- **last:** the login rate limit holds even when `X-Forwarded-For` is forged (proves `TRUST_PROXY_HOPS`). This leaves the
  machine running it rate-limited on staff sign-in for a few minutes.

Also run `nmap -Pn <ip>` (only 22/80/443) and an SSL Labs scan of the domain.

### 9a. Rehearse locally first — `pnpm rehearsal:up | rehearsal:test | rehearsal:down`

Before the server exists, and before any change to the Dockerfiles, `deploy/`, the entrypoint or a migration:
`scripts/rehearsal.mjs` runs this runbook on your machine against the real production images. It uses
`deploy/rehearsal/docker-compose.yml`: official Postgres 17, `deploy/docker-compose.garage.yml` unedited, Mailpit for
email, Caddy with its own CA standing in for Traefik, all on `https://*.fonology.localtest.me` (public DNS sends
`*.localtest.me` to 127.0.0.1).

- `up` builds both images, does the first deploy (migrations through the entrypoint), runs `storage-setup` on the blank
  Garage, redeploys without the superuser URL, then applies the §5 set-up (`setup-shop.js --dry-run`, then for
  real, inside the API container).
- `test` seeds test accounts, a demo catalogue and a product photo, and runs every API suite and `schema-audit`
  (`-- --playwright` for the browser suite). Then it runs every scheduled job, a backup → restore drill and a graceful
  stop, and finishes with `go-live-check`.
- `down` deletes all of it.

Needs Docker, Node 22+, Stripe **test** keys in your `.env.local` files (copied, never printed), and 80/443 free on
127.0.0.1. What it cannot prove is anything about the real network: Let's Encrypt, Traefik's own header handling, DNS,
the firewall. That is what §4.5 and §9 are for.

GitHub runs the same rehearsal on every push to `main` (`.github/workflows/rehearsal.yml`; the browser suite is an
option when started by hand). It needs three repository secrets, all Stripe **test** values: `STRIPE_TEST_SECRET_KEY`,
`STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_TEST_PUBLISHABLE_KEY`. `ci.yml` runs the quicker checks on every push. Once the
server exists, a deploy workflow will follow: build the images once, test those exact images, push them to GitHub's
registry, then deploy through Coolify's deploy hook after your approval.

## 10. Before opening day

- [ ] Real products entered (§5). Legal pages are written (2026-10-04); about/FAQ are still the client's to supply.
- [ ] Place a **real** order end to end (live Stripe), a repair booking, and a trade-in; refund the order.
- [ ] Till on the shop PC: install the print agent against `https://api.fonology.co.uk` (`apps/print-agent/README.md`);
      print a real receipt and label; scan a longer receipt barcode; confirm the printer-hardware items still marked
      unverified there.
- [ ] Each shop's staff signs in at their own till; Shop 2's agent token works.
- [ ] Backups run and a restore was tested (§6).
- [ ] An **external** uptime monitor (UptimeRobot or Better Stack, both have free plans) checks
      `https://api.fonology.co.uk/health/ready` and the home page every few minutes and alerts the owner's phone and
      email. Coolify can't warn you when the whole server is down; something outside it has to.
- [ ] Content-Security-Policy: it ships **report-only**. Open the storefront, a product page, checkout (with the Stripe
      card form), the admin and the till with the browser console open; once a week of normal use shows no
      `Content-Security-Policy` reports, switch `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in
      `apps/web/next.config.mjs`.
- [ ] Remove `ALLOW_TEST_WRITES`, disable the test accounts (`owner@fonology.test`, `staff@fonology.test`, `customer@…`), and
      change every default/dev credential. Confirm no `*.test` account can sign in on the live site.
- [ ] Re-run `go-live-check` after the final deploy; keep its output.

## Rollback

Redeploy the previous image in Coolify. Because migrations are additive-only, the previous API runs fine on the newer
schema. A bad _data_ change is a restore from §6, not a rollback.

## Sources

- Coolify hardening and backups: [massivegrid checklist](https://massivegrid.com/blog/coolify-security-hardening/),
  [azdigi](https://azdigi.com/en/blog/self-hosted/coolify-production-backup-security),
  [zenith-stack](https://zenith-stack.com/en/blog/coolify-in-production/)
- Docker bypasses ufw / DOCKER-USER: [virtua.cloud](https://www.virtua.cloud/learn/en/tutorials/docker-ufw-firewall-fix-vps),
  [learnwithhasan](https://learnwithhasan.com/guide/secure-coolify-vps/)
- Coolify pre/post-deployment behaviour: [issue #2057](https://github.com/coollabsio/coolify/issues/2057),
  [migration-on-deploy write-up](https://github.com/angelod1as/kids-screen-tracker/pull/24)
- Postgres backups to S3 in Coolify: [Vultr guide](https://docs.vultr.com/how-to-back-up-and-restore-postgresql-databases-to-s3-compatible-storage-in-coolify)
- Garage single node: [Garage docs](https://garagehq.deuxfleurs.fr/documentation/quick-start/),
  [known issues](https://garagehq.deuxfleurs.fr/documentation/reference-manual/known-issues/)
- Let's Encrypt limits and the Public Suffix List: [rate limits](https://letsencrypt.org/docs/rate-limits/)
- Stripe live go-live: [axonbuild checklist](https://axonbuild.com/blog/payment-go-live-checklist),
  [webhook reliability](https://webhookwatchtower.co.uk/blog/stripe-webhook-guide)
- Email authentication: [mailivery SPF/DKIM/DMARC](https://mailivery.io/blog/spf-dkim-dmarc-setup-guide-for-email-deliverability)
