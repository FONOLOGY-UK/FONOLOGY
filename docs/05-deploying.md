# 5. Deploying and rolling back

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

Coolify builds each Dockerfile (repo root as build context) from the `main` branch via a read-only deploy key.
Auto-deploy is **off**. A normal deploy is the **Deploy** workflow (section 0). The operator deploys by hand for a
migration, a rollback, a changed variable, or when the button is broken:

1. Merge to `main` (CI must be green: typecheck, lint, both images build).
2. Deploy `fonology-api` first, then `fonology-web` (Coolify, or the API call above).
3. Check `/health/ready` on the API, `/api/health` on web, then click the shop pages.

**Migrations:** they must land **before** the API that calls them runs. Do not use Coolify's pre/post-deploy
commands. Instead set `MIGRATE_DATABASE_URL` (superuser URL ending in `/fonology`) and `FONOLOGY_API_DB_PASSWORD`
on the API for that one deploy; the entrypoint migrates, and a failed migration stops the new container so the
old one keeps serving. Then **delete both variables and redeploy** so the running API holds no superuser
credentials. Migrations are additive-only, so the previous API runs fine on the newer schema.

**How the Deploy button reaches the server:** GitHub SSHes in as user `ghdeploy`, whose one key (repo secret
`DEPLOY_SSH_KEY`; `DEPLOY_HOST` and the pinned `DEPLOY_KNOWN_HOSTS` beside it) is restricted in
`/var/lib/ghdeploy/.ssh/authorized_keys` to the forced command `/usr/local/sbin/fonology-gh-deploy` (`status` or
`deploy <sha>`; source in `deploy/server/`). No shell, no port forwarding. The script calls Coolify's API on
localhost with the Coolify token `github-deploy` (read + deploy only) from `/etc/ghdeploy/deploy.env`
(root:ghdeploy 0640, read, not sourced — tokens contain `|`). **Turn it off:** empty that `authorized_keys`, or
delete the token in Coolify → Keys & Tokens. Changing the script: edit `deploy/server/`, then
`install -m 0755` it to `/usr/local/sbin/`.

**Rollback:** set the application's git commit to the last good sha (Coolify → application → commit, or
`PATCH /applications/<uuid>` with `git_commit_sha`) and deploy. A bad **data** change is a restore, not a rollback.

**Web build variables** are baked in at build time and must be marked "Build Variable" in Coolify:
`NEXT_PUBLIC_API_BASE_URL`, `STORAGE_PUBLIC_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Changing one needs a
**rebuild**, not a restart. The `noindex` header is on for any build whose API host is not on `fonology.co.uk`.

**Coolify quirks that cost time:** the web health probe needs host `127.0.0.1`; Garage's compose app needs
"preserve repository" and "connect to predefined network" on; app memory limits are set in Coolify (compose apps
take them from the compose file); a Docker-image app needs a custom network alias to be reachable by a stable name.
