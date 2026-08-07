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

**Dev project ref:** `ohkvwqqtppvnxbvvdsfr` (`FONOLOGY-UK-dev`).
**Production project ref:** `sbqqpuqoizyjzdcydqid` — never write to this, ever, from a dev/local session.

## 7. How a migration file actually reaches a database

Writing a file in `supabase/migrations/` does **nothing** by itself — it's a
record of intent, applied through one of two separate routes. This wasn't
written down anywhere for two prior sessions, which cost real time. It is now.

**Local (this machine's own Postgres, via Docker):** `npx supabase start` runs
the whole stack locally and auto-applies every migration in order. This is
where `npx supabase test db` (the pgTAP suite) actually runs — see
`supabase/tests/README.md`. Nothing here ever touches a hosted project.

**Hosted dev, `ohkvwqqtppvnxbvvdsfr`:** two ways, both real writes:

1. **Supabase MCP connector**, if the current session has it connected (check
   with `list_projects` / `list_migrations` before doing anything). Apply a
   migration file's contents with `apply_migration`, passing the project id
   explicitly every time.
2. **Supabase dashboard → SQL Editor**, paste the migration's SQL, run it.
   Slower, but needs nothing configured.

`supabase link` / `supabase db push` against the hosted project are
**deliberately not used** in this repo (see `supabase/tests/README.md` §"Why
local, and never `supabase link`") — that command needs a Supabase access
token this environment doesn't have, and linking risks a `db reset --linked`
against whichever project happens to be linked.

### ⚠️ The MCP connector is organisation-wide, not scoped to dev

If a session has the Supabase MCP connector authorized, **it can reach
production** (`sbqqpuqoizyjzdcydqid`) exactly as easily as dev — the
connector authenticates to the whole Supabase organisation, not to one
project. A paused production project does **not** protect it: Supabase
auto-resumes a paused project the moment something connects to it, so
"it's paused" is not a safety boundary.

**Before every single MCP write, migration, or destructive read: state the
project ref you are about to operate against, out loud, in the session's own
output — not just decide it silently.** If it is ever
`sbqqpuqoizyjzdcydqid`, stop and ask before proceeding. This project has
already had one session mistake production for a test database.
