# 8. Security posture

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

- **Firewall has two layers and two address families.** `ufw` allows 22/80/443. Docker bypasses `ufw`, so
  `/usr/local/sbin/docker-user-fw.sh` (systemd `docker-user-fw`) puts the rule in the `DOCKER-USER` chain for
  **both `iptables` and `ip6tables`**: only 80/443 reach containers from the public interface. Never publish a
  port you do not mean to. After any firewall change, probe the IPv4 **and** IPv6 address from outside — an
  IPv6 gap once exposed the Coolify login.
- **Mail pass-through (2026-10-14):** `ufw` also allows 993 and 995, served by `mail-forward@993/995.service` (socat to
  `mail.fonology.co.uk` on the TMD host) so mail apps still set to `fonology.co.uk` can read mail. Sending (465/587) cannot be
  forwarded: the VPS provider blocks outbound SMTP. Those apps must use `mail.fonology.co.uk` for outgoing mail.
- **SSH:** keys only, `MaxAuthTries 3`, no X11. fail2ban on. Keep a second SSH session open while changing SSH.
- **Coolify:** registration off, dashboard private, **2FA on the admin**, auto-update off, delete unused API tokens.
- **Postgres:** scram-sha-256, `fonology_api` has no DDL, row-level security forced on all tables, the API role
  has statement/lock/idle-in-transaction timeouts. Postgres image must be `postgres:17` (Debian), **not alpine**
  — alpine sorts text by raw bytes and every `ORDER BY name` changes.
- **Files:** only `product-images` is public; `id-documents` and `buy-in-forms` are reached through 60-second signed links.
- **Auth:** the API's own sessions (argon2id, httpOnly `fnl_session` cookie, 30-day sliding), PIN lock at the till
  with an idle auto-lock; a locked session cannot write — including from the storefront in the same browser.
- **Rotate before production:** the Backblaze key must become a key limited to the one bucket; rotate the Coolify
  API token; remove staging webhooks and test keys. Treat any secret that appeared in chat or a screenshot as leaked.
- **The repo is public** and `deploy/shop-setup.json` holds owner details: decide on private, and turn on branch protection.
