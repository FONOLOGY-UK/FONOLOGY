# 9. When something breaks

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

**Site is down.** (1) Is it the whole server? `ssh` in; if not, check netcup status and the panel. (2) `docker ps -a`
— anything exited? Restart it in Coolify. (3) `docker logs --tail 100 <container>`. (4) Disk full? `df -h /`.
(5) Traefik: `docker logs coolify-proxy`. (6) Recent deploy? Roll back (section 5). The till works for cash sales
only while the API is up — tell the shop to note sales on paper and enter them after.

**API unhealthy / 502.** `/health/ready` reaches the database; if it fails, check the Postgres container and
connections, then restart the API. A boot loop with `[config] Missing or invalid environment variable(s)` means a
bad Coolify variable.

**Card payments fail.** Check Stripe's webhook endpoint in the dashboard, that `STRIPE_WEBHOOK_SECRET` matches that
endpoint, that the API log shows `[webhook] … marked paid`, and the web build used the right publishable key.
Orders are created first and priced by the server; a paid order that is not marked paid means the webhook did not arrive.

**Emails or texts not arriving.** API log lines `[email] …`. Brevo needs a verified sender domain (SPF/DKIM); do not
touch the MX record — the business mailbox lives there.

**Server compromised / secret leaked.** Rotate in this order: Stripe keys and webhook secret, database passwords
(update `DATABASE_URL`, restart), S3 and Garage secrets, Backblaze key, Coolify token, SSH key, GitHub secrets;
revoke all `auth_sessions` (`update auth_sessions set revoked_at = now()`); review `docker ps` for unknown containers
and `/root/.ssh/authorized_keys`. If unsure, rebuild the server from backups.
