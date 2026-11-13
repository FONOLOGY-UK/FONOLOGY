# 2. Getting in (operator)

Part of the Fonology manual. The index and the everyday rules are in [`CLAUDE.md`](../CLAUDE.md); "section N" means the file numbered N in this folder, or that section of `CLAUDE.md`.

- **SSH:** key-only, user `deploy` (passwordless sudo). Root login is key-only and exists for Coolify. Keep the
  private key private; losing it means rebuilding access through the netcup panel.
- **Coolify dashboard** is not public. Open an SSH tunnel and browse to it:
  `ssh -N -L 8000:localhost:8000 deploy@<server>` then `http://localhost:8000`.
- **Coolify API** (through the same tunnel): `http://localhost:8000/api/v1`, bearer token kept in a gitignored
  file on the operator PC. Deploys are **POST** `/deploy?uuid=<app>&force=true` (GET is refused).
- **netcup panels** (customer panel and server panel) hold billing, snapshots and the firewall. Turn on 2FA.
- Secrets that must exist off the server: Coolify's `/data/coolify/source/.env`, the database passwords, the
  Stripe and Brevo keys, the Backblaze key. If the server dies without them, recovery is much harder.
