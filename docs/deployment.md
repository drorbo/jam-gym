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

One command does the whole path, from your working tree to a verified live site:

```bash
bash scripts/ship.sh -m "What changed and why"      # or: npm run ship -- -m "..."
```

In order, it: checks you are on `main` and up to date; **runs the tests and stops if any fail**; commits everything with
your message; pushes to GitHub; checks the server and the data volume; records eardle's state; deploys; waits for the
container to be healthy; then verifies the live site and that eardle is untouched. It ends with `Shipped <sha> in Ns`
or a list of what failed and the rollback command. A typical run takes about a minute.

| Command | What it does |
| --- | --- |
| `bash scripts/ship.sh -m "msg"` | test, commit all changes, push, deploy, verify. Repeat `-m` for more paragraphs (as with `git commit`). |
| `bash scripts/ship.sh` | the same for commits you already made (no `-m`; it refuses if the tree is dirty). |
| `bash scripts/ship.sh --dry-run -m "msg"` | print the plan and check the server, change nothing. |
| `bash scripts/ship.sh --skip-tests ...` | skip the tests. Only for changes that cannot affect code (docs, scripts). |
| `bash scripts/ship.sh --force` | rebuild even if the server already runs this commit. |
| `bash scripts/ship.sh --rollback <sha>` | put an earlier commit live (no tests, commit or push). The next normal ship returns to `main`. |
| `bash scripts/deploy-prod.sh [sha]` | only the deploy step (pull, build, recreate, wait for healthy), no tests, no push. |

**What the verification checks:** the home page and `/api/health` answer; the entry script is versioned and cached
immutably; the page carries its import map and a CSP header; server code is not reachable (`/server/config.js` is 404);
the sample manifest loads; eardle's home page and `/learn` still answer; the number of stored tracks did not drop; and
eardle's containers (ids and start times) and nginx config are identical to before the deploy. If any check fails the
script exits non-zero and prints `bash scripts/ship.sh --rollback <previous sha>`.

**A failing test blocks everything**, so nothing half-shipped ever reaches GitHub or the server. Nothing is deployed
when the server already runs the commit you are shipping.

Manual equivalent, if ever needed:

```bash
git push origin main
ssh eardle-prod "cd ~/drorbo/jam-gym && git pull --ff-only origin main"
ssh eardle-prod "cd ~/drorbo/jam-gym && docker compose -f docker-compose.yml up -d --build web"
ssh eardle-prod "docker logs jam-gym-web-1 --tail 15"
curl -s https://jam-gym.eardle.com/api/health
```

### Why script addresses carry a version

Cloudflare sits in front of the site and keeps `.js` and `.css` files in browsers for up to four hours, overriding the
`Cache-Control: no-cache` the server sends (it is a zone-wide setting shared with eardle, so it is not changed). After a
deploy, a returning visitor would get the new page with old scripts. So the server rewrites `index.html` when it starts:
the stylesheet and entry script get `?v=<content hash>`, and an import map gives every module the same, so a changed file
has a new address and can never be stale. An address with the file's current hash is cached for a year (`immutable`);
anything else revalidates. The CSP allows the import map by its hash. Nothing to do on your part: it follows from the
file contents (`server/static.js`, tested in `test/server-unit.test.js`). If you add a script that is not under `src/`
or a stylesheet not under `css/`, it will not be versioned.

## Backups and restoring

Users' tracks live in one SQLite file on the `jam-gym_data` volume. Three layers protect it:

1. **Every deploy takes a backup first** (`scripts/ship.sh`), copies it to `~/jam-gym-backups/` on the server host (outside
   the Docker volume, so it survives even if the volume is lost; the last 30 are kept), and afterwards checks that every
   track that existed before still exists. It compares the tracks themselves, not just the count.
2. **The server snapshots itself** at start-up and every six hours after (`BACKUP_EVERY_HOURS`), keeping the last 28 in
   `/data/backups`.
3. **A restart cannot lose committed data.** SQLite runs in WAL mode, and a manual check confirmed that saved tracks
   survive a hard kill, a stop signal and repeated restarts.

Nothing in the deploy touches the volume: it does `git pull`, `docker compose build web` and `docker compose up -d web`, never
`down -v`, `volume rm` or a prune. The one thing that would delete it is someone running `docker volume prune` (or
`docker system prune --volumes`) on the host, which is why the eardle heads-up file says never to.

**Restoring a backup** (this replaces the live database with the snapshot, so use the newest one that has what you need):

```bash
ssh eardle-prod
cd ~/drorbo/jam-gym
ls -lt ~/jam-gym-backups | head                       # pick a file, e.g. jamgym-20260921-1949.sqlite
docker compose -f docker-compose.yml stop web
# remove the old database and its write-ahead files from the volume, then put the snapshot in place
docker run --rm -v jam-gym_data:/data --entrypoint sh jam-gym-web -c 'rm -f /data/jamgym.sqlite /data/jamgym.sqlite-wal /data/jamgym.sqlite-shm'
docker cp ~/jam-gym-backups/jamgym-20260921-1949.sqlite jam-gym-web-1:/data/jamgym.sqlite
docker run --rm -v jam-gym_data:/data --entrypoint sh jam-gym-web -c 'chown node:node /data/jamgym.sqlite'
docker compose -f docker-compose.yml up -d web
docker exec jam-gym-web-1 node server/admin.js stats     # check the counts
```

The track-by-track check needs the `ids` admin command on the server that was running *before* the deploy. The first deploy that adds it prints a `note` and falls back to the count check; every deploy after that compares the tracks themselves.

To take a backup by hand at any time: `docker exec jam-gym-web-1 node server/admin.js backup`, then `docker cp` it out.

## Operating it

```bash
# health, and what is in the library
ssh eardle-prod "curl -s http://127.0.0.1:3100/api/health"
ssh eardle-prod "docker exec jam-gym-web-1 node server/admin.js stats"

# moderation: the reports queue, look at a track, hide / restore / delete it, ban or unban its author
ssh eardle-prod "docker exec jam-gym-web-1 node server/admin.js reports"
ssh eardle-prod "docker exec jam-gym-web-1 node server/admin.js hide TRACK_ID"
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

The image includes `samples/` (about 23 MB). Three of the six sources require attribution (the others are CC0, and are
credited anyway); it is shown in the site footer and in `samples/CREDITS.md`. Keep that when changing the footer.
