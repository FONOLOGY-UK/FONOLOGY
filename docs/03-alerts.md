# 3. Alerts and what to do

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

Everything posts to Discord. A day with **no** message from the nightly backup means the job did not run.

| Message                                                                    | From                | Meaning / first move                                                                                               |
| -------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ALERT … Website health / API readiness`                                   | server watchdog     | Site or API not answering from the server itself. See "Site is down".                                              |
| `SITE DOWN (seen from outside)`                                            | GitHub uptime check | Reachable check from the internet failed. If the watchdog is silent the whole server is down.                      |
| `ALERT … Disk is N percent full`                                           | server watchdog     | Over 80%. `docker builder prune -af --filter until=72h` (old build cache), then check logs and `docker system df`. |
| `ALERT … memory`, `Containers not running`                                 | server watchdog     | A container died or memory is under 400 MB. `docker ps -a`, `docker logs`, restart in Coolify.                     |
| `ALERT … Certificate … expires in N days`                                  | server watchdog     | Traefik renews at 30 days left. If it did not: DNS wrong, port 80 blocked, or Let's Encrypt limits.                |
| `ALERT … Postgres has N connections`                                       | server watchdog     | Over 80 of 100. Look for a stuck API pool; restart the API.                                                        |
| `Last Garage backup finished N hours ago`                                  | server watchdog     | Nightly photo/ID-document backup did not run. See "Backups".                                                       |
| `BACKUP PROBLEM … Garage to Backblaze`                                     | backup script       | A bucket failed, or Garage looked empty so the script refused to mirror emptiness.                                 |
| `SIMULATED FAILURE`                                                        | backup script       | A test of the alert path (`garage-backup.sh --simulate-failure`). Nothing is wrong.                                |
| Coolify messages (deploy / backup / task failed, disk, server unreachable) | Coolify             | Open Coolify, read the deployment or backup log.                                                                   |
| `RECOVERED …`                                                              | server watchdog     | The problem cleared by itself.                                                                                     |

How it is built (all on the server, run by systemd, root-only secrets in `/etc/fonology/`):

- `fonology-watchdog.timer` → `/usr/local/sbin/fonology-watchdog.sh` every 5 minutes. Settings in
  `/etc/fonology/watchdog.conf` (`WEB_URL`, `API_URL`, `CERT_HOSTS`) — **edit them at the domain cutover**.
  Self-test: `WATCHDOG_FORCE_DISK_PCT=99 /usr/local/sbin/fonology-watchdog.sh`, then run it again to see RECOVERED.
- `garage-backup.timer` → `/usr/local/sbin/garage-backup.sh` daily ~03:45 (server time, Europe/London).
- `.github/workflows/uptime.yml` calls the live site every 10 minutes from GitHub. Repo variables
  `UPTIME_WEB_URL` and `UPTIME_API_URL` and secret `DISCORD_WEBHOOK_URL` — **update the two variables at cutover**.
  Scheduled workflows only run from `main`.
- Coolify sends its own Discord alerts (Notifications → Discord). Coolify's nightly self-update is **off**; update
  it by hand after reading its release notes, never on a trading day.
