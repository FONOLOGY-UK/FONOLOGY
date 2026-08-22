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

---

Once this is done, continue with `QA-TESTING-GUIDE.md` (setup recap + specific repro steps)
and `QA-TEST-PLAN.md` (the full test checklist) at the repo root.
