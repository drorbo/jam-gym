# Deployment

Jam Gym is a small Node app (the site plus a tracks API, SQLite for data) in a Docker container on the **same server as eardle**, at
**https://jam-gym.eardle.com**. It follows eardle's conventions (see `~/drorbo/eardle/docs/deployment.md`).

## How it runs

```
browser ─► Cloudflare ─► host nginx (TLS, hostname) ─► 127.0.0.1:3100 ─► jam-gym-web-1 (node:24-alpine, port 8080 inside)
```

- **Server**: `57.129.12.248`, user `ubuntu`, reached with the `eardle-prod` SSH alias (same key as eardle).
- **Code on the server**: `~/drorbo/jam-gym` (`/home/ubuntu/drorbo/jam-gym`), tracking `main` of
  `https://github.com/drorbo/jam-gym` (a public repo, so no credentials are needed on the server).
- **Runtime**: Docker Compose project `jam-gym` with one service, `web` (container `jam-gym-web-1`), published on
  **127.0.0.1:3100** only. It is a separate project from eardle (`eardle-app-1` on 3000, `eardle-db-1`), with its own
  image, network and volume. There are no secrets and no separate database server.
- **Data**: the named volume **`jam-gym_data`**, mounted at `/data`, holds the SQLite database (`jamgym.sqlite`) and daily
  backups (`backups/`, last 14). It survives rebuilds and `up -d`. **Never run `docker volume prune` or
  `docker system prune --volumes` on this host**: they can delete it, and with it every user's tracks and likes.
- **Limits**: the container is capped at 192 MB of RAM so it can never crowd out eardle.
- **Host nginx**: `/etc/nginx/sites-available/jam-gym.eardle.com.conf` (symlinked into `sites-enabled`), a separate
  file from eardle's. The source of truth is `deploy/host-nginx/jam-gym.eardle.com.conf` in this repo.
- **TLS**: reuses eardle's Cloudflare Origin certificate at `/etc/nginx/ssl/eardle.com/`, which is a wildcard
  (`*.eardle.com`). Nothing new to issue or renew. Cloudflare's SSL/TLS mode should be "Full" or "Full (strict)".
- **DNS**: a Cloudflare record for `jam-gym.eardle.com` pointing at the server.

## Shipping a change

```bash
git push origin main
bash scripts/deploy-prod.sh
```

The script pulls on the server, rebuilds the image, recreates the container, and checks the public URLs (including
that eardle still answers). Always use `docker compose -f docker-compose.yml` on the server.

Manual equivalent:

```bash
ssh eardle-prod "cd ~/drorbo/jam-gym && git pull --ff-only origin main"
ssh eardle-prod "cd ~/drorbo/jam-gym && docker compose -f docker-compose.yml build web"
ssh eardle-prod "cd ~/drorbo/jam-gym && docker compose -f docker-compose.yml up -d web"
ssh eardle-prod "docker logs jam-gym-web-1 --tail 15"
curl -s -o /dev/null -w '%{http_code}\n' https://jam-gym.eardle.com/
```

## Operating it

```bash
# health, and what is in the library
ssh eardle-prod "curl -s http://127.0.0.1:3100/api/health"
ssh eardle-prod "docker exec jam-gym-web-1 node server/admin.js stats"

# moderation: reports queue, look at a track, hide / restore / delete it, ban or unban its author
ssh eardle-prod "docker exec jam-gym-web-1 node server/admin.js reports"
ssh eardle-prod "docker exec jam-gym-web-1 node server/admin.js hide TRACK_ID"

# take a backup now, then copy it off the server
ssh eardle-prod "docker exec jam-gym-web-1 node server/admin.js backup"
ssh eardle-prod "docker cp jam-gym-web-1:/data/backups ~/jam-gym-backups"
```

Environment (set in `docker-compose.yml`): `TRUST_PROXY=1` (believe the host nginx's `X-Forwarded-Proto` and Cloudflare's
client IP, which is safe only because the port is published on loopback), `BACKUPS=1`, `DATA_DIR=/data`.
The server sends a Content-Security-Policy and refuses cross-site writes, so nginx needs no extra headers.

## First-time setup (already done once)

```bash
ssh eardle-prod "mkdir -p ~/drorbo && cd ~/drorbo && git clone https://github.com/drorbo/jam-gym.git"
ssh eardle-prod "cd ~/drorbo/jam-gym && docker compose -f docker-compose.yml up -d --build"

# nginx: add a NEW site file. Do not edit eardle's.
ssh eardle-prod "sudo cp ~/drorbo/jam-gym/deploy/host-nginx/jam-gym.eardle.com.conf /etc/nginx/sites-available/ \
  && sudo ln -s /etc/nginx/sites-available/jam-gym.eardle.com.conf /etc/nginx/sites-enabled/jam-gym.eardle.com.conf \
  && sudo nginx -t && sudo systemctl reload nginx"
```

`nginx -t` must pass before reloading: nginx is shared with eardle, and a broken config would take both sites down.
If a config change ever needs undoing, remove the `sites-enabled` symlink, run `sudo nginx -t`, then reload.

Then add the DNS record for `jam-gym.eardle.com`.

## Updating the nginx config

Edit `deploy/host-nginx/jam-gym.eardle.com.conf`, push, pull on the server, copy it over
`/etc/nginx/sites-available/jam-gym.eardle.com.conf`, then `sudo nginx -t && sudo systemctl reload nginx`.

## Recorded sounds and licences

The image includes `samples/` (about 13 MB). Three of the four sources require attribution; it is shown in the site
footer and in `samples/CREDITS.md`. Keep that when changing the footer.
