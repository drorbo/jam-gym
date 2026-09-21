#!/usr/bin/env bash
# Deploy Jam Gym to the production server and wait until it is healthy.
#
# Usage:
#   bash scripts/deploy-prod.sh            deploy the current `main` from GitHub
#   bash scripts/deploy-prod.sh <sha>      deploy a specific commit (a rollback); the next plain deploy returns to main
#
# Most of the time use `bash scripts/ship.sh` instead: it runs the tests, commits, pushes, calls this, and then
# proves that eardle was not touched. This script alone does not push anything.
#
# Prerequisites (see docs/deployment.md):
#   - the commit you want live is already on GitHub (git push origin main)
#   - SSH access as the `eardle-prod` host alias in ~/.ssh/config (Jam Gym shares eardle's server and key)
#   - first-time setup on the server (clone, nginx site) done once
#
# It only touches ~/drorbo/jam-gym and the `jam-gym` Compose project (its container, its image and the
# `jam-gym_data` volume, which holds users' tracks and is kept by `up -d`). It never runs a command that could affect
# eardle's containers, and it contains no credentials.

set -euo pipefail

REF="${1:-main}"
REMOTE_DIR="~/drorbo/jam-gym"
SSH_HOST="eardle-prod"
COMPOSE="docker compose -f docker-compose.yml"
CONTAINER="jam-gym-web-1"

echo "==> Getting ${REF} on the server"
if [ "$REF" = "main" ]; then
  ssh "$SSH_HOST" "cd $REMOTE_DIR && git checkout -q main && git pull --ff-only origin main"
else
  ssh "$SSH_HOST" "cd $REMOTE_DIR && git fetch -q origin && git checkout -q --detach $REF"
fi
ssh "$SSH_HOST" "cd $REMOTE_DIR && git log -1 --format='    now at %h  %s'"

echo "==> Rebuilding the image"
ssh "$SSH_HOST" "cd $REMOTE_DIR && $COMPOSE build web 2>&1 | tail -3"

echo "==> Recreating the container"
ssh "$SSH_HOST" "cd $REMOTE_DIR && $COMPOSE up -d web 2>&1 | tail -3"

echo "==> Waiting for it to be healthy (up to 60 s)"
status="starting"
for _ in $(seq 1 30); do
  status="$(ssh "$SSH_HOST" "docker inspect -f '{{.State.Health.Status}}' $CONTAINER 2>/dev/null" || echo missing)"
  [ "$status" = "healthy" ] && break
  sleep 2
done
if [ "$status" != "healthy" ]; then
  echo "!! The container is '$status', not healthy. Last log lines:"
  ssh "$SSH_HOST" "docker logs $CONTAINER --tail 25 2>&1" || true
  echo "!! To go back: bash scripts/deploy-prod.sh <the previous sha>   (see: ssh $SSH_HOST 'cd $REMOTE_DIR && git reflog -5')"
  exit 1
fi
echo "    healthy"
ssh "$SSH_HOST" "docker logs $CONTAINER --tail 3 2>&1"

echo "==> Public checks (000 means not reachable, e.g. DNS or nginx)"
curl -s -o /dev/null -w 'jam-gym home:       %{http_code}\n' https://jam-gym.eardle.com/ || true
curl -s -o /dev/null -w 'jam-gym api health: %{http_code}\n' https://jam-gym.eardle.com/api/health || true
curl -s -o /dev/null -w 'eardle (unchanged): %{http_code}\n' https://eardle.com/ || true

echo "==> Deploy complete"
