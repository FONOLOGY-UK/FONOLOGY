# First-time setup

About 15 minutes. You need **Node 20+**, **pnpm 11** and **Docker Desktop**. You do not need anyone to send
you any files or keys.

```bash
git clone <repo-url> && cd FONOLOGY
pnpm install
pnpm setup:env          # writes apps/api/.env.local and apps/web/.env.local with the local defaults
pnpm stack:up           # Docker: Postgres, file storage, email inbox
pnpm db:migrate         # create the tables
pnpm storage:setup      # create the image / document buckets
pnpm db:seed            # the three test logins
pnpm --filter @fonology/api exec tsx scripts/seed-demo-catalogue.ts   # 14 demo products
```

Then follow **HOW-TO-RUN.md**.

## Stripe test keys (needed for the checkout card form)

Without these the storefront has no card form and the card-checkout tests cannot pass. Use your own free
Stripe account **in test mode** (`pk_test_`, `sk_test_` — never a live key):

1. dashboard.stripe.com/test/apikeys → copy the publishable and secret keys.
2. `stripe listen --forward-to localhost:4000/webhooks/stripe` prints a `whsec_…` signing secret.
3. Put them in the env files `pnpm setup:env` made:
   - `apps/api/.env.local` → `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `apps/web/.env.local` → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

(The browser tests can also send the signed webhook themselves, so `stripe listen` is only needed when you
check out by hand.)

## Optional

- **Google sign-in:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `apps/api/.env.local`. Without them the
  storefront says Google isn't available and offers email.
- **A shop's real set-up:** `pnpm --filter @fonology/api import:supabase` copies staff, settings, delivery
  rates and repairs from the old dev Supabase database. It needs `DEV_SUPABASE_DB_URL` and is only for the
  developer; testers do not need it.

## Rules that matter

- Local env files are **gitignored** — never commit them, and never put a live Stripe key in one.
- Migrations in `supabase/migrations` are additive-only and are frozen once pushed — read
  `supabase/migrations/README.md` before writing one.
