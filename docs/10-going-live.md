# 10. Going live (still to do)

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

**Done 2026-10-11:** the domain cutover. `fonology.co.uk` (www redirects to it), `api.`, `s3.` and `product-images.web.` are
A records to the VPS (TTL 300); the old `mail` CNAME became an A record to the hosting IP so mail clients keep working;
MX, SPF, DKIM and the `_caldav`/`_carddav` records were left alone. The zone is edited in the TMDHosting cPanel Zone Editor
(nameservers `ns1/ns2.uk22.tmd.cloud`). Coolify domains, API/web variables, the web rebuild, `watchdog.conf`, the uptime
variables and the Stripe (test) webhook all use the real hostnames. Staff webmail: `fonology.co.uk/webmail` redirects (next.config.mjs) to `https://mail.fonology.co.uk:2096/` on the TMD host; mail itself never moved. Garage domains need explicit ports in Coolify
(`product-images.web...:3902`, `s3...:3900`) or Traefik logs "port is missing". `scripts/go-live-check.mjs`: 55 pass.
**Still on test mode (checked 2026-11-12):** Stripe test keys and `ALLOW_TEST_WRITES=true`. Mailpit is removed, the staging data was wiped on 8 Nov, no `*@fonology.test` accounts remain, and the site is indexable on purpose.

Still to do:

1. **Brevo (done 2026-10-11):** `fonology.co.uk` is authenticated (code, DKIM x2, DMARC `p=none`, branded `send` CNAMEs), sender `orders@fonology.co.uk` (a cPanel forwarder to the shop Gmail, no mailbox), API key in Coolify. Brevo's **Authorised IPs** list must contain the VPS's IPv4 address (the API connects over IPv4; a call over IPv6 is refused). Free plan: 300 emails/day, no SMS credits (`SMS_MODE=log`). Later: move DMARC to `p=quarantine` once reports look clean.
2. **Wipe staging:** stop the API, drop and recreate `fonology`, redeploy with `MIGRATE_DATABASE_URL` (fresh schema),
   delete test photos or recreate the Garage volumes and re-run `storage-setup`, run `setup-shop`.
3. **Remove staging bits:** Mailpit, `SMTP_URL`, `ALLOW_TEST_WRITES`, the test Stripe keys and the staging Stripe webhook.
4. **Live settings:** live Stripe keys + live webhook (`/webhooks/stripe`, events `payment_intent.succeeded`,
   `refund.updated`), Brevo key and sender, `SMS_MODE=brevo` when credits are bought, real hostnames in all variables,
   **rebuild web** (build variables changed).
5. **Update (done for the domain):** after any hostname change redo `/etc/fonology/watchdog.conf`, `UPTIME_*` variables and the Stripe webhook URL.
6. **Prove it:** `scripts/go-live-check.mjs`, a real test order, a test refund, a day close, a restore drill, and the
   printer checks on the till PC (section 12).
7. **Opening day:** remove `ALLOW_TEST_WRITES`, disable the test accounts (`*@fonology.test`), confirm the Content
   Security Policy has run clean for a week and switch it from report-only to enforcing in `next.config.mjs`.

`scripts/rehearsal.mjs` (`pnpm rehearsal:up | rehearsal:test | rehearsal:down`) runs the real production images with
official Postgres, Garage and a TLS proxy locally. Use it after touching a Dockerfile, `deploy/`, the entrypoint,
a migration or a server-side job. It needs ports 80/443 free and Stripe **test** keys (`REHEARSAL_STRIPE_*`).
