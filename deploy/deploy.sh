#!/usr/bin/env bash
# Uploads the GUTS site or a game to the gutsengine Droplet and installs its packages.
#
#   deploy/deploy.sh site                 the GUTS site (this repo + projects/*) -> /srv/site
#   deploy/deploy.sh age|kingdom|realm|heroarena|descent|wiki    a game -> /srv/games/<slug>
#   deploy/deploy.sh setup                nginx, the gateway and the services (after a change to them)
#
# Needs the `gutsengine` host in ~/.ssh/config (the deploy key). Build the game first (npm run build;
# Age of Defiance also npm run world). Saves on the server are never touched.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECTS="$(cd "$HERE/../.." && pwd)"
HOST=gutsengine

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
        slug="$1"; dir="$PROJECTS/${SRC[$slug]}"
        push "$dir" "/srv/games/$slug"
        ssh "$HOST" "cd /srv/games/$slug && ln -sfn ../../resources dist/client/resources && mkdir -p saves && chown -R guts:guts saves dist \
            && sudo -u guts npm install --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null && curl -s -X POST localhost:9000/_restart/$slug >/dev/null || true"
        # pre-compressed copies for nginx (gzip_static), only where missing or stale
        ssh "$HOST" "cd /srv/games/$slug && find resources dist -type f \( -name '*.glb' -o -name '*.json' -o -name '*.js' -o -name '*.gltf' \) -size +1k             -exec sh -c 'for f; do [ \"\$f.gz\" -nt \"\$f\" ] || gzip -6 -k -f \"\$f\"; done' _ {} + && chown -R guts:guts resources dist"
        ;;
    setup)
        scp "$HERE/gateway.mjs" "$HERE/package.json" "$HOST:/srv/gateway/"
        scp "$HERE/guts-site.service" "$HERE/guts-gateway.service" "$HOST:/etc/systemd/system/"
        scp "$HERE/nginx.conf" "$HOST:/etc/nginx/sites-available/gutsengine"
        ssh "$HOST" "chown -R guts:guts /srv/gateway && cd /srv/gateway && sudo -u guts npm install --omit=dev --no-audit --no-fund >/dev/null \
            && ln -sfn /etc/nginx/sites-available/gutsengine /etc/nginx/sites-enabled/gutsengine && rm -f /etc/nginx/sites-enabled/default \
            && nginx -t && certbot --nginx -d gutsengine.app -d www.gutsengine.app --non-interactive --reinstall --redirect >/dev/null             && systemctl reload nginx && systemctl daemon-reload && systemctl enable --now guts-site guts-gateway && systemctl restart guts-gateway"
        ;;
    *) echo "usage: $0 site|age|kingdom|realm|heroarena|descent|wiki|setup"; exit 1 ;;
esac
echo done
