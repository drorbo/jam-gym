#!/usr/bin/env bash
# One-time (and safe to repeat) setup of "Sign in with eardle" on the production server: makes the secret that eardle and
# Jam Gym share and puts it in both apps' `.env` files on the server. It never prints the secret and never commits it.
#
# Usage:
#   bash scripts/setup-eardle-sso.sh            create or repair the shared secret (does nothing if both already agree)
#   bash scripts/setup-eardle-sso.sh --status   only report whether the two files agree
#
# Afterwards, deploy in this order (see docs/eardle-accounts.md):
#   1. eardle first:   in the eardle repo, `bash scripts/deploy-prod.sh`   (it picks up JAMGYM_SSO_SECRET)
#   2. Jam Gym next:   here, `bash scripts/ship.sh`                        (it picks up EARDLE_SSO_SECRET)
#
# The secret lives in:
#   ~/drorbo/eardle/.env    as JAMGYM_SSO_SECRET   (read by eardle's docker-compose.yml)
#   ~/drorbo/jam-gym/.env   as EARDLE_SSO_SECRET   (read by Jam Gym's docker-compose.yml)
# Needs SSH access as the `eardle-prod` host alias, like every other script here. Both files are backed up (.bak-<time>) before a change.

set -euo pipefail

SSH_HOST="${SSH_HOST:-eardle-prod}"
MODE="setup"
[ "${1:-}" = "--status" ] && MODE="status"

ssh "$SSH_HOST" MODE="$MODE" bash -s <<'REMOTE'
set -euo pipefail
EARDLE_ENV="$HOME/drorbo/eardle/.env"
JAM_ENV="$HOME/drorbo/jam-gym/.env"

get() { # file key: the value, or nothing
  if [ -f "$1" ]; then grep -E "^$2=" "$1" | tail -n 1 | cut -d= -f2- || true; fi
}
put() { # file key value
  if [ -f "$1" ]; then cp -p "$1" "$1.bak-$(date +%Y%m%d-%H%M%S)"; else touch "$1"; fi
  chmod 600 "$1"
  if grep -qE "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else printf '%s=%s\n' "$2" "$3" >> "$1"; fi
}

A="$(get "$EARDLE_ENV" JAMGYM_SSO_SECRET)"
B="$(get "$JAM_ENV" EARDLE_SSO_SECRET)"

if [ -n "$A" ] && [ "$A" = "$B" ]; then
  echo "ok: eardle and Jam Gym already share a secret (${#A} characters, not shown)."
  exit 0
fi
if [ "$MODE" = "status" ]; then
  echo "not set up: eardle has ${#A} characters, Jam Gym has ${#B}, and they differ or one is missing."
  exit 1
fi

[ -d "$HOME/drorbo/eardle" ] && [ -d "$HOME/drorbo/jam-gym" ] || { echo "FAIL: expected ~/drorbo/eardle and ~/drorbo/jam-gym on the server."; exit 1; }
SECRET="${A:-${B:-$(openssl rand -hex 32)}}" # keep whichever side already has one, so a half-done setup is completed, not replaced
put "$EARDLE_ENV" JAMGYM_SSO_SECRET "$SECRET"
put "$JAM_ENV" EARDLE_SSO_SECRET "$SECRET"
[ "$(get "$EARDLE_ENV" JAMGYM_SSO_SECRET)" = "$(get "$JAM_ENV" EARDLE_SSO_SECRET)" ] || { echo "FAIL: the two files disagree after writing."; exit 1; }
echo "done: the shared secret is in both .env files (${#SECRET} characters, not shown)."
echo "next: deploy eardle first (its scripts/deploy-prod.sh), then Jam Gym (bash scripts/ship.sh)."
REMOTE
