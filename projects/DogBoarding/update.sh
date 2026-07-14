#!/usr/bin/env bash
#
# Update the DogBoarding deployment on the Droplet: pull, build, restart.
#
# WHERE TO RUN THIS: on the Droplet itself, not on App Platform and not on your
# laptop. Get a shell on the Droplet either way:
#   - SSH:  ssh youruser@your.droplet.ip
#   - or the DigitalOcean dashboard -> your Droplet -> "Console" (a browser shell)
# then:
#   cd /opt/guts
#   ./projects/DogBoarding/update.sh
#
# It pulls the latest main, reinstalls deps, rebuilds the DogBoarding client, and
# restarts the service. Your data in /mnt/dogboard (database + uploads) is never
# touched. If nothing new was pushed, it exits without restarting.
#
# Overridable via env vars: GUTS_REPO_DIR, GUTS_SERVICE, GUTS_BRANCH.

set -euo pipefail

REPO_DIR="${GUTS_REPO_DIR:-/opt/guts}"
SERVICE="${GUTS_SERVICE:-guts}"
BRANCH="${GUTS_BRANCH:-main}"

cd "$REPO_DIR"

echo "==> Fetching origin/$BRANCH"
git fetch origin "$BRANCH"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "==> Already up to date ($LOCAL). Nothing to deploy."
    exit 0
fi

echo "==> Updating ${LOCAL:0:9} -> ${REMOTE:0:9}"
# Fast-forward only: refuse to run if the Droplet's checkout has diverged from
# origin (e.g. someone edited files on the box), rather than silently merging.
if ! git merge --ff-only "origin/$BRANCH"; then
    echo "!! Cannot fast-forward. The checkout in $REPO_DIR has diverged from" >&2
    echo "!! origin/$BRANCH. Resolve it by hand before deploying." >&2
    exit 1
fi

echo "==> Installing dependencies"
npm install

echo "==> Building DogBoarding client"
npm run build DogBoarding

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

echo "==> Deployed. Service status:"
sudo systemctl --no-pager --lines=5 status "$SERVICE" || true
