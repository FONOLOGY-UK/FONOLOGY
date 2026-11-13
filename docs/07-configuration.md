# 7. Configuration reference

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

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
