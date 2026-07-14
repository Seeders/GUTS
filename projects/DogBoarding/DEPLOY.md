# Deploying DogBoarding

This app is hosted by the GUTS **root server** (`node server.js` from the repo
root), which serves every project plus the editor on one port. The database and
uploaded vet records live in `projects/DogBoarding/secure/`, which is gitignored
and never served as a static file.

Target: a **DigitalOcean Droplet** (a plain Linux VM with a real disk). Do **not**
use App Platform — its filesystem is ephemeral and would destroy the database and
every uploaded vet record on each deploy/restart. SQLite needs a disk that
persists.

```
Browser --HTTPS:443--> Caddy (TLS) --HTTP:8080 localhost--> node server.js
                                                                  |
                                                    projects/DogBoarding/secure/  <- on a mounted volume
```

---

## 0. Before you start

You need:

- A DigitalOcean Droplet (Ubuntu 24.04, the cheapest shared-CPU size is plenty).
- A **domain name** pointed at the Droplet's public IP (an `A` record). TLS
  certificates cannot be issued for a bare IP address.
- SSH access to the Droplet.

All commands below run **on the Droplet** as a user with `sudo`, unless noted.

---

## 1. Install Node 22+

The app uses `node:sqlite`, which is built into Node 22 — no native build, no
`npm install` of a database driver. Ubuntu's default Node is too old, so use
NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # must print v22.x or newer
```

---

## 2. Get the code

```bash
sudo mkdir -p /opt/guts
sudo chown $USER:$USER /opt/guts
git clone <your-repo-url> /opt/guts
cd /opt/guts
git checkout <branch-with-dogboarding>   # e.g. worktree-dogboard, or main once merged
npm install                               # installs express, multer, socket.io, etc.
npm run build DogBoarding                 # builds projects/DogBoarding/dist/client/game.js
```

> The client bundle (`dist/`) must be built on the server (or committed) — a fresh
> clone does not include it.

---

## 3. Create a persistent volume for private data

`secure/` holds the database and the uploaded vet records (client home addresses
and phone numbers). Put it on a DigitalOcean **Block Storage volume** so it
survives redeploys and gets snapshotted independently of the code.

In the DigitalOcean console: create a Volume, attach it to the Droplet. It appears
as a disk you mount once:

```bash
# one-time: format and mount (use the device path DO shows you, e.g. /dev/sda)
sudo mkfs.ext4 -F /dev/disk/by-id/scsi-0DO_Volume_dogboard
sudo mkdir -p /mnt/dogboard
sudo mount -o discard,defaults /dev/disk/by-id/scsi-0DO_Volume_dogboard /mnt/dogboard
sudo chown $USER:$USER /mnt/dogboard

# make it remount on reboot
echo '/dev/disk/by-id/scsi-0DO_Volume_dogboard /mnt/dogboard ext4 defaults,nofail,discard 0 0' \
  | sudo tee -a /etc/fstab
```

The app points at this via the `GUTS_SECURE_DIR` environment variable (set in the
systemd unit below). The database file and an `uploads/` subfolder are created
inside it automatically on first boot.

---

## 4. Choose passwords

Two independent secrets, both set as environment variables:

| Variable | Guards | Notes |
|----------|--------|-------|
| `GUTS_EDITOR_PASSWORD` | The GUTS editor and its file endpoints | The editor can read/write any file on the box, including `secure/`. Treat this like root. |
| `DOGBOARD_ADMIN_PASSWORD` | The DogBoarding back-office login | The staff password. Set on first boot; changeable later in the app. |

Generate strong ones:

```bash
openssl rand -base64 24    # run twice, one per password
```

---

## 5. Run it as a service (systemd)

So it starts on boot and restarts if it crashes. Create
`/etc/systemd/system/guts.service`:

```ini
[Unit]
Description=GUTS server (hosts DogBoarding)
After=network.target

[Service]
Type=simple
User=guts
WorkingDirectory=/opt/guts
ExecStart=/usr/bin/node server.js 8080 --prod
Restart=on-failure
RestartSec=3

# Private data on the mounted volume
Environment=GUTS_SECURE_DIR=/mnt/dogboard
# Secrets — or better, put them in an EnvironmentFile with 600 perms (see note)
Environment=GUTS_EDITOR_PASSWORD=REPLACE_ME
Environment=DOGBOARD_ADMIN_PASSWORD=REPLACE_ME

[Install]
WantedBy=multi-user.target
```

`--prod` matters: in production mode the editor **fails closed** — if
`GUTS_EDITOR_PASSWORD` were ever missing, the editor endpoints return 503 instead
of opening up.

> **Keep secrets out of the unit file:** put the two `Environment=` password lines
> in `/etc/guts.env` (`chmod 600`, `KEY=value` per line) and replace them with
> `EnvironmentFile=/etc/guts.env`. Then the unit file is safe to read/commit.

Enable and start:

```bash
sudo useradd --system --home /opt/guts guts 2>/dev/null || true
sudo chown -R guts:guts /opt/guts /mnt/dogboard
sudo systemctl daemon-reload
sudo systemctl enable --now guts
sudo systemctl status guts          # should be active (running)
journalctl -u guts -f               # watch logs; look for "[editor-auth] ... ON"
```

At this point the app is running on `localhost:8080` **but not reachable from the
internet yet** — that's the firewall + proxy's job next.

---

## 6. TLS + reverse proxy (Caddy)

Caddy terminates HTTPS and forwards plain HTTP to the app on localhost. It fetches
and renews a free Let's Encrypt certificate automatically.

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Write `/etc/caddy/Caddyfile` (replace the domain):

```
boarding.yourdomain.com {
    encode gzip

    # Defence in depth: never let private paths out, even if the app slips.
    @private path /projects/*/secure/* /uploads/* /projects/*/node_modules/*
    respond @private 403

    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy now serves `https://boarding.yourdomain.com`, redirects HTTP→HTTPS, and
renews the certificate on its own. The staff login, the admin password and the vet
records are encrypted in transit from here on.

---

## 7. Firewall

Expose only SSH and the web ports. Crucially, **do not** open 8080 — the app
should be reachable only through Caddy, never directly.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status          # 22, 80, 443 only
```

With 8080 closed at the firewall, the plain-HTTP app is reachable only from the
Droplet itself (where Caddy lives).

---

## 8. First run and demo/real data

On first boot the app creates an empty database in `/mnt/dogboard` and sets the
admin password from `DOGBOARD_ADMIN_PASSWORD`. To load the demo dataset instead of
starting empty:

```bash
cd /opt/guts
GUTS_SECURE_DIR=/mnt/dogboard node projects/DogBoarding/server/seed.js --wipe
```

`--wipe` clears existing rows first, so only run it on a fresh deploy — never
against live client data.

---

## 9. Backups — the file *is* the business

`secure/` is not in git, so git is **not** a backup. Two layers:

1. **Volume snapshots** — schedule automatic snapshots of the Block Storage volume
   in the DigitalOcean console. One-click, covers the DB and the uploaded records.
2. **Continuous replication (recommended)** — [Litestream](https://litestream.io)
   streams the SQLite file to DigitalOcean Spaces (S3-compatible) as it changes, so
   you can restore to any point in time. ~10 lines of config, runs as its own
   systemd service pointing at `/mnt/dogboard/dogboard.db`.

---

## 10. Keep the editor off the open internet

The editor password gates the editor, but the editor can read and write any file
on the box — it is effectively admin over the server. Even gated, prefer not to
expose it publicly:

- Restrict `/projects/Editor` and the editor endpoints to your own IP, or
- Put the editor behind a VPN (Tailscale/WireGuard) and only expose DogBoarding's
  public + admin routes.

The simplest allowlist, in the Caddyfile:

```
@editor path /projects/Editor* /save-file /save-compiled-game /read-file /read-files /delete-file /delete-folder /list-files /list-projects /load-project /save-project
@notme not remote_ip YOUR.HOME.IP.HERE
handle @editor {
    respond @notme 403
    reverse_proxy localhost:8080
}
```

---

## Updating a running deployment

```bash
cd /opt/guts
git pull
npm install
npm run build DogBoarding
sudo systemctl restart guts
```

The volume at `/mnt/dogboard` is untouched by this, so client data survives the
update.

---

## Online payments (Stripe)

Clients can pay an invoice from the portal via Stripe's hosted Checkout page. No
card data touches this server (lowest PCI tier). Payments are recorded by a
webhook, not the browser redirect, so a closed tab can't desync the books.

**Setup:**

1. In the Stripe dashboard, grab your API keys. Use **test** keys first
   (`sk_test_…`).
2. Add a **webhook endpoint** in Stripe → Developers → Webhooks, listening for
   `checkout.session.completed`, pointed at:
   ```
   https://<your-domain>/projects/DogBoarding/api/stripe/webhook
   ```
   Copy its signing secret (`whsec_…`).
3. Set these on the server (systemd `EnvironmentFile`, or `/etc/guts.env`):
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
   With no key set, the portal simply omits the "Pay" button and staff record
   payments by hand — nothing breaks.
4. Restart the service.

**Caddy note:** the webhook and the portal API live under `/api/…`. If you use
the clean-URL rewrite, make sure the reverse proxy forwards `/api/stripe/*` and
`/api/portal/*` to the app (add them alongside `/api/public/*` and `/api/admin/*`
in the rewrite matcher), or Stripe's POST will 404.

**Testing:** with test keys, pay with card `4242 4242 4242 4242`, any future
expiry, any CVC. The invoice should show `paid` a moment after the webhook fires.
