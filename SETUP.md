# Setup — from a fresh clone to running

You have the code but no env files — that's expected, they're gitignored on purpose (they hold real credentials). Follow this in order.

## 1. Install

From the repo root:

```bash
pnpm install
```

## 2. Env files

Two apps, two env files, both untracked. Copy the example, then fill it in:

```bash
cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local
```

**`apps/api/.env.local` needs:**

- `SUPABASE_URL` — public
- `SUPABASE_ANON_KEY` — public
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**, bypasses every access rule in the database
- `PORT` — `4000` is fine
- `CORS_ORIGINS` — `http://localhost:3000` for local dev

**`apps/web/.env.local` needs:**

- `NEXT_PUBLIC_DATA_SOURCE` — `http` (talks to the real backend, not the mock)
- `NEXT_PUBLIC_API_BASE_URL` — `http://localhost:4000` (must say `localhost`, not `127.0.0.1` — see [HOW-TO-RUN.md](HOW-TO-RUN.md))
- `NEXT_PUBLIC_SITE_URL` — `http://localhost:3000`
- `NEXT_PUBLIC_SUPABASE_URL` — public
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public

## 3. Public vs. secret — and where to get the values

Everything above except one value is a **public** key — safe to ship in a browser bundle, safe to paste anywhere. The one exception is `SUPABASE_SERVICE_ROLE_KEY` — that one is **secret**. It bypasses row-level security entirely; treat it like a database root password. Never paste it into chat, email, Slack, or a commit — if it ever ends up in git history, it has to be rotated, not just deleted.

All of these values — public and secret — live in **Infisical, project FONOLOGY, Development environment**. Pull them from there, not from anyone's local file or a message.

## 4. Start both apps

See [HOW-TO-RUN.md](HOW-TO-RUN.md) for the two-terminal startup, the sanity-check URLs, and how to free a stuck port.

## 5. Test accounts

`TEST-LOGINS.md` is **not in this repo** — it has real passwords in it, so it's gitignored and shared separately. Ask whoever set this up for a copy.

## 6. Dev vs. production

Everything here — the Supabase project, the env values above — points at the **dev** database only. Production is a separate Supabase project and is never touched by anything in this repo's local setup.
