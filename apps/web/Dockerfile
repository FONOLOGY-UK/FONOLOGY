# syntax=docker/dockerfile:1
# ============================================================================
# Fonology web — self-hosted VPS deploy (Docker / Coolify), NOT Vercel.
# Multi-stage build producing a minimal Node runtime from Next's
# `output: 'standalone'` trace. Build context = repo root (monorepo).
#   docker build -f apps/web/Dockerfile -t fonology-web .
# ============================================================================

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- deps: install workspace dependencies ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---- builder: build the standalone app ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Same reason as in apps/api/Dockerfile: `COPY . .` makes pnpm 11's pre-run dependency check re-install the
# whole workspace before `next build`. The deps stage already installed what this build needs.
ENV npm_config_verify_deps_before_run=false

# NEXT_PUBLIC_* vars are inlined into the client bundle by `next build` —
# there is no runtime fallback for them the way a server-only env var has.
# Coolify (like any Docker build) only makes a resource's Build Variables
# available in here as build ARGs if this Dockerfile declares them with ARG
# first; without this block every one of these would bake in as literally
# `undefined`, and the deployed site would call an API at "undefined".
# scripts/go-live-check.mjs reads them back out of the CSP header to prove it.
ARG NEXT_PUBLIC_API_BASE_URL
ARG STORAGE_PUBLIC_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    STORAGE_PUBLIC_URL=$STORAGE_PUBLIC_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

RUN pnpm --filter @fonology/web build

# ---- runner: minimal production image ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + traced deps, static assets, and public/.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# `output: 'standalone'` does not include .next/cache (Next's documented behaviour). Next's image
# optimiser and fetch cache write there at runtime, so the directory has to exist and be writable.
RUN mkdir -p apps/web/.next/cache && chown -R nextjs:nodejs apps/web/.next/cache

USER nextjs
EXPOSE 3000

# Coolify/orchestrator healthcheck target: GET /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
