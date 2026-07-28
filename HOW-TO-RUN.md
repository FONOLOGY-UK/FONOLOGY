# How to run Fonology locally (against dev)

Two terminals. Start the backend first, then the website. Both talk to the **dev** Supabase project — never production.

## Terminal 1 — the backend (`apps/api`)

```bash
cd apps/api
npx tsx src/server.ts
```

Wait for:

```
[api] listening on :4000
```

Check it's really up:

```bash
curl http://localhost:4000/health
```

Should return `{"ok":true}`.

## Terminal 2 — the website (`apps/web`)

```bash
cd apps/web
pnpm run dev
```

Wait for:

```
✓ Ready in ...
```

Open **http://localhost:3000** in your browser.

## What's already configured

`apps/web/.env.local` is already set to talk to the backend correctly:

```
NEXT_PUBLIC_DATA_SOURCE=http
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

That second line matters more than it looks — it must say `localhost`, not `127.0.0.1`. Those two look the same to a person but a web browser treats them as different websites, which silently breaks the login cookie (you'd be able to sign in but every page after that would act as if you weren't). This was hit once already and is fixed — just don't change `localhost` back to `127.0.0.1` if you're ever editing that file.

Both `.env.local` files (`apps/api/.env.local` and `apps/web/.env.local`) already point at the **dev** Supabase project. Nothing here can reach production.

## Stopping everything

`Ctrl+C` in each terminal. If a port is stuck occupied from a previous run:

```bash
# find what's using the port (4000 for the API, 3000 for the website)
netstat -ano | grep ":4000"
# kill it by the PID shown in the last column
taskkill //PID <that-number> //F
```

## Quick sanity check once both are running

- `http://localhost:4000/health` → `{"ok":true}`
- `http://localhost:3000` → the Fonology homepage loads

If either fails, check the terminal it's running in for an error — the most common cause is one of the two `.env.local` files being missing or misconfigured.

See [TEST-LOGINS.md](TEST-LOGINS.md) for accounts to actually sign in and test with (not committed to git — it has passwords in it, ask whoever ran the setup for a copy if you don't have one).
