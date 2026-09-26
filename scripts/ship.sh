#!/usr/bin/env bash
# Ship: tests -> commit -> push -> deploy -> verify, in one command.
#
#   bash scripts/ship.sh -m "What changed and why"      commit everything, then ship it
#   bash scripts/ship.sh                                ship commits that are already made
#   bash scripts/ship.sh --dry-run -m "..."             show what would happen, change nothing
#   bash scripts/ship.sh --rollback <sha>               put an earlier commit back live
#
# Options
#   -m "text"        commit message (repeat -m for more paragraphs, exactly like `git commit`)
#   --skip-tests     do not run `node --test` first (only for a change that cannot affect code, such as docs)
#   --force          deploy even if the server already runs this commit
#   --dry-run        print the plan and stop
#   --rollback SHA   deploy that commit instead (skips tests, commit and push)
#
# What it guarantees
#   * Nothing is committed, pushed or deployed unless all tests pass.
#   * It never runs a command that could touch eardle. Before and after, it records eardle's containers (id and start
#     time) and nginx config, and it fails loudly if any of them changed.
#   * The tracks data volume (jam-gym_data) is checked and kept. Before deploying it takes a backup and copies it to
#     ~/jam-gym-backups on the server (outside the volume); afterwards it checks that every track that existed before
#     still exists, not just that the count is the same.
#
# See docs/deployment.md. Needs: git, node, ssh access as `eardle-prod`, curl.

set -euo pipefail

SSH_HOST="eardle-prod"
REMOTE_DIR="~/drorbo/jam-gym"
SITE="https://jam-gym.eardle.com"
EARDLE="https://eardle.com"
cd "$(dirname "$0")/.."

MESSAGES=()
SKIP_TESTS=0
FORCE=0
DRY=0
ROLLBACK=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) [ $# -ge 2 ] || { echo "-m needs a message"; exit 2; }; MESSAGES+=("$2"); shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --rollback) [ $# -ge 2 ] || { echo "--rollback needs a commit sha"; exit 2; }; ROLLBACK="$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
done

START=$(date +%s)
step() { echo; echo "==> $*"; }
fail() { echo; echo "!! $*"; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "    [dry run] $*"; else "$@"; fi; }

# What eardle looks like right now: container ids and start times, and its nginx config. Compared before and after.
eardle_snapshot() {
  ssh -o ConnectTimeout=20 "$SSH_HOST" '
    docker ps --filter name=eardle --format "{{.Names}}" | sort | while read -r n; do
      docker inspect -f "{{.Name}} {{.Id}} started={{.State.StartedAt}} restarts={{.RestartCount}}" "$n"
    done
    md5sum /etc/nginx/sites-available/eardle.com.conf /etc/nginx/sites-enabled/eardle.com.conf 2>/dev/null
  '
}

# ---- rollback: a shortcut that skips everything but the deploy --------------------------------------------------
if [ -n "$ROLLBACK" ]; then
  step "Rolling back to $ROLLBACK"
  BEFORE="$(eardle_snapshot)"
  run bash scripts/deploy-prod.sh "$ROLLBACK"
  [ "$DRY" = 1 ] && exit 0
  AFTER="$(eardle_snapshot)"
  [ "$BEFORE" = "$AFTER" ] && echo "    eardle untouched" || fail "eardle's containers or nginx config changed during the rollback:
--- before
$BEFORE
--- after
$AFTER"
  echo "    Live again at $ROLLBACK. The next normal ship returns the server to main."
  exit 0
fi

# ---- 1. what is going to be shipped ---------------------------------------------------------------------------------
step "Checking the working tree"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || fail "You are on '$BRANCH'. Ship from main (git switch main)."
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  [ ${#MESSAGES[@]} -gt 0 ] || fail "There are uncommitted changes. Pass -m \"message\" to commit them, or commit them yourself first:
$(echo "$DIRTY" | head -15)"
  echo "$DIRTY" | head -20
  [ "$(echo "$DIRTY" | wc -l)" -gt 20 ] && echo "    ... and more"
else
  [ ${#MESSAGES[@]} -eq 0 ] || echo "    (nothing to commit; -m is ignored)"
fi
git fetch -q origin main
BEHIND="$(git rev-list --count HEAD..origin/main)"
[ "$BEHIND" = 0 ] || fail "origin/main has $BEHIND commit(s) you do not have. Run: git pull --rebase origin main"

# ---- 2. tests ---------------------------------------------------------------------------------------------------------
if [ "$SKIP_TESTS" = 1 ]; then
  step "Skipping tests (--skip-tests)"
else
  step "Running the tests"
  if [ "$DRY" = 1 ]; then
    echo "    [dry run] node --test"
  else
    LOG="$(mktemp)"
    if node --test >"$LOG" 2>&1; then
      grep -E "^ℹ (tests|pass|fail)" "$LOG" | sed 's/^/    /'
    else
      grep -E "✖|^ℹ (tests|pass|fail)|Error|expected|actual" "$LOG" | head -40
      rm -f "$LOG"
      fail "Tests failed, so nothing was committed, pushed or deployed."
    fi
    rm -f "$LOG"
  fi
fi

# ---- 3. commit and push -----------------------------------------------------------------------------------------------
if [ -n "$DIRTY" ]; then
  step "Committing"
  ARGS=()
  for m in "${MESSAGES[@]}"; do ARGS+=(-m "$m"); done
  run git add -A
  run git commit -q "${ARGS[@]}"
fi
SHA="$(git rev-parse --short HEAD)"
git log -1 --format='    %h  %s'

step "Pushing to GitHub"
if [ "$(git rev-list --count origin/main..HEAD)" = 0 ]; then
  echo "    already on GitHub"
else
  run git push -q origin HEAD:main
fi

# ---- 4. is there anything to deploy? -----------------------------------------------------------------------------------
step "Checking the server"
LIVE="$(ssh -o ConnectTimeout=20 "$SSH_HOST" "cd $REMOTE_DIR && git rev-parse --short HEAD")"
echo "    server is at $LIVE, shipping $SHA"
if [ "$LIVE" = "$SHA" ] && [ "$FORCE" = 0 ] && { [ "$DRY" = 0 ] || [ -z "$DIRTY" ]; }; then
  echo "    Already deployed. Nothing to do (use --force to rebuild anyway)."
  exit 0
fi
VOLUME="$(ssh "$SSH_HOST" "docker volume ls -q --filter name=jam-gym_data")"
[ "$VOLUME" = "jam-gym_data" ] || fail "The data volume jam-gym_data was not found on the server. Stopping before anything is rebuilt."
echo "    data volume jam-gym_data present"
STATS_BEFORE="$(ssh "$SSH_HOST" "docker exec jam-gym-web-1 node server/admin.js stats" | tr -d '\n ')"
echo "    library before: $STATS_BEFORE"

if [ "$DRY" = 1 ]; then
  step "Dry run: would now record eardle's state, deploy $SHA, and verify. Stopping here."
  exit 0
fi

# ---- 5. back up the library, then deploy ---------------------------------------------------------------------------------
# A snapshot taken by hand right before the deploy, plus a copy outside the Docker volume (so it survives even if the
# volume itself is ever lost), and the id of every track, to compare against afterwards.
step "Backing up the library first"
IDS_PATTERN='^[0-9A-Za-z]{10}$'
BACKUP="$(ssh "$SSH_HOST" "docker exec jam-gym-web-1 node --no-warnings server/admin.js backup" | sed 's#.*/##')"
[ -n "$BACKUP" ] || fail "Could not take a backup, so nothing was deployed."
ssh "$SSH_HOST" "mkdir -p ~/jam-gym-backups && docker cp jam-gym-web-1:/data/backups/$BACKUP ~/jam-gym-backups/$BACKUP && ls -1t ~/jam-gym-backups | tail -n +31 | while read -r f; do rm -f \"\$HOME/jam-gym-backups/\$f\"; done" \
  || fail "Could not copy the backup off the volume, so nothing was deployed."
echo "    $BACKUP (copied to ~/jam-gym-backups on the server, outside the Docker volume)"
IDS_BEFORE="$(ssh "$SSH_HOST" "docker exec jam-gym-web-1 node --no-warnings server/admin.js ids" 2>/dev/null | grep -E "$IDS_PATTERN" || true)"

EARDLE_BEFORE="$(eardle_snapshot)"
step "Deploying $SHA"
bash scripts/deploy-prod.sh

# ---- 6. verify ------------------------------------------------------------------------------------------------------------
step "Verifying the live site"
PROBLEMS=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "    ok    $1"; else echo "    FAIL  $1: got '$2', wanted '$3'"; PROBLEMS=$((PROBLEMS + 1)); fi
}
HTML="$(curl -s "$SITE/")"
check "home page answers" "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/")" 200
SCHEMA="$(node --input-type=module -e "import('./server/db.js').then((m) => console.log(m.SCHEMA_VERSION))")" # the version this code declares
check "api health" "$(curl -s "$SITE/api/health" | tr -d ' ')" "{\"ok\":true,\"schema\":$SCHEMA}"
ENTRY="$(echo "$HTML" | grep -o 'src/app/main.js?v=[0-9a-f]*' | head -1)"
if [ -n "$ENTRY" ]; then
  check "entry script is versioned and cached for good" "$(curl -sI "$SITE/$ENTRY" | tr -d '\r' | grep -ci 'immutable')" 1
else
  echo "    FAIL  the page has no versioned entry script"; PROBLEMS=$((PROBLEMS + 1))
fi
check "import map in the page" "$(echo "$HTML" | grep -c 'type="importmap"')" 1
check "CSP header present" "$(curl -sI "$SITE/" | tr -d '\r' | grep -ci '^content-security-policy')" 1
check "server code is not exposed" "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/server/config.js")" 404
check "sample manifest" "$(curl -s -o /dev/null -w '%{http_code}' "$SITE/samples/manifest.json")" 200
check "eardle home" "$(curl -s -o /dev/null -w '%{http_code}' "$EARDLE/")" 200
check "eardle /learn" "$(curl -s -o /dev/null -w '%{http_code}' "$EARDLE/learn")" 200
# "Sign in with eardle": if Jam Gym offers it, eardle must be answering its side (a redirect to sign in; 404 would mean eardle
# is not configured or not deployed yet: deploy eardle first, see docs/eardle-accounts.md)
if curl -s "$SITE/api/me" | grep -q '"features":{"eardle":true}'; then
  check "sign in with eardle: eardle answers /jam-gym/authorize" "$(curl -s -o /dev/null -w '%{http_code}' "$EARDLE/jam-gym/authorize?state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")" 307
fi

STATS_AFTER="$(ssh "$SSH_HOST" "docker exec jam-gym-web-1 node server/admin.js stats" | tr -d '\n ')"
echo "    library after:  $STATS_AFTER"
tracks_before="$(echo "$STATS_BEFORE" | grep -o '"tracks":[0-9]*' | cut -d: -f2)"
tracks_after="$(echo "$STATS_AFTER" | grep -o '"tracks":[0-9]*' | cut -d: -f2)"
if [ "${tracks_after:-0}" -ge "${tracks_before:-0}" ]; then
  echo "    ok    no tracks lost (${tracks_before:-0} before, ${tracks_after:-0} after)"
else
  echo "    FAIL  the track count dropped: ${tracks_before} -> ${tracks_after}"; PROBLEMS=$((PROBLEMS + 1))
fi
# the count alone could hide one track lost and another made, so compare the tracks themselves
IDS_AFTER="$(ssh "$SSH_HOST" "docker exec jam-gym-web-1 node --no-warnings server/admin.js ids" 2>/dev/null | grep -E "$IDS_PATTERN" || true)"
MISSING="$(comm -23 <(printf '%s\n' "$IDS_BEFORE" | grep -E "$IDS_PATTERN" | sort || true) <(printf '%s\n' "$IDS_AFTER" | grep -E "$IDS_PATTERN" | sort || true))"
BEFORE_N="$(printf '%s\n' "$IDS_BEFORE" | grep -cE "$IDS_PATTERN" || true)"
if [ "$BEFORE_N" != "${tracks_before:-0}" ]; then
  # the server running before this deploy did not have the "ids" command yet (the first deploy that adds it), so only the count could be compared
  echo "    note  the previous server could not list track ids (${BEFORE_N} listed, ${tracks_before:-0} tracks); the count check above is all that applies this time"
elif [ -z "$MISSING" ]; then
  echo "    ok    every one of the ${BEFORE_N} tracks that existed before the deploy still exists"
else
  echo "    FAIL  tracks that existed before the deploy are gone: $(echo "$MISSING" | tr '\n' ' ')"
  echo "          (unless their owners deleted them meanwhile). The pre-deploy backup is ~/jam-gym-backups/$BACKUP on the server; see docs/deployment.md, \"Restoring a backup\"."
  PROBLEMS=$((PROBLEMS + 1))
fi

EARDLE_AFTER="$(eardle_snapshot)"
if [ "$EARDLE_BEFORE" = "$EARDLE_AFTER" ]; then
  echo "    ok    eardle untouched (same containers, start times and nginx config)"
else
  echo "    FAIL  eardle changed while this ran:"
  echo "--- before"; echo "$EARDLE_BEFORE"; echo "--- after"; echo "$EARDLE_AFTER"
  echo "    (Expected only if someone deployed eardle at the same moment. Jam Gym's deploy never touches it.)"
  PROBLEMS=$((PROBLEMS + 1))
fi

echo
ELAPSED=$(( $(date +%s) - START ))
if [ "$PROBLEMS" = 0 ]; then
  echo "Shipped $SHA in ${ELAPSED}s. $SITE is live, eardle untouched."
else
  echo "$PROBLEMS check(s) failed after ${ELAPSED}s. To go back: bash scripts/ship.sh --rollback $LIVE"
  exit 1
fi
