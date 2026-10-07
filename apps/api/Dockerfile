# syntax=docker/dockerfile:1
# ============================================================================
# Fonology API — self-hosted VPS deploy (Docker / Coolify).
# Every setting (APP_ENV, DATABASE_URL, S3_*, STRIPE_*, …; see .env.example)
# is injected at runtime — nothing secret is baked into this image.
# Build context = repo root (monorepo).
#   docker build -f apps/api/Dockerfile -t fonology-api .
#
# One image, several commands (WORKDIR is apps/api):
#   docker-entrypoint.sh                   the API (default); applies migrations first when
#                                          MIGRATE_DATABASE_URL is set (see the script)
#   node dist/scripts/migrate.js           pre-deploy: apply pending migrations
#                                          (needs MIGRATE_DATABASE_URL, a superuser)
#   node dist/scripts/storage-setup.js     pre-deploy: buckets (needs GARAGE_ADMIN_*)
#   node dist/scripts/purge-documents.js   scheduled, daily
#   node dist/scripts/purge-print-jobs.js  scheduled, every few minutes
#   node dist/scripts/purge-sms-log.js     scheduled, daily (blanks repair-text numbers after 180 days)
#   node dist/scripts/import-from-supabase.js  once, into the fresh database
#                                          (needs DEV_SUPABASE_DB_URL)
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
# Read by dist/scripts/migrate.js (four levels up from it is /app).
COPY --chown=apiuser:nodejs supabase/migrations ./supabase/migrations
COPY --chown=apiuser:nodejs db/bootstrap ./db/bootstrap
COPY --chown=apiuser:nodejs apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh

USER apiuser
WORKDIR /app/apps/api
EXPOSE 4000

# start-period is long on purpose: a deploy that carries migrations applies them before the server
# listens (docker-entrypoint.sh), and a fresh database has ~100 of them.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "/app/docker-entrypoint.sh"]
