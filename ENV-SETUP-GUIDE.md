# Env file setup — where the 3 files go

You've been sent three files separately from the repo (they're gitignored on purpose — they
hold real credentials, so they don't travel with `git clone`). Don't commit them, don't forward
them anywhere else.

## 1. Clone the repo first

```bash
git clone <repo-url>
cd FONOLOGY
```

## 2. Drop each file in its exact spot

| File you were sent  | Goes here (relative to the repo root) |
| ------------------- | ------------------------------------- |
| `.env.local` (root) | `FONOLOGY/.env.local`                 |
| `.env.local` (web)  | `FONOLOGY/apps/web/.env.local`        |
| `.env.local` (api)  | `FONOLOGY/apps/api/.env.local`        |

Same filename in all three places — `.env.local` — just three different folders. If your file
transfer renamed them (e.g. `web.env.local`, `api.env.local`), rename them back to `.env.local`
once they're in the right folder.

```
FONOLOGY/
├── .env.local                 ← root one goes here
├── apps/
│   ├── web/
│   │   └── .env.local         ← web one goes here
│   └── api/
│       └── .env.local         ← api one goes here
```

## 3. Sanity-check they landed right

From the repo root:

```bash
ls -la .env.local apps/web/.env.local apps/api/.env.local
```

All three should exist. If any is missing, it didn't get placed — the app will fail to connect
to anything (no catalog, no sign-in) without it, so don't skip this check.

## 4. Install and run

```bash
pnpm install
pnpm dev
```

This starts the API on `http://localhost:4000` and the website on `http://localhost:3000`
together. Leave both running while you test.

## 5. One more file you'll need

You should also have been sent `TEST-LOGINS.md` separately — that's the test account
passwords, not env config. It goes at the repo root too (`FONOLOGY/TEST-LOGINS.md`), same
reasoning: gitignored, not in the clone.

## Security note

`apps/api/.env.local` contains a Supabase **service role key** — it bypasses all database
access rules, equivalent to an admin password for the whole dev database. Treat these three
files like passwords: don't paste them into chat tools, screenshots, tickets, or anywhere
outside this one-time transfer. Delete them from your downloads/transfer folder once they're
placed, and never `git add` them (the `.gitignore` will block it, but don't try to force it).

## 6. Stripe webhook forwarding — needed for checkout to ever complete locally

This one is easy to miss and doesn't announce itself when it's wrong: **without it, every card
payment you make against localhost will take the money in Stripe and then leave the order stuck
on "pending" forever**, because the piece of code that flips an order to `paid` only runs when
Stripe's `payment_intent.succeeded` webhook reaches the API — and Stripe can't reach
`localhost:4000` on its own from the outside. Locally, you have to forward it yourself.

You'll need the Stripe CLI, installed once per machine:

```bash
winget install --id Stripe.StripeCli
```

Then, every time you're testing checkout, open a **third terminal** (alongside the API and web
dev servers) and run:

```bash
stripe listen --api-key <STRIPE_SECRET_KEY from apps/api/.env.local> --forward-to localhost:4000/webhooks/stripe
```

Using `--api-key` with the test secret key directly (rather than `stripe login`) skips the
interactive browser OAuth step — useful since this machine may not have a browser session tied
to the Fonology Stripe account. Leave this running for as long as you're testing payments; stop
it with Ctrl+C when you're done.

The first line it prints is a webhook signing secret (`whsec_...`) — it should match
`STRIPE_WEBHOOK_SECRET` already in `apps/api/.env.local` (Stripe returns the same one for this
account+key each time, so nothing to update in the normal case). If it ever prints a
**different** value, paste the new one into `STRIPE_WEBHOOK_SECRET` and restart the API, or the
webhook's signature check will reject every event.

**If you forget to run this**: card payments will still be taken in Stripe, but the order stays
`pending` in the app. The Online Orders page has a collapsed "N payments stuck unconfirmed"
notice for exactly this case (Round 3 #1.2) — it's diagnostic only (no fix-it button; go check
the payment in the Stripe dashboard for that order reference). Once `stripe listen` is running
again, a fresh checkout will confirm normally; anything that got stuck while it was down does
not auto-resolve retroactively and needs a manual look.

---

Once this is done, continue with `QA-TESTING-GUIDE.md` (setup recap + specific repro steps)
and `QA-TEST-PLAN.md` (the full test checklist) at the repo root.
