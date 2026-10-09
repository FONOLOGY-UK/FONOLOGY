# Going live — netcup VPS + Coolify

Written 2026-10-04 from a code audit plus current Coolify/Garage/Stripe practice. **Nothing here has been run on the real
server yet** — the VPS does not exist. What _was_ proven locally is marked ✅. Everything else is a plan to follow and
tick off, and §9 (`scripts/go-live-check.mjs`) is how you prove it afterwards.

## 0. Where the code stands

✅ **Proven before this document**: both production images build from a clean checkout; the API image starts, applies
all 95 migrations to an empty database, and refuses to boot with a localhost CORS/WEB_APP_URL under `NODE_ENV=production`;
typecheck, lint, 38 web unit tests, pgTAP (619), `e2e-test` 80/80, `e2e-shops` 165, `schema-audit` 0 hard failures, and
a 51-test real-browser suite (`packages/e2e`) all pass.

**Changed for go-live (this branch):**

| change                                                       | why                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY_HOPS` (default **1**) replaces a hard-coded `2` | The `2` was measured on Render + Cloudflare. Behind Coolify's Traefik alone it lets a visitor forge `X-Forwarded-For` and choose the address the login rate-limiter sees — brute-force protection defeated. `go-live-check` tests this. Use **2 only if Cloudflare is in front**. |
| `apps/api/docker-entrypoint.sh`                              | Applies migrations _before_ the server starts when `MIGRATE_DATABASE_URL` is set. See §4 — Coolify's pre/post-deployment hooks cannot do this safely.                                                                                                                             |
| `GET /health/ready`                                          | Checks the database. `/health` stays shallow (it is the container's liveness probe; a DB blip must not restart a healthy API). Point the uptime monitor at `/health/ready`.                                                                                                       |
| SIGTERM handling                                             | A deploy used to cut in-flight requests (a sale, a payment webhook). The API now finishes them, closes the DB pool, and exits.                                                                                                                                                    |
| Security headers                                             | Web: HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`. API: `nosniff`, `no-referrer`, no `X-Powered-By`. **No CSP yet** — see §10.                                                                                                                     |
| `deploy/`                                                    | Production Garage config + compose file. The only Garage config in the repo was dev-only with dev secrets.                                                                                                                                                                        |

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
`SameSite=Lax` only when they are same-site (`lib/cookies.ts`). Browsers call the API directly — there is no web→API proxy
in production.

DNS: `A` records for `@`, `www`, `api`, `s3`, `product-images.web` → the VPS IP. `www` → redirect to the apex (Coolify domain
setting). Nothing needs a wildcard.

## 2. The VPS (netcup)

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
3. Connect the GitHub repo (deploy key). Pushing `main` must **not** auto-deploy to production blindly: turn auto-deploy off
   and deploy by hand until you trust it.

## 4. Resources, in this order

### 4.1 PostgreSQL 17

Coolify one-click Postgres (official image — it already includes `citext`, `fuzzystrmatch`, `pg_trgm`, which the migrations
need). Not publicly exposed. Create database `fonology`. You will need two URLs:

- `MIGRATE_DATABASE_URL` — the `postgres` superuser (migrations create roles cluster-wide).
- `DATABASE_URL` — the `fonology_api` role the migration creates (`postgres://fonology_api:<FONOLOGY_API_DB_PASSWORD>@<host>:5432/fonology`).

### 4.2 Garage

Add `deploy/docker-compose.garage.yml` as a Docker Compose resource; set the three tokens (`openssl rand -hex 32` each);
domains: `product-images.web.fonology.co.uk` → port 3902 (public photos) and `s3.fonology.co.uk` → port 3900 (see the `S3_PUBLIC_ENDPOINT` row below for why). Never publish 3903 (admin). Garage's own docs say a single node has **no redundancy**
and is not recommended for production — it is acceptable here because it only holds product photos and short-lived ID
documents, and §6 backs it up. Then once (a one-off terminal in the API container, or a Scheduled Task):
`node dist/scripts/storage-setup.js` (needs `GARAGE_ADMIN_URL=http://garage:3903` and `GARAGE_ADMIN_TOKEN`) — it creates
`product-images` (public) and `id-documents`, `buy-in-forms` (private). **Do this before the first upload.**

### 4.3 API (Dockerfile `apps/api/Dockerfile`, build context = repo root, port 4000, domain `api.…`)

Health check path `/health`. Variables (runtime):

| variable                                                 | value / note                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                               | `production` (the image sets it)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `APP_ENV`                                                | `production` — required; the API refuses to start without it                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DATABASE_URL`                                           | the `fonology_api` URL above                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `S3_ENDPOINT` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY`  | `http://garage:3900` + the key `storage-setup` printed                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `S3_PUBLIC_ENDPOINT`                                     | `https://s3.fonology.co.uk` — **required in production.** Signed links to the private buckets (ID documents, buy-in forms) are built from this address (`lib/storage.ts`); left unset they would point at `garage:3900`, which staff browsers cannot reach. Exposing the S3 port is safe: every request needs a valid signature (the API makes them last 60 s) and the buckets are not anonymously listable — still, confirm it with `curl https://s3.fonology.co.uk/id-documents/` → 403. |
| `STORAGE_PUBLIC_URL`                                     | `https://product-images.web.fonology.co.uk`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CORS_ORIGINS`                                           | `https://fonology.co.uk` (add `https://www.…` only if www serves content rather than redirecting)                                                                                                                                                                                                                                                                                                                                                                                          |
| `WEB_APP_URL`                                            | `https://fonology.co.uk`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `API_PUBLIC_URL`                                         | `https://api.fonology.co.uk`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `TRUST_PROXY_HOPS`                                       | `1` (2 if Cloudflare proxies the site)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `STRIPE_SECRET_KEY`                                      | `sk_live_…` (see §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `STRIPE_WEBHOOK_SECRET`                                  | from the **live** webhook endpoint (§7)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `BREVO_API_KEY` `BREVO_SENDER_EMAIL` `BREVO_SENDER_NAME` | transactional email (§8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET`                | optional                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ALLOW_TEST_WRITES`                                      | **not set.** (Set `true` only for pre-launch testing on the live server, then remove it.)                                                                                                                                                                                                                                                                                                                                                                                                  |

**Migrations.** Do **not** use Coolify's pre-/post-deployment commands: _pre_ runs in the **old** container (so on the very
first deploy it is skipped, and later it only knows the old migration files) and _post_ runs after the new container is
already serving. Instead, for any deploy that carries a migration: add `MIGRATE_DATABASE_URL` and
`FONOLOGY_API_DB_PASSWORD` to the API's variables, deploy, confirm healthy, then **remove both** so the running API doesn't
hold superuser credentials. The entrypoint applies pending migrations first; if one fails the new container never becomes
healthy and Coolify keeps serving the old API. ✅ tested: empty DB → 95 applied → server start. Migrations are additive
only, so the old API is safe against the migrated database during the swap.

**Scheduled tasks** (Coolify → API → Scheduled Tasks, run inside the API container):
`node dist/scripts/purge-documents.js` daily 03:00 · `node dist/scripts/purge-print-jobs.js` daily 03:10 ·
`node dist/scripts/purge-sms-log.js` daily 03:20 (blanks repair-text phone numbers and bodies after 180 days) ·
`node dist/scripts/purge-housekeeping.js` daily 03:30 (deletes sale retry keys, expired sessions and emailed tokens older than 7 days).

### 4.4 Web (Dockerfile `apps/web/Dockerfile`, port 3000, domain `fonology.co.uk`)

Health check `/api/health`. These four are **build** variables — Next inlines them at build time (in Coolify mark each
_Build Variable_; a runtime-only value bakes in as `undefined`):
`NEXT_PUBLIC_API_BASE_URL=https://api.fonology.co.uk` · `NEXT_PUBLIC_SITE_URL=https://fonology.co.uk` ·
`STORAGE_PUBLIC_URL=https://product-images.web.fonology.co.uk` · `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`.
`NEXT_PUBLIC_API_BASE_URL` must say the real hostname, never `127.0.0.1`. After any dependency change, build the web image in
Docker before shipping (pnpm 9 and 11 hoist differently — see memory note).

The API logs a warning `INTERNAL_PROXY_SECRET is not set` — it only concerns the old Render `/api-proxy`; safe to ignore in
this topology.

## 5. First data

On the empty production database, after §4.1–4.3: either import the shop's real set-up once
(`node dist/scripts/import-from-supabase.js`, needs `DEV_SUPABASE_DB_URL` — brings staff + passwords, settings, delivery,
repairs, reviews; **no products, no trading history**) or create the owner by hand. **`db:seed` / `seed-dev` refuse
production** unless `ALLOW_TEST_WRITES=true` — do not run them on opening day.

⚠ **The product catalogue is empty.** The importer does not bring products and the local database has only test items. The
shop needs its real products entered (Inventory → Add product, or a one-off import) before opening, or the storefront reads
"Nothing here yet". `go-live-check` warns about this.

⚠ **Create the real shops before any test run on production.** Shop codes (F01, F02 …) are handed out by the database in
creation order and never reused (0106), and several Playwright specs and `e2e-shops` create shops. Add the real Shop 2
first so it is F02; if test shops were made on production anyway, their codes are spent — check `select code, name from
shops order by code` before opening day.

## 6. Backups — and a tested restore

You have not got a backup until you have restored one.

- **Postgres** (the shop's money): Coolify → the Postgres resource → _Backups_ → daily schedule (and more often during trading
  hours if you like), **Save to S3**, retention ≥ 14 days, pointing at an **off-server** bucket (Backblaze B2, netcup object
  storage, or similar — _not_ the same VPS or the Garage on it). Test: restore the latest dump into a scratch database
  and `select count(*) from orders;`. Do this before opening, then monthly.
- **Garage**: nightly sync of `/var/lib/garage` (meta + data) to the same off-server bucket (restic or rclone from a cron on
  the host, or a Coolify scheduled task). With replication factor 1 a corrupted metadata store means lost photos; the 6-hourly
  metadata snapshot in `garage.toml` helps. Photos are re-uploadable, ID documents are purged on schedule, so this is the
  lowest-stakes of the three.
- **Coolify itself**: back up `/data/coolify` (config + certificates) and its `.env`.
- Write down, in one place the owner can find, how to restore each.

## 7. Stripe (live)

- Live keys (`sk_live_`, `pk_live_`) in production only; test keys everywhere else. The API already refuses a live key
  outside `APP_ENV=production` and a test key inside it (without `ALLOW_TEST_WRITES`).
- Dashboard → Developers → Webhooks → add endpoint `https://api.fonology.co.uk/webhooks/stripe`, event `payment_intent.succeeded`
  (and `refund.updated`); copy **that endpoint's own signing secret** (live and test have different ones) into
  `STRIPE_WEBHOOK_SECRET`. Stripe requires HTTPS.
- **An order stays `pending` until that webhook arrives** — locally nothing delivers it (the e2e suite signs one itself).
  After going live, make one real small purchase and confirm the order turns `paid` and the stock drops, then refund it.
- Set the statement descriptor and the business details Stripe asks for before the first live charge.

## 8. Email

Transactional email goes through Brevo (`BREVO_*`) — set it up on the shop's own domain: add Brevo's SPF include, its DKIM
records, and a DMARC record (`_dmarc.fonology.co.uk`, start at `p=none` with a reporting address, tighten later), then send
a real order confirmation to a Gmail and an Outlook address and check it lands in the inbox, not spam. If Google sign-in is
used, add `https://api.fonology.co.uk/auth/google/callback` to the OAuth client's redirect URIs.

**Repair-stage texts (0105).** The API starts in `SMS_MODE=log`: every text is recorded on the job but nothing is sent.
To send for real: buy SMS credits on the same Brevo account, set `SMS_MODE=brevo` (and `BREVO_SMS_SENDER`, default
`Fonology`, 11 letters/digits at most), redeploy, then create a test job with your own mobile and check the text arrives and
the job's Texts panel says "Sent". The wording is edited under Admin → Notifications.

## 9. Prove it — `scripts/go-live-check.mjs`

```bash
WEB_URL=https://fonology.co.uk API_URL=https://api.fonology.co.uk WWW_URL=https://www.fonology.co.uk \
STORAGE_URL=https://product-images.web.fonology.co.uk S3_URL=https://s3.fonology.co.uk node scripts/go-live-check.mjs
```

Read-only. Checks: both services + DB readiness; HTTPS redirect, HSTS and friends; CORS allows the storefront and refuses
strangers; shop facts present and not placeholders; products exist; legal pages not placeholders; Stripe webhook routed
(unsigned → 400); **login rate limit holds even when `X-Forwarded-For` is forged** (proves `TRUST_PROXY_HOPS`); photo host
answers. ✅ the rate-limit check was verified both ways locally (it fails with a trusted hop and no proxy, passes with 0).
Also run `nmap -Pn <ip>` (only 22/80/443) and an SSL Labs scan of the domain.

## 10. Before opening day

- [ ] Real products entered (§5). Legal/info pages written (Terms, Privacy, Returns, Cookies, Shipping render "content to be
      finalised" today — a customer-facing and legal gap, not a technical one).
- [ ] Place a **real** order end to end (live Stripe), a repair booking, and a trade-in; refund the order.
- [ ] Till on the shop PC: install the print agent against `https://api.fonology.co.uk` (`apps/print-agent/README.md`);
      print a real receipt and label; scan a longer receipt barcode; confirm the printer-hardware items still marked
      unverified there.
- [ ] Each shop's staff signs in at their own till; Shop 2's agent token works.
- [ ] Backups run and a restore was tested (§6). Uptime monitor on `https://api.fonology.co.uk/health/ready` and the home page,
      alerting the owner.
- [ ] Content-Security-Policy: add in **report-only** mode first (Stripe, inline animation styles) and watch the reports for a
      week before enforcing.
- [ ] Remove `ALLOW_TEST_WRITES`, disable the test accounts (`owner@fonology.test`, `staff@fonology.test`, `customer@…`), and
      change every default/dev credential. Confirm no `*.test` account can sign in on the live site.
- [ ] Re-run `go-live-check` after the final deploy; keep its output.

## Rollback

Redeploy the previous image tag in Coolify. Because migrations are additive-only, the previous API runs fine on the newer
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
- Stripe live go-live: [axonbuild checklist](https://axonbuild.com/blog/payment-go-live-checklist),
  [webhook reliability](https://webhookwatchtower.co.uk/blog/stripe-webhook-guide)
- Email authentication: [mailivery SPF/DKIM/DMARC](https://mailivery.io/blog/spf-dkim-dmarc-setup-guide-for-email-deliverability)
