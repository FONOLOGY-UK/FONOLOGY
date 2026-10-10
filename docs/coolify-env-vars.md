# Coolify environment variables — ready to paste

Drafted 2026-10-10, verified against `apps/api/src/config.ts` (the one place the API reads
`process.env`) and the web app's actual `process.env` reads — not just copied from `go-live.md`.
Use this alongside `docs/go-live.md` §4: that doc explains _why_; this one is the checklist to
paste into Coolify's "Environment Variables" tab for each resource.

Legend: **R** = required (the app refuses to boot or silently misbehaves without it) · **O** =
optional (the app runs fine without it, that feature just stays off) · **B** = web-only, must be
marked **Build Variable** in Coolify, not Runtime — Next.js inlines these at build time, so a
runtime-only value bakes in as `undefined`.

---

## API service (`apps/api/Dockerfile`, port 4000, domain `api.fonology.co.uk`)

### Core — set before first deploy

| Variable               | R/O | Value                                                              | Where it comes from                                                                                                                                       |
| ---------------------- | --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | R   | `production`                                                       | The image sets this itself — don't override                                                                                                               |
| `APP_ENV`              | R   | `production`                                                       | Must be set explicitly — API refuses to boot under `NODE_ENV=production` without it                                                                       |
| `DATABASE_URL`         | R   | `postgres://fonology_api:<password>@<postgres-host>:5432/fonology` | The `fonology_api` role, created when migrations run (§4.1)                                                                                               |
| `DATABASE_POOL_MAX`    | O   | `10` (default)                                                     | Only raise if you see pool exhaustion                                                                                                                     |
| `PORT`                 | O   | `4000` (default)                                                   | Leave as default                                                                                                                                          |
| `CORS_ORIGINS`         | R   | `https://fonology.co.uk`                                           | Add `https://www.fonology.co.uk` only if www serves content rather than redirecting                                                                       |
| `WEB_APP_URL`          | R   | `https://fonology.co.uk`                                           | Used to build links inside outbound emails                                                                                                                |
| `API_PUBLIC_URL`       | R   | `https://api.fonology.co.uk`                                       | Where browsers reach this API — also the base for the Google OAuth callback                                                                               |
| `TRUST_PROXY_HOPS`     | R   | `1`                                                                | `2` only if Cloudflare proxies the site in front of Coolify's Traefik. Wrong value = forgeable rate-limit bypass.                                         |
| `S3_ENDPOINT`          | R   | `http://garage:3900`                                               | Garage's internal address (private Docker network)                                                                                                        |
| `S3_REGION`            | O   | `garage` (default)                                                 | Leave as default                                                                                                                                          |
| `S3_ACCESS_KEY_ID`     | R   | from `storage-setup.js` output                                     | Printed when you run the storage-setup script (§4.2)                                                                                                      |
| `S3_SECRET_ACCESS_KEY` | R   | from `storage-setup.js` output                                     | Same                                                                                                                                                      |
| `S3_PUBLIC_ENDPOINT`   | R   | `https://s3.fonology.co.uk`                                        | **Must** be set in production — without it, signed links to private files (ID documents, buy-in forms) point at `garage:3900`, which no browser can reach |
| `STORAGE_PUBLIC_URL`   | R   | `https://product-images.web.fonology.co.uk`                        | Public product-photo host                                                                                                                                 |

### Payments

| Variable                | R/O | Value       | Where it comes from                                                                                      |
| ----------------------- | --- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | R*  | `sk_live_…` | Stripe Dashboard, live mode                                                                              |
| `STRIPE_WEBHOOK_SECRET` | R*  | `whsec_…`   | Stripe Dashboard → Developers → Webhooks → the **live** endpoint's own signing secret (not the test one) |

\* Technically optional at boot (the API runs the till even with no Stripe key), but online checkout is broken without both, and the API actively **refuses to start** if it sees a live key outside `APP_ENV=production`, or a test key inside it without `ALLOW_TEST_WRITES=true`.

### Email & SMS (Brevo)

| Variable             | R/O | Value                           | Where it comes from                                                                                                             |
| -------------------- | --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `BREVO_API_KEY`      | O†  | from Brevo dashboard            | Account → SMTP & API → API Keys                                                                                                 |
| `BREVO_SENDER_EMAIL` | O   | `info@fonology.co.uk` (default) | Must be a real, domain-verified mailbox once Brevo's DNS records are in                                                         |
| `BREVO_SENDER_NAME`  | O   | `Fonology` (default)            | —                                                                                                                               |
| `SMS_MODE`           | O   | `log` until ready, then `brevo` | `log` = texts recorded but never sent (safe default); `off` = nothing recorded; `brevo` needs SMS credits bought on the account |
| `BREVO_SMS_SENDER`   | O   | `Fonology` (default)            | ≤11 letters/digits, no spaces — what the customer's phone shows as sender                                                       |
| `SMTP_URL`           | —   | **don't set in production**     | Dev-only (points at the local Mailpit catcher) — leave unset so Brevo's HTTP API is used instead                                |

† Optional to boot, but without it every transactional email (order confirmation, password reset, repair-stage text) silently logs and skips instead of sending — functionally required before opening.

### Google sign-in (optional feature)

| Variable               | R/O | Value                     | Where it comes from                                                                                    |
| ---------------------- | --- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`     | O   | from Google Cloud Console | OAuth 2.0 Client — add `https://api.fonology.co.uk/auth/google/callback` as an authorised redirect URI |
| `GOOGLE_CLIENT_SECRET` | O   | from Google Cloud Console | Same client                                                                                            |

Leave both unset and the storefront simply hides the "Sign in with Google" button — nothing breaks.

### Pre-launch only — set, test, then remove

| Variable                   | Value                                                                    | Note                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ALLOW_TEST_WRITES`        | `true`                                                                   | Lets test scripts (and a Stripe _test_ key) run against production before opening. **Remove on opening day.**                                                                                          |
| `MIGRATE_DATABASE_URL`     | `postgres://postgres:<superuser-password>@<postgres-host>:5432/postgres` | Only set on a deploy that carries pending migrations — the entrypoint applies them before the server starts, then **remove this var** so the running API doesn't hold superuser credentials day to day |
| `FONOLOGY_API_DB_PASSWORD` | a strong generated password                                              | Needed alongside `MIGRATE_DATABASE_URL` — this becomes the `fonology_api` role's password (reused in `DATABASE_URL` above)                                                                             |

### One-off terminal commands (not env vars, run once each)

- `node dist/scripts/storage-setup.js` — needs `GARAGE_ADMIN_URL=http://garage:3903` and `GARAGE_ADMIN_TOKEN` set just for that run; creates the three buckets. **Do this before the first upload.**
- `node dist/scripts/import-from-supabase.js` — needs `DEV_SUPABASE_DB_URL`; brings staff/passwords/settings/delivery/repairs/reviews (no products, no trading history).

### Scheduled tasks (Coolify → this service → Scheduled Tasks)

| Command                                   | Schedule    |
| ----------------------------------------- | ----------- |
| `node dist/scripts/purge-documents.js`    | daily 03:00 |
| `node dist/scripts/purge-print-jobs.js`   | daily 03:10 |
| `node dist/scripts/purge-sms-log.js`      | daily 03:20 |
| `node dist/scripts/purge-housekeeping.js` | daily 03:30 |

### Not needed / safe to ignore

- `INTERNAL_PROXY_SECRET` — only matters for the old Render `/api-proxy` topology, not this one. The API logs a warning about it on every boot; ignore it.

---

## Web service (`apps/web/Dockerfile`, port 3000, domain `fonology.co.uk`)

| Variable                             | R/O | B?        | Value                                                                                                                                                                     |
| ------------------------------------ | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`           | R   | **Build** | `https://api.fonology.co.uk` — real hostname, never `127.0.0.1` or `localhost`                                                                                            |
| `STORAGE_PUBLIC_URL`                 | R   | **Build** | `https://product-images.web.fonology.co.uk`                                                                                                                               |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | R   | **Build** | `pk_live_…` from Stripe, live mode                                                                                                                                        |
| `NEXT_PUBLIC_SITE_URL`               | O   | **Build** | `https://fonology.co.uk` — listed in the original go-live plan; I checked and nothing in the current code actually reads it. Harmless to set, not currently load-bearing. |

Since these are build-time, **mark each one "Build Variable" in Coolify**, not just Runtime — a
runtime-only value bakes in as literal `undefined` in the compiled output and you won't see the
mistake until something's broken in production.

After any dependency change, rebuild the web image in Docker before shipping — pnpm 9 and 11
hoist differently, and the project is pinned to 11 (`corepack pnpm install`, not a bare `pnpm
install`, if your local pnpm defaults to 9).

---

## DNS records needed (at your registrar, once you have the VPS IP)

| Host                 | Type                | Points to                                  |
| -------------------- | ------------------- | ------------------------------------------ |
| `@`                  | A                   | VPS IP                                     |
| `www`                | A (or CNAME to `@`) | VPS IP — Coolify then redirects www → apex |
| `api`                | A                   | VPS IP                                     |
| `s3`                 | A                   | VPS IP                                     |
| `product-images.web` | A                   | VPS IP                                     |

**Current state (checked today):** `fonology.co.uk` and `www` already resolve — to an old,
unrelated WordPress install, not this project. You'll need registrar access to repoint these at
go-live time.

## Brevo domain authentication (can be started now, before the VPS exists)

Once you have a Brevo account: add their SPF include, DKIM records, and a DMARC record
(`_dmarc.fonology.co.uk`, start at `p=none` with a reporting address) at your DNS provider. None
of this needs the server to exist first.

## Backups — off-server bucket (can be set up now)

Pick one (Backblaze B2 is the easy/cheap default) and create the bucket + access keys ahead of
time. Coolify's Postgres backup target and the Garage sync cron both just need an S3-compatible
endpoint + keys — doesn't matter that the VPS doesn't exist yet.
