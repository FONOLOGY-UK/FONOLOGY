# CLAUDE.md — running Fonology and keeping it up

Fonology (fonology.co.uk) is a UK phone-repair and accessories shop in Thornliebank, Glasgow. This is the
**only** document in the repo: how the site is run, what to check, what to do when something breaks, and the
rules in the code that must not be broken. If this file and the repo disagree, the repo is right — fix this
file in the same change.

**This repository is public.** Never commit secrets, IP addresses, personal data or customer data. Server
addresses, passwords and keys live in the owner's password manager and in Coolify, never here.

## 1. What runs where

| Piece              | What / where                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `apps/web`         | Next.js 15 storefront + admin dashboard + till (`/pos`). Docker image, port 3000.                  |
| `apps/api`         | Express + TypeScript. Only holder of DB and storage credentials. Docker image, port 4000.          |
| `apps/print-agent` | Runs on the shop's till PC (not on the server). Drives the label and receipt printers.             |
| `db/migrations`    | Numbered, additive SQL. Applied by the API image's entrypoint when `MIGRATE_DATABASE_URL` is set.  |
| Server             | netcup VPS (Ubuntu 24.04), managed by **Coolify** (Traefik proxy, Let's Encrypt).                  |
| Coolify resources  | `postgres` (Postgres 17, **Debian image**), `fonology-api`, `fonology-web`, `garage` (S3 storage). |
| Staging only       | `mailpit` (mail catcher) — remove before launch.                                                   |
| Off-server backups | Backblaze B2 bucket `fonology-backups` (database dumps + Garage mirror).                           |
| Alerts             | Discord channel `#fonology-alerts`.                                                                |
| Third parties      | Stripe (online card payments), Brevo (email + SMS), Google (sign-in), GitHub (code, CI, uptime).   |

Public hostnames at launch: `fonology.co.uk` (web), `api.fonology.co.uk`, `product-images.web.fonology.co.uk`
(public photos), `s3.fonology.co.uk` (signed links to private files). Web and API **must** share one registrable
domain: the session cookie is `SameSite=Lax` only when they are same-site.

Postgres, Garage's admin port and Coolify's dashboard are **never** published to the internet.

## 2. Getting in (operator)

- **SSH:** key-only, user `deploy` (passwordless sudo). Root login is key-only and exists for Coolify. Keep the
  private key private; losing it means rebuilding access through the netcup panel.
- **Coolify dashboard** is not public. Open an SSH tunnel and browse to it:
  `ssh -N -L 8000:localhost:8000 deploy@<server>` then `http://localhost:8000`.
- **Coolify API** (through the same tunnel): `http://localhost:8000/api/v1`, bearer token kept in a gitignored
  file on the operator PC. Deploys are **POST** `/deploy?uuid=<app>&force=true` (GET is refused).
- **netcup panels** (customer panel and server panel) hold billing, snapshots and the firewall. Turn on 2FA.
- Secrets that must exist off the server: Coolify's `/data/coolify/source/.env`, the database passwords, the
  Stripe and Brevo keys, the Backblaze key. If the server dies without them, recovery is much harder.

## 3. Alerts and what to do

Everything posts to Discord. A day with **no** message from the nightly backup means the job did not run.

| Message                                                                    | From                | Meaning / first move                                                                                               |
| -------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ALERT … Website health / API readiness`                                   | server watchdog     | Site or API not answering from the server itself. See "Site is down".                                              |
| `SITE DOWN (seen from outside)`                                            | GitHub uptime check | Reachable check from the internet failed. If the watchdog is silent the whole server is down.                      |
| `ALERT … Disk is N percent full`                                           | server watchdog     | Over 80%. `docker builder prune -af --filter until=72h` (old build cache), then check logs and `docker system df`. |
| `ALERT … memory`, `Containers not running`                                 | server watchdog     | A container died or memory is under 400 MB. `docker ps -a`, `docker logs`, restart in Coolify.                     |
| `ALERT … Certificate … expires in N days`                                  | server watchdog     | Traefik renews at 30 days left. If it did not: DNS wrong, port 80 blocked, or Let's Encrypt limits.                |
| `ALERT … Postgres has N connections`                                       | server watchdog     | Over 80 of 100. Look for a stuck API pool; restart the API.                                                        |
| `Last Garage backup finished N hours ago`                                  | server watchdog     | Nightly photo/ID-document backup did not run. See "Backups".                                                       |
| `BACKUP PROBLEM … Garage to Backblaze`                                     | backup script       | A bucket failed, or Garage looked empty so the script refused to mirror emptiness.                                 |
| `SIMULATED FAILURE`                                                        | backup script       | A test of the alert path (`garage-backup.sh --simulate-failure`). Nothing is wrong.                                |
| Coolify messages (deploy / backup / task failed, disk, server unreachable) | Coolify             | Open Coolify, read the deployment or backup log.                                                                   |
| `RECOVERED …`                                                              | server watchdog     | The problem cleared by itself.                                                                                     |

How it is built (all on the server, run by systemd, root-only secrets in `/etc/fonology/`):

- `fonology-watchdog.timer` → `/usr/local/sbin/fonology-watchdog.sh` every 5 minutes. Settings in
  `/etc/fonology/watchdog.conf` (`WEB_URL`, `API_URL`, `CERT_HOSTS`) — **edit them at the domain cutover**.
  Self-test: `WATCHDOG_FORCE_DISK_PCT=99 /usr/local/sbin/fonology-watchdog.sh`, then run it again to see RECOVERED.
- `garage-backup.timer` → `/usr/local/sbin/garage-backup.sh` daily ~03:45 (server time, Europe/London).
- `.github/workflows/uptime.yml` calls the live site every 10 minutes from GitHub. Repo variables
  `UPTIME_WEB_URL` and `UPTIME_API_URL` and secret `DISCORD_WEBHOOK_URL` — **update the two variables at cutover**.
  Scheduled workflows only run from `main`.
- Coolify sends its own Discord alerts (Notifications → Discord). Coolify's nightly self-update is **off**; update
  it by hand after reading its release notes, never on a trading day.

## 4. Routine maintenance

**Daily (30 seconds):** the "Garage backup OK" message arrived; no red alerts.

**Weekly:**

- Coolify → each resource healthy; `apt list --upgradable` on the server (security updates install themselves;
  `/var/run/reboot-required` means schedule a reboot out of hours — the watchdog tells you).
- Skim `docker logs --since 7d` for the API and web for repeated errors.
- Disk: `df -h /` and `docker system df`. Prune old build cache if over 60%.
- Admin → Logs and Reports look sane (no negative drawer, no stuck print jobs).

**Monthly:**

- **Restore drill** (section 6). A backup you have not restored is a hope, not a backup.
- Review who has access: Coolify users and API tokens, GitHub collaborators, Stripe and Brevo team members,
  admin staff accounts. Delete anything unused.
- Check certificate dates for every hostname and that fail2ban is running.
- Update Node/OS images only after reading advisories; run `pnpm audit --prod`.

**Before every deploy:** is a migration involved (section 5)? Is it a trading hour? Is a backup less than a day
old? After: `scripts/go-live-check.mjs` against the live URLs (`WEB_URL`, `API_URL`, `STORAGE_URL`, `S3_URL`).
It also trips the staff-login rate limit for the machine running it on purpose — run it last.

## 5. Deploying and rolling back

Coolify builds each Dockerfile (repo root as build context) from the `main` branch via a read-only deploy key.
Auto-deploy is **off**: deploy by hand.

1. Merge to `main` (CI must be green: typecheck, lint, both images build).
2. Deploy `fonology-api` first, then `fonology-web` (Coolify, or the API call above).
3. Check `/health/ready` on the API, `/api/health` on web, then click the shop pages.

**Migrations:** they must land **before** the API that calls them runs. Do not use Coolify's pre/post-deploy
commands. Instead set `MIGRATE_DATABASE_URL` (superuser URL ending in `/fonology`) and `FONOLOGY_API_DB_PASSWORD`
on the API for that one deploy; the entrypoint migrates, and a failed migration stops the new container so the
old one keeps serving. Then **delete both variables and redeploy** so the running API holds no superuser
credentials. Migrations are additive-only, so the previous API runs fine on the newer schema.

**Rollback:** set the application's git commit to the last good sha (Coolify → application → commit, or
`PATCH /applications/<uuid>` with `git_commit_sha`) and deploy. A bad **data** change is a restore, not a rollback.

**Web build variables** are baked in at build time and must be marked "Build Variable" in Coolify:
`NEXT_PUBLIC_API_BASE_URL`, `STORAGE_PUBLIC_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Changing one needs a
**rebuild**, not a restart. The `noindex` header is on for any build whose API host is not on `fonology.co.uk`.

**Coolify quirks that cost time:** the web health probe needs host `127.0.0.1`; Garage's compose app needs
"preserve repository" and "connect to predefined network" on; app memory limits are set in Coolify (compose apps
take them from the compose file); a Docker-image app needs a custom network alias to be reachable by a stable name.

## 6. Backups and restore

| What                                                | How                                                                              | Where / how long                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Postgres `fonology`                                 | Coolify scheduled backup, daily 02:00 UTC                                        | Backblaze, 30 kept; 3 on the server                                                      |
| Garage buckets (photos, ID documents, buy-in forms) | `garage-backup.sh` nightly, `rclone sync`                                        | Backblaze `garage/<bucket>`; deletions mirrored, deleted files kept 30 days then removed |
| Coolify's own configuration                         | **Not backed up** — keep `/data/coolify/source/.env` and a note of the resources | password manager                                                                         |

The B2 bucket has encryption on and a 30-day clean-up rule for `garage/`. Purged ID documents must not live in
backups forever — that is why deletions are mirrored.

**Restore the database** (practise on a scratch database first):

```bash
# 1. fetch the newest dump from Backblaze (Coolify → postgres → Backups → download, or the B2 console)
# 2. restore into a scratch database and compare
docker cp dump.dmp <postgres-container>:/tmp/dump.dmp
docker exec <postgres-container> psql -U postgres -c "create database scratch"
docker exec <postgres-container> pg_restore -U postgres -d scratch --no-owner /tmp/dump.dmp
# compare counts of sales, sale_payments, orders, jobs, products against fonology, then drop scratch
# 3. real disaster: stop the API, drop and recreate fonology, pg_restore into it, run the migrations
#    (MIGRATE_DATABASE_URL deploy) so roles exist, start the API
```

**Restore photos/documents:** run rclone in a container on the Docker network with the credentials file:
`docker run --rm --network coolify --env-file /etc/fonology/rclone.env rclone/rclone:1.68 copy b2:fonology-backups/garage/product-images garage:product-images`
(repeat for `id-documents`, `buy-in-forms`).

**Whole server lost:** order a new VPS, harden it (section 8), install Coolify, restore `/data/coolify/source/.env`,
recreate the four resources, apply env vars (section 7), migrate, restore the database and Garage, repoint DNS.

## 7. Configuration reference

Never print or commit values. Generate secrets with `openssl rand -hex 32` (`-hex 16` for passwords).

**API (runtime):**

| Variable                                                                                                                                          | Notes                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV=production`, `DATABASE_URL`                                                                                                              | `postgres://fonology_api:<pw>@<postgres-host>:5432/fonology`                                                                                    |
| `CORS_ORIGINS`, `WEB_APP_URL`, `API_PUBLIC_URL`                                                                                                   | `https://fonology.co.uk`, `https://api.fonology.co.uk`                                                                                          |
| `TRUST_PROXY_HOPS`                                                                                                                                | `1` behind Traefik alone, `2` if Cloudflare is also in front. Wrong value = forgeable rate limits.                                              |
| `S3_ENDPOINT=http://garage:3900`, `S3_ACCESS_KEY_ID` (`GK` + 24 hex), `S3_SECRET_ACCESS_KEY` (64 hex), `S3_PUBLIC_ENDPOINT`, `STORAGE_PUBLIC_URL` | You generate the key; `storage-setup` imports it into Garage.                                                                                   |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                                                                      | Live keys only in Coolify. A test key in production refuses to boot unless `ALLOW_TEST_WRITES=true`; a live key outside production never boots. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `SMS_MODE`                                                                                                 | `log` = texts recorded, not sent; `brevo` = real texts (needs credits). Do not set `SMTP_URL` in production.                                    |
| `GOOGLE_CLIENT_ID` / `_SECRET`                                                                                                                    | Optional. Redirect URI `https://api.<domain>/auth/google/callback`.                                                                             |
| `INTERNAL_PROXY_SECRET`                                                                                                                           | Only when web and API are cross-site (staging on sslip.io). Same value on both.                                                                 |
| `ALLOW_TEST_WRITES`                                                                                                                               | **Pre-launch only. Remove on opening day** (and disable the test accounts).                                                                     |
| `MIGRATE_DATABASE_URL`, `FONOLOGY_API_DB_PASSWORD`                                                                                                | One deploy only, then delete (section 5).                                                                                                       |

An empty variable counts as unset. Garage needs `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, `GARAGE_METRICS_TOKEN`.

**One-off commands** (in the API container): `node dist/scripts/storage-setup.js` (needs `GARAGE_ADMIN_URL=http://garage:3903`
and `GARAGE_ADMIN_TOKEN` for that run; creates the buckets and imports the key), `node dist/scripts/setup-shop.js`
(`--dry-run` first; applies `deploy/shop-setup.json` once to an empty database and prints the owner's one-time
password once). **Scheduled tasks** on the API (Coolify): `purge-documents` 03:00, `purge-print-jobs` 03:10,
`purge-sms-log` 03:20, `purge-housekeeping` 03:30 (`node dist/scripts/<name>.js`).

## 8. Security posture

- **Firewall has two layers and two address families.** `ufw` allows 22/80/443. Docker bypasses `ufw`, so
  `/usr/local/sbin/docker-user-fw.sh` (systemd `docker-user-fw`) puts the rule in the `DOCKER-USER` chain for
  **both `iptables` and `ip6tables`**: only 80/443 reach containers from the public interface. Never publish a
  port you do not mean to. After any firewall change, probe the IPv4 **and** IPv6 address from outside — an
  IPv6 gap once exposed the Coolify login.
- **SSH:** keys only, `MaxAuthTries 3`, no X11. fail2ban on. Keep a second SSH session open while changing SSH.
- **Coolify:** registration off, dashboard private, **2FA on the admin**, auto-update off, delete unused API tokens.
- **Postgres:** scram-sha-256, `fonology_api` has no DDL, row-level security forced on all tables, the API role
  has statement/lock/idle-in-transaction timeouts. Postgres image must be `postgres:17` (Debian), **not alpine**
  — alpine sorts text by raw bytes and every `ORDER BY name` changes.
- **Files:** only `product-images` is public; `id-documents` and `buy-in-forms` are reached through 60-second signed links.
- **Auth:** the API's own sessions (argon2id, httpOnly `fnl_session` cookie, 30-day sliding), PIN lock at the till
  with an idle auto-lock; a locked session cannot write — including from the storefront in the same browser.
- **Rotate before production:** the Backblaze key must become a key limited to the one bucket; rotate the Coolify
  API token; remove staging webhooks and test keys. Treat any secret that appeared in chat or a screenshot as leaked.
- **The repo is public** and `deploy/shop-setup.json` holds owner details: decide on private, and turn on branch protection.

## 9. When something breaks

**Site is down.** (1) Is it the whole server? `ssh` in; if not, check netcup status and the panel. (2) `docker ps -a`
— anything exited? Restart it in Coolify. (3) `docker logs --tail 100 <container>`. (4) Disk full? `df -h /`.
(5) Traefik: `docker logs coolify-proxy`. (6) Recent deploy? Roll back (section 5). The till works for cash sales
only while the API is up — tell the shop to note sales on paper and enter them after.

**API unhealthy / 502.** `/health/ready` reaches the database; if it fails, check the Postgres container and
connections, then restart the API. A boot loop with `[config] Missing or invalid environment variable(s)` means a
bad Coolify variable.

**Card payments fail.** Check Stripe's webhook endpoint in the dashboard, that `STRIPE_WEBHOOK_SECRET` matches that
endpoint, that the API log shows `[webhook] … marked paid`, and the web build used the right publishable key.
Orders are created first and priced by the server; a paid order that is not marked paid means the webhook did not arrive.

**Emails or texts not arriving.** API log lines `[email] …`. Brevo needs a verified sender domain (SPF/DKIM); do not
touch the MX record — the business mailbox lives there.

**Server compromised / secret leaked.** Rotate in this order: Stripe keys and webhook secret, database passwords
(update `DATABASE_URL`, restart), S3 and Garage secrets, Backblaze key, Coolify token, SSH key, GitHub secrets;
revoke all `auth_sessions` (`update auth_sessions set revoked_at = now()`); review `docker ps` for unknown containers
and `/root/.ssh/authorized_keys`. If unsure, rebuild the server from backups.

## 10. Going live (still to do)

**Done 2026-10-11:** the domain cutover. `fonology.co.uk` (www redirects to it), `api.`, `s3.` and `product-images.web.` are
A records to the VPS (TTL 300); the old `mail` CNAME became an A record to the hosting IP so mail clients keep working;
MX, SPF, DKIM and the `_caldav`/`_carddav` records were left alone. The zone is edited in the TMDHosting cPanel Zone Editor
(nameservers `ns1/ns2.uk22.tmd.cloud`). Coolify domains, API/web variables, the web rebuild, `watchdog.conf`, the uptime
variables and the Stripe (test) webhook all use the real hostnames. Garage domains need explicit ports in Coolify
(`product-images.web...:3902`, `s3...:3900`) or Traefik logs "port is missing". `scripts/go-live-check.mjs`: 55 pass.
**Still on test mode:** Stripe test keys, `ALLOW_TEST_WRITES`, Mailpit, staging data, and the site is indexable.

Still to do:

1. **Brevo DNS:** add Brevo's TXT (`brevo-code:`), two DKIM CNAMEs and `_dmarc` (`p=none` first) to the zone; add its SPF include only if
   it insists, and stay within the 10-lookup limit.
2. **Wipe staging:** stop the API, drop and recreate `fonology`, redeploy with `MIGRATE_DATABASE_URL` (fresh schema),
   delete test photos or recreate the Garage volumes and re-run `storage-setup`, run `setup-shop`.
3. **Remove staging bits:** Mailpit, `SMTP_URL`, `ALLOW_TEST_WRITES`, the test Stripe keys and the staging Stripe webhook.
4. **Live settings:** live Stripe keys + live webhook (`/webhooks/stripe`, events `payment_intent.succeeded`,
   `refund.updated`), Brevo key and sender, `SMS_MODE=brevo` when credits are bought, real hostnames in all variables,
   **rebuild web** (build variables changed).
5. **Update (done for the domain):** after any hostname change redo `/etc/fonology/watchdog.conf`, `UPTIME_*` variables and the Stripe webhook URL.
6. **Prove it:** `scripts/go-live-check.mjs`, a real test order, a test refund, a day close, a restore drill, and the
   printer checks on the till PC (section 12).
7. **Opening day:** remove `ALLOW_TEST_WRITES`, disable the test accounts (`*@fonology.test`), confirm the Content
   Security Policy has run clean for a week and switch it from report-only to enforcing in `next.config.mjs`.

`scripts/rehearsal.mjs` (`pnpm rehearsal:up | rehearsal:test | rehearsal:down`) runs the real production images with
official Postgres, Garage and a TLS proxy locally. Use it after touching a Dockerfile, `deploy/`, the entrypoint,
a migration or a server-side job. It needs ports 80/443 free and Stripe **test** keys (`REHEARSAL_STRIPE_*`).

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

## 12. Print agent and the shop hardware

The agent runs on the till PC as a **Windows Scheduled Task at logon** (not a service: a LocalSystem service runs in
an isolated session and cannot see printers; the logon trigger repeats every 10 minutes as a watchdog). It long-polls
`GET /print/jobs/next` and never accepts inbound connections. Install: `apps/print-agent/install/install.cmd`
(needs Node 20+; asks for the API URL and a token created in Settings → Print agents, shown once).

Delivery is **at-most-once**: an on-disk marker is written before the first byte and cleared after the ack. Marker
absent → safe to requeue; marker present → a receipt becomes `unconfirmed` and is never auto-reprinted (a duplicate
receipt looks like return fraud; a duplicate label only wastes an inch of roll). Printer settings live in
`shops.printer_config`; only the API URL and token are local (`agent.json`). Cards: two machines (Shift4, Dojo) keyed
by hand — the till has "Send to machine" / "Card approved" / "Declined"; reconcile day-close card totals against each
machine's settlement report. There is no cash drawer.

**Unverified until someone tests with the real printers** (Brother QL-600 label, eposnow POS80GXa receipt, 80mm):
the `£` codepage (cp437 `0x9C`), cutter behaviour, column count (42 assumed), feed-before-cut, label origin and roll
size (62mm continuous assumed), long barcode width (Code 39 at 17 characters), and non-Latin names (print as `?`).
Use the admin **Printers** page test prints and photograph them. Use the 80mm THM80 roll in the receipt printer — the
57mm card-machine roll fits but prints squashed.

## 13. Legal assumptions the owner must confirm

Returns, shipping, terms and privacy pages read the address, phone, email, returns window, ID-document retention and
next-day cut-off from `shop_settings`; everything else is drafted wording: faulty goods 30 days, change-of-mind at
least 14 days online, vapes and unlocked phones excluded, Scots law, records kept six years, no analytics cookies.
Still needed: the legal entity name/number, **ICO registration number**, a named data-request contact, `/about` and
`/faq` copy, proof that the homepage reviews are real Google reviews, and a solicitor's read before opening. Stripe.js
currently loads on every page, so the cookie policy's "only when you pay" is inaccurate until it loads on checkout only.

## 14. Known open items (as of the last audit)

- No scheduled backup of Coolify's own configuration; Garage compose file has no `mem_limit`.
- Staff-signed-in browsers cannot submit customer forms (repair booking, trade-in, checkout are refused with "sign out or use a private window"), and a locked session blocks all writes. Test customer flows through the public API or a private window; staging's idle lock was raised to 240 minutes for testing (the setup file says 10 — a wipe and re-seed restores it).
- Found in the 2026-10-11 admin walk-through, still open: customers get **no email when an order ships** (courier and tracking only show on `/track`); the repair-parts picker offers a variation product's parent, which fails with a raw "Not enough stock for product <uuid>" error (pick a variation); till sale lines do not show the variation label; the day-close "takings by tender" line omits online card payments; Stripe.js loads on every page.
- Fixed 2026-10-11: a paid click-and-collect order had no way to be handed over (only Cancel showed); cancelling a paid online order now refuses until it is refunded (it used to restock and keep the customer's money), and the Online orders screen shows the refusal. A job can be marked Done with a balance owing, but Collected asks for it first. Goods in is a record only (0108) and moves no stock — by design.
- Fixed 2026-10-11: setup-shop never applied the till float to the per-shop table (screen said £150, file said £50); migration 0112 lets a request booked at an older price become a job after a price rise. Staging still shows the old £150 float because setup only runs on an empty database.
- Accessibility (red-on-white contrast, missing skip link and `<h1>` on `/shop`), mobile performance, hardcoded
  marketing figures on the home page, Stripe events other than `payment_intent.succeeded` / `refund.updated` ignored.
- The firewall service starts after Docker, so containers are briefly reachable at boot before the rules load.
- Next.js 15 leaves maintenance support around 21 October 2026 — plan the upgrade.
- Coolify's `.env`, a second copy of every secret, and 2FA on every admin account are the owner's job.

## 15. Local development

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
