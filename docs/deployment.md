# Deployment

Jam Gym is a static site served from a small Docker container on the **same server as eardle**, at
**https://jam-gym.eardle.com**. It follows eardle's conventions (see `~/drorbo/eardle/docs/deployment.md`).

## How it runs

```
browser ─► Cloudflare ─► host nginx (TLS, hostname) ─► 127.0.0.1:3100 ─► jam-gym-web-1 (nginx:alpine, static files)
```

- **Server**: `57.129.12.248`, user `ubuntu`, reached with the `eardle-prod` SSH alias (same key as eardle).
- **Code on the server**: `~/drorbo/jam-gym` (`/home/ubuntu/drorbo/jam-gym`), tracking `main` of
  `https://github.com/drorbo/jam-gym` (a public repo, so no credentials are needed on the server).
- **Runtime**: Docker Compose project `jam-gym` with one service, `web` (container `jam-gym-web-1`), published on
  **127.0.0.1:3100** only. It is a separate project from eardle (`eardle-app-1` on 3000, `eardle-db-1`), with its own
  image and network. There is no database and no secrets.
- **Limits**: the container is capped at 64 MB of RAM so it can never crowd out eardle.
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
