# 4. Routine maintenance

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

**Daily (30 seconds):** the "Garage backup OK" message arrived; no red alerts.

**Weekly:**

- Coolify → each resource healthy; `apt list --upgradable` on the server (security updates install themselves;
  `/var/run/reboot-required` means schedule a reboot out of hours — the watchdog tells you).
- Skim `docker logs --since 7d` for the API and web for repeated errors.
- Disk: `df -h /` and `docker system df`. Prune old build cache if over 60%.
- Admin → Logs and Reports look sane (no negative drawer, no stuck print jobs).

**Monthly:**

- **Restore drill** (section 6). A backup you have not restored is a hope, not a backup.
- Review who has access: Coolify users and API tokens, GitHub collaborators, Stripe and Brevo team members,
  admin staff accounts. Delete anything unused.
- Check certificate dates for every hostname and that fail2ban is running.
- Update Node/OS images only after reading advisories; run `pnpm audit --prod`.

**Before every deploy:** is a migration involved (section 5)? Is it a trading hour? Is a backup less than a day
old? After: `scripts/go-live-check.mjs` against the live URLs (`WEB_URL`, `API_URL`, `STORAGE_URL`, `S3_URL`).
It also trips the staff-login rate limit for the machine running it on purpose — run it last.
