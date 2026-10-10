# Fonology

Fonology (fonology.co.uk) — a UK high-street phone repair and accessories shop in Thornliebank, Glasgow.
One monorepo, three deployables:

```
apps/web          Next.js 15 (App Router): public storefront, admin dashboard, employee till (POS)
apps/api          Express + TypeScript: the only holder of the database and storage credentials
apps/print-agent  Runs on the till PC (not on a server): Brother QL-600 labels, receipt printer
db/migrations     numbered SQL migrations, additive only (see db/migrations/README.md)
db/bootstrap      stubs the early migrations need on plain Postgres
deploy/           shop-setup.json (the shop's starting data), Garage compose file, rehearsal stack
docs/             go-live runbook, Coolify variable sheet, multi-shop rules, legal-page review
scripts/          dev stack, env setup, production rehearsal, go-live smoke check
```

Stack: Next.js · TypeScript (strict) · Tailwind · TanStack Query · Zod on the web; Express · Kysely · Postgres 17
· Garage (S3) on the API; Stripe for card payments. Turborepo + pnpm workspaces. Deployed to a netcup VPS with
Coolify from the two Dockerfiles (repo root as build context). Not Vercel, not Supabase.

## Run it locally

You need Node 20+, pnpm and Docker.

```bash
pnpm install
pnpm setup:env      # writes apps/api/.env.local and apps/web/.env.local with the local defaults
pnpm stack:up       # Docker: Postgres :55432, Garage (S3) :3900, Mailpit (email inbox) :8025
pnpm db:migrate     # create the tables
pnpm storage:setup  # create the image / document buckets
pnpm db:seed        # test logins (owner / staff / customer @fonology.test) and one repairable phone
pnpm --filter @fonology/api exec tsx scripts/seed-demo-catalogue.ts   # optional: demo products
```

Then, in two terminals:

```bash
cd apps/api && npx tsx src/server.ts     # wait for: [api] listening on :4000
cd apps/web && pnpm run dev              # wait for: Ready — http://localhost:3000
```

Use `localhost`, never `127.0.0.1` — the browser treats them as different sites and the session cookie
silently stops working. Every email the API sends lands in Mailpit at http://localhost:8025.

The seeded accounts are `owner@fonology.test` (PIN 1234), `staff@fonology.test` (PIN 5678) and
`customer@fonology.test`; the password is in `apps/api/scripts/seed-dev.ts`. Staff sign in at `/staff-login`,
customers at `/login`.

`pnpm stack:down` stops Docker and keeps the data; `pnpm stack:reset` deletes it.

### Stripe (card checkout)

Without Stripe **test** keys the storefront has no card form. Put `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
in `apps/api/.env.local` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `apps/web/.env.local` (never a live key —
the API refuses to boot with one outside production). Locally, `stripe listen --forward-to
localhost:4000/webhooks/stripe` prints the webhook secret, or run
`pnpm --filter @fonology/api exec tsx scripts/simulate-stripe-paid.ts <order reference>` to play Stripe's part.
Google sign-in is optional (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).

## Commands

| Command                                | What it does                                          |
| -------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                             | all apps in parallel (Turbopack for web)              |
| `pnpm build`                           | production build                                      |
| `pnpm typecheck`, `pnpm lint`          | `tsc --noEmit`, ESLint across the repo                |
| `pnpm format`                          | Prettier                                              |
| `pnpm db:migrate`                      | apply pending migrations (`-- --status` to only list) |
| `pnpm rehearsal:up` / `rehearsal:test` | the production images on a local stack (go-live §9a)  |
| `pnpm go-live-check`                   | smoke-test a deployed API and web                     |

There is no automated test suite. Typecheck and lint are the checks; behaviour is verified by running the app
and clicking through it.

## Where to read next

- `CLAUDE.md` — architecture and the standing rules (money in pence, server-side pricing, shop scoping…).
- `docs/go-live.md` — the production runbook; `docs/coolify-env-vars.md` — every variable.
- `apps/print-agent/README.md` — the till-PC printer agent.
