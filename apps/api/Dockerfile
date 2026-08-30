# syntax=docker/dockerfile:1
# ============================================================================
# Fonology API — self-hosted VPS deploy (Docker / Coolify), NOT Vercel.
# Env vars (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PORT,
# CORS_ORIGINS) are injected by Coolify from Infisical at runtime — nothing
# secret is baked into this image. Build context = repo root (monorepo).
#   docker build -f apps/api/Dockerfile -t fonology-api .
# ============================================================================

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ---- deps: install full workspace dependencies (needed to build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile

# ---- builder: compile TypeScript ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @fonology/api build

# ---- prod-deps: production-only install, isolated so the runner image is small ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --prod --filter @fonology/api

# ---- runner: minimal production image ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 apiuser

COPY --from=prod-deps --chown=apiuser:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=apiuser:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=apiuser:nodejs /app/apps/api/package.json ./apps/api/package.json

USER apiuser
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
