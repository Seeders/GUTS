#!/usr/bin/env bash
# Uploads the GUTS site or a game to the gutsengine Droplet and installs its packages.
#
#   deploy/deploy.sh site                 the GUTS site (this repo + projects/*) -> /srv/site
#   deploy/deploy.sh age|kingdom|realm|heroarena|descent|wiki    a game -> /srv/games/<slug>
#   deploy/deploy.sh descent-wiki         the Descent's player wiki (built here: tools/wiki/build.mjs) -> /wiki/descent/
#   deploy/deploy.sh nginx                nginx.conf only (no gateway restart: games keep running)
#   deploy/deploy.sh setup                nginx, the gateway and the services (after a change to them)
#
# Needs the `gutsengine` host in ~/.ssh/config (the deploy key). A game deploys its last commit, built
# fresh (uncommitted changes never go live); commit before deploying. GENERATED paths (npm run world
# output) ship from the local folder. Saves on the server are never touched.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECTS="$(cd "$HERE/../.." && pwd)"
HOST=gutsengine

GENERATED=(resources/world)   # gitignored, made by npm run world; shipped as built locally
declare -A SRC=([age]=EmbersOfDefiance [kingdom]=KingdomOfDefiance [realm]=WorldOfDefiance [heroarena]=HeroArena [descent]=Descent [wiki]=GUTSWiki)

# Files the server never needs (the build's copy of resources/ is linked back to resources/ there)
EXCLUDES=(--exclude=.git --exclude=node_modules --exclude='saves' --exclude='saves_*' --exclude=.claude --exclude='*.log'
          --exclude='*.tgz' --exclude=./tools --exclude=./dist/client/resources --exclude=./uploads)

push() {   # push <local dir> <remote dir>
    local from="$1" to="$2"
    echo "uploading $from -> $HOST:$to"
    ssh "$HOST" "mkdir -p '$to' && chown guts:guts '$to'"
    tar -C "$from" -cf - "${EXCLUDES[@]}" . | gzip -1 | ssh "$HOST" "tar -xzf - -C '$to' --no-same-owner && chown -R guts:guts '$to'"
}

case "${1:-}" in
    site)
        push "$PROJECTS/GUTS" /srv/site
        ssh "$HOST" "cd /srv/site && sudo -u guts npm ci --omit=dev --no-audit --no-fund >/dev/null && systemctl restart guts-site"
        ;;
    age|kingdom|realm|heroarena|descent|wiki)
        # Games ship their last commit only: export HEAD, build it, upload to a staging folder, then
        # mirror that over the live folder (deleting files no longer in the commit; saves untouched).
        slug="$1"; dir="$PROJECTS/${SRC[$slug]}"
        work="$(mktemp -d)"; stage="$work/$(basename "$dir")"; mkdir "$stage"
        cleanup() { [ -e "$stage/node_modules" ] && cmd //c rmdir "$(cygpath -w "$stage/node_modules")"; rm -rf "$work"; }
        trap cleanup EXIT
        echo "exporting $(git -C "$dir" rev-parse --short HEAD) of ${SRC[$slug]}"
        git -C "$dir" archive HEAD | tar -xf - -C "$stage"
        cmd //c mklink //J "$(cygpath -w "$stage/node_modules")" "$(cygpath -w "$dir/node_modules")" >/dev/null
        (cd "$stage" && npm run build >/dev/null && { ! grep -q '"build:editor"' package.json || npm run build:editor >/dev/null; })
        # generated data that is gitignored (npm run world output) ships from the local folder
        for gen in "${GENERATED[@]}"; do [ -e "$dir/$gen" ] && mkdir -p "$stage/$(dirname "$gen")" && cp -r "$dir/$gen" "$stage/$gen"; done
        # DEPLOY_OVERLAY=<folder>: files laid over the export at their paths (ones too big for the git host, built locally)
        [ -n "$DEPLOY_OVERLAY" ] && [ -d "$DEPLOY_OVERLAY" ] && cp -r "$DEPLOY_OVERLAY"/. "$stage"/ && echo "overlaid $DEPLOY_OVERLAY"
        push "$stage" "/srv/games/$slug.new"
        # tools the server runs (a land rolled at start: tools/world and what it imports), though tools/ is left out
        for t in world zone; do [ -d "$stage/tools/$t" ] && push "$stage/tools/$t" "/srv/games/$slug.new/tools/$t"; done
        ssh "$HOST" "rsync -a --delete --exclude=/node_modules --exclude=/saves --exclude='/saves_*' --exclude='*.log' --exclude='*.gz' \
            --exclude=/dist/client/resources /srv/games/$slug.new/ /srv/games/$slug/ && rm -rf /srv/games/$slug.new"
        ssh "$HOST" "cd /srv/games/$slug && ln -sfn ../../resources dist/client/resources && mkdir -p saves && chown -R guts:guts saves dist \
            && sudo -u guts npm install --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null && curl -s -X POST localhost:9000/_restart/$slug >/dev/null || true"
        # pre-compressed copies for nginx (gzip_static), only where missing or stale
        ssh "$HOST" "cd /srv/games/$slug && find resources dist -type f \( -name '*.glb' -o -name '*.json' -o -name '*.js' -o -name '*.gltf' \) -size +1k             -exec sh -c 'for f; do [ \"\$f.gz\" -nt \"\$f\" ] || gzip -6 -k -f \"\$f\"; done' _ {} + && chown -R guts:guts resources dist"
        ;;
    descent-wiki)
        (cd "$PROJECTS/Descent" && node tools/wiki/build.mjs >/dev/null 2>&1)
        ssh "$HOST" "mkdir -p /srv/wikis/descent"
        scp "$PROJECTS/Descent/tools/wiki/out/wiki.html" "$HOST:/srv/wikis/descent/index.html"
        ssh "$HOST" "cd /srv/wikis/descent && gzip -6 -k -f index.html && chown -R guts:guts /srv/wikis"
        ;;
    nginx)
        scp "$HERE/nginx.conf" "$HOST:/etc/nginx/sites-available/gutsengine"
        ssh "$HOST" "nginx -t && certbot --nginx -d gutsengine.app -d www.gutsengine.app --non-interactive --reinstall --redirect >/dev/null && systemctl reload nginx"
        ;;
    setup)
        scp "$HERE/gateway.mjs" "$HERE/package.json" "$HOST:/srv/gateway/"
        scp "$HERE/guts-site.service" "$HERE/guts-gateway.service" "$HOST:/etc/systemd/system/"
        scp "$HERE/nginx.conf" "$HOST:/etc/nginx/sites-available/gutsengine"
        ssh "$HOST" "chown -R guts:guts /srv/gateway && cd /srv/gateway && sudo -u guts npm install --omit=dev --no-audit --no-fund >/dev/null \
            && ln -sfn /etc/nginx/sites-available/gutsengine /etc/nginx/sites-enabled/gutsengine && rm -f /etc/nginx/sites-enabled/default \
            && nginx -t && certbot --nginx -d gutsengine.app -d www.gutsengine.app --non-interactive --reinstall --redirect >/dev/null             && systemctl reload nginx && systemctl daemon-reload && systemctl enable --now guts-site guts-gateway && systemctl restart guts-gateway"
        ;;
    *) echo "usage: $0 site|age|kingdom|realm|heroarena|descent|wiki|descent-wiki|nginx|setup"; exit 1 ;;
esac
echo done
