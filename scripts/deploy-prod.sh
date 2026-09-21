#!/usr/bin/env bash
# Deploy the current `main` branch of Jam Gym to the production server and verify it's live.
#
# Usage: bash scripts/deploy-prod.sh
#
# Prerequisites (see docs/deployment.md):
#   - `main` on GitHub already has the changes you want live (git push origin main);
#     this script does not push anything.
#   - SSH access configured as the `eardle-prod` host alias in ~/.ssh/config. Jam Gym shares the
#     eardle server, so it uses the same alias and key.
#   - First-time setup on the server (clone, nginx site) done once, per docs/deployment.md.
#
# This script only touches ~/drorbo/jam-gym and the `jam-gym` Compose project. It never runs a
# command that could affect eardle's containers, and it contains no credentials.

set -euo pipefail

REMOTE_DIR="~/drorbo/jam-gym"
SSH_HOST="eardle-prod"
COMPOSE="docker compose -f docker-compose.yml"

echo "==> Pulling latest main on the server"
ssh "$SSH_HOST" "cd $REMOTE_DIR && git pull --ff-only origin main"

echo "==> Rebuilding the image"
ssh "$SSH_HOST" "cd $REMOTE_DIR && $COMPOSE build web"

echo "==> Recreating the container"
ssh "$SSH_HOST" "cd $REMOTE_DIR && $COMPOSE up -d web"

echo "==> Waiting for startup"
sleep 4

echo "==> Container status"
ssh "$SSH_HOST" "cd $REMOTE_DIR && $COMPOSE ps"

echo "==> Recent logs"
ssh "$SSH_HOST" "docker logs jam-gym-web-1 --tail 10"

echo "==> Verifying the public site"
curl -s -o /dev/null -w 'jam-gym home:      %{http_code}\n' https://jam-gym.eardle.com/
curl -s -o /dev/null -w 'jam-gym manifest:  %{http_code}\n' https://jam-gym.eardle.com/samples/manifest.json
curl -s -o /dev/null -w 'eardle (unchanged): %{http_code}\n' https://eardle.com/

echo "==> Deploy complete"
