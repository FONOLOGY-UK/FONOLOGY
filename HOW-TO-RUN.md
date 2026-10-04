# How to run Fonology locally

Everything runs on your machine: Postgres, file storage and an email inbox in Docker, plus the API and
the website. Nothing here can reach the live shop. First time? Do **SETUP.md** once, then come back.

## Each time

```bash
pnpm stack:up                        # Docker: database, storage, email inbox (safe to repeat)
cd apps/api && npx tsx src/server.ts # wait for: [api] listening on :4000
```

In a second terminal:

```bash
cd apps/web && pnpm run dev          # wait for: Ready — then open http://localhost:3000
```

Check the API is up:

```bash
curl http://localhost:4000/health        # {"ok":true}
curl http://localhost:4000/health/ready  # {"ok":true,"db":true}
```

Use **`localhost`**, never `127.0.0.1` — the browser treats them as different sites and sign-in silently breaks.

## Where things are

| What                     | Where                  |
| ------------------------ | ---------------------- |
| Website + admin + till   | http://localhost:3000  |
| API                      | http://localhost:4000  |
| Email inbox (all emails) | http://localhost:8025  |
| Test logins              | `docs/tester-guide.md` |

## If `pnpm run dev` crashes on Windows

"An Application Control policy has blocked this file" means Windows is blocking Next.js's compiler.
Run the production build in Docker instead — see "Production build" in `packages/e2e/README.md`.

## Stop

`Ctrl+C` in each terminal. `pnpm stack:down` stops Docker and keeps the data; `pnpm stack:reset` stops it and
deletes all data (you will need to run SETUP.md's database steps again).
