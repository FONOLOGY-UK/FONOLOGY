# Environment files

Two local files, both **gitignored**, both created for you by `pnpm setup:env` (it never overwrites an
existing file):

| File                  | Holds                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `apps/api/.env.local` | database, storage, email, Stripe secret, URLs — the API's settings    |
| `apps/web/.env.local` | the API's address, the site's address, the Stripe **publishable** key |

There is no root `.env.local`. The old Supabase variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`, `NEXT_PUBLIC_DATA_SOURCE`) are no longer read by
anything — delete them if you still have them. `DEV_SUPABASE_DB_URL` is used only by the one-time
`import:supabase` script.

## What `pnpm setup:env` fills in

The local Docker stack's fixed defaults — not secrets: `DATABASE_URL`, `S3_*` (the dev storage key),
`SMTP_URL` (emails land in http://localhost:8025), `AUDIT_STAFF_*` (the seeded owner login), and the
web app's `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`.

## What you add yourself

Your own Stripe **test** keys (see SETUP.md): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in the API file,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the web file. Optionally `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## Rules

- `NEXT_PUBLIC_API_BASE_URL` must say `localhost`, not `127.0.0.1`.
- A live Stripe key (`sk_live_`) outside production stops the API from booting, on purpose.
- Production values are not in the repo: they live in the server's secret store and are set in Coolify —
  see `docs/go-live.md`.
- In the API, only `src/config.ts` reads `process.env`. Add a setting there, not in a route.
