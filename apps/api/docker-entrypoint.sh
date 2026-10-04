#!/bin/sh
# Container entrypoint for the API.
#
# If MIGRATE_DATABASE_URL is set, apply pending migrations BEFORE the server starts. Under Coolify's
# rolling update the old container keeps serving until this one is healthy, so a migration that fails
# stops THIS container (the deploy fails, the old API stays up) — and the API can never start against
# a database that is missing the functions it calls. Migrations are additive-only, so the old API is
# safe against the migrated database in the meantime.
#
# Coolify's own pre/post-deployment commands cannot do this: pre runs in the OLD container (and is
# skipped on the first deploy), post runs after the new one is already live.
#
# MIGRATE_DATABASE_URL is a SUPERUSER connection. Set it only for a deploy that carries migrations
# and remove it afterwards, so the running API does not hold superuser credentials day to day.
set -e
if [ -n "$MIGRATE_DATABASE_URL" ]; then
  echo "[entrypoint] applying pending migrations"
  node dist/scripts/migrate.js
fi
exec node dist/server.js
