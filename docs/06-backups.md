# 6. Backups and restore

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

| What                                                | How                                                                                   | Where / how long                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Postgres `fonology`                                 | Coolify scheduled backup, daily 02:00 UTC                                             | Backblaze, 30 kept; 3 on the server                                                      |
| Garage buckets (photos, ID documents, buy-in forms) | `garage-backup.sh` nightly, `rclone sync`                                             | Backblaze `garage/<bucket>`; deletions mirrored, deleted files kept 30 days then removed |
| Coolify's own configuration                         | `coolify-config-backup.sh` nightly 03:55: Coolify's database + `/data/coolify/source` | Backblaze `coolify/`, 30 days; the archive holds secrets, keep a copy of `.env` too      |

The B2 bucket has encryption on and a 30-day clean-up rule for `garage/`. Purged ID documents must not live in
backups forever — that is why deletions are mirrored.

**Restore the database** (practise on a scratch database first):

```bash
# 1. fetch the newest dump from Backblaze (Coolify → postgres → Backups → download, or the B2 console)
# 2. restore into a scratch database and compare
docker cp dump.dmp <postgres-container>:/tmp/dump.dmp
docker exec <postgres-container> psql -U postgres -c "create database scratch"
docker exec <postgres-container> pg_restore -U postgres -d scratch --no-owner /tmp/dump.dmp
# compare counts of sales, sale_payments, orders, jobs, products against fonology, then drop scratch
# 3. real disaster: stop the API, drop and recreate fonology, pg_restore into it, run the migrations
#    (MIGRATE_DATABASE_URL deploy) so roles exist, start the API
```

**Restore photos/documents:** run rclone in a container on the Docker network with the credentials file:
`docker run --rm --network coolify --env-file /etc/fonology/rclone.env rclone/rclone:1.68 copy b2:fonology-backups/garage/product-images garage:product-images`
(repeat for `id-documents`, `buy-in-forms`).

**Whole server lost:** order a new VPS, harden it (section 8), install Coolify, restore `/data/coolify/source/.env`,
recreate the four resources, apply env vars (section 7), migrate, restore the database and Garage, repoint DNS.
