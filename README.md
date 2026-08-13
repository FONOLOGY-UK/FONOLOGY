# Fonology

Production web application for Fonology (fonology.co.uk) — a UK high-street
phone repair & accessories shop. Three surfaces: public **storefront**, admin
**dashboard**, and employee **POS**.

Frontend monorepo. Backend (APIs, DB, auth) is added later as `apps/api` +
`packages/contracts` — the structure is ready for it.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS + CSS-variable tokens
· shadcn/ui (admin/employee) · TanStack Query · Zustand · React Hook Form + Zod
· Framer Motion + GSAP (storefront) · TanStack Table · Recharts · lucide-react.
Monorepo: Turborepo + pnpm workspaces. Deploy: self-hosted VPS via Docker /
Coolify (**not** Vercel); Next runs in `output: 'standalone'`.

## Layout

```
apps/web                 Next.js app (the frontend)
  src/app                route groups: (storefront) (auth) (dashboard) (pos)
  src/components         ui/ (shadcn), shared/, providers/, admin/, pos/
  src/lib/data           the data layer — see below
  src/lib/stores         Zustand (cart, toast)
  src/styles/globals.css design tokens (verbatim from the prototype) + base
apps/api                 Express + TypeScript backend; holds the service-role key
apps/print-agent         runs INSIDE the shop, on the till PC — drives the
                         receipt and label printers. See its own README.
supabase/migrations      plain SQL, additive only
supabase/tests           pgTAP suite (local Docker stack only)
packages/*               reserved for Raja (contracts, etc.)
```

## The data layer

No component ever calls `fetch`. Data flows one way:

```
component → @/lib/data/hooks (TanStack Query) → DataAdapter → mock | http
```

Swap the whole app between mock fixtures and the real API with one env var
(`NEXT_PUBLIC_DATA_SOURCE=mock|http`). See **INTEGRATION.md**.

## Getting started

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # defaults to mock data
pnpm dev                                        # http://localhost:3000
```

Routes: `/` `/shop` `/shop/[slug]` `/repair` `/sell` `/cart` `/checkout`
`/track` · `/login` `/register` `/forgot-password` `/staff-login` · `/admin` ·
`/pos`. Health probe: `/api/health`.

## Scripts (root)

| Command                                   | What it does                   |
| ----------------------------------------- | ------------------------------ |
| `pnpm dev`                                | Run the app in dev (Turbopack) |
| `pnpm --filter @fonology/web dev:webpack` | Dev on webpack — fallback only |
| `pnpm build`                              | Production build (standalone)  |
| `pnpm start`                              | Serve the production build     |
| `pnpm lint`                               | ESLint                         |
| `pnpm typecheck`                          | `tsc --noEmit`                 |
| `pnpm format`                             | Prettier write                 |

## House rules

- **Storefront is reproduced, not redesigned** — the prototype is the source of
  truth (HARD RULE #1).
- **No VAT anywhere** — Fonology is not VAT registered (HARD RULE #3).
- **No backend logic here** — everything is backend-shaped and mock-backed
  (HARD RULE #2).

See **NOTES.md** for the phase map and open questions, **INTEGRATION.md** for
the backend handoff.
