#!/usr/bin/env bash
# Idempotent, all-or-nothing deploy of the local bb fork -> installed bb-app,
# then restart + verify. Prevents the partial-deploy footgun (server updated but
# host-daemon/migrations stale -> proto mismatch + "no such column").
#
# Usage:  scripts/deploy-local.sh              (build + deploy + restart + verify)
#         scripts/deploy-local.sh --no-build   (deploy existing build only)
set -euo pipefail

SRC=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PKG="$SRC/packages/bb-app"
LIVE=/home/dev/.local/share/bb-app/node_modules/bb-app
DB=/home/dev/.bb/bb.db
PORT=38886
TS=$(date +%Y%m%dT%H%M%SZ)

log(){ printf "\n=== %s ===\n" "$*"; }

case "${1:-}" in
  "")
    log "build (turbo)"
    cd "$SRC"
    NODE_ENV=production GOMAXPROCS=2 pnpm exec turbo run build \
      --concurrency=1 \
      --filter=@bb/scripts \
      --filter=@bb/app \
      --filter=@bb/server \
      --filter=@bb/host-daemon \
      --filter=@bb/cli \
      --filter=bb-app
    ;;
  --no-build) ;;
  --help|-h)
    sed -n '2,8p' "$0"
    exit 0
    ;;
  *)
    echo "Usage: $0 [--no-build]" >&2
    exit 2
    ;;
esac

log "sanity: build produced all first-party dist dirs"
for d in server/dist host-daemon/dist app/dist dist; do
  [ -d "$PKG/$d" ] || { echo "FATAL: missing built $d — aborting (no partial deploy)"; exit 1; }
done

log "quiesce server writes for a bounded, consistent DB backup"
server_pid=$(
  pgrep -f "^/usr/bin/node $LIVE/server/dist/index\\.js$" | head -n 1 || true
)
resume_server() {
  if [[ "$server_pid" =~ ^[1-9][0-9]*$ ]]; then
    kill -CONT "$server_pid" 2>/dev/null || true
  fi
}
trap resume_server EXIT
if [[ "$server_pid" =~ ^[1-9][0-9]*$ ]]; then
  kill -STOP "$server_pid"
  echo "  paused server pid $server_pid"
else
  echo "  server child not found; continuing with SQLite's online backup"
fi

log "backup DB (migrations auto-run on restart)"
BK="/home/dev/.bb/bb.db.predeploy-$TS"
sqlite3 "$DB" ".backup $BK"
echo "backup: $BK ($(sqlite3 "$BK" "PRAGMA integrity_check;" | head -1))"
resume_server
server_pid=""
trap - EXIT

log "deploy ALL dist dirs together (old -> .broken-$TS)"
for d in server/dist host-daemon/dist app/dist dist; do
  mv "$LIVE/$d" "$LIVE/$d.broken-$TS"
  cp -a "$PKG/$d" "$LIVE/$d"
  echo "  deployed $d"
done
cp -a "$LIVE/package.json" "$LIVE/package.json.broken-$TS"; cp -a "$PKG/package.json" "$LIVE/package.json"

log "verify server + host-daemon are ONE consistent build"
for f in server/dist/index.js host-daemon/dist/daemon-bundle.mjs dist/bb-app.js; do
  a=$(sha256sum "$LIVE/$f"|cut -c1-16); b=$(sha256sum "$PKG/$f"|cut -c1-16)
  [ "$a" = "$b" ] && echo "  ok  $f ($a)" || { echo "  MISMATCH $f"; exit 1; }
done

log "restart"
if sudo -n systemctl restart bb-app.service 2>/dev/null; then echo "  restarted via systemctl"
else kill "$(systemctl show bb-app.service -p MainPID --value)" 2>/dev/null && echo "  restarted via kill (Restart=always)"; fi

log "verify (wait for migrate + startup)"; sleep 18
code=$(curl -s -o /dev/null -w "%{http_code}" -m 8 "http://127.0.0.1:$PORT/" || echo 000)
applied=$(sqlite3 "$DB" "SELECT COUNT(*) FROM __drizzle_migrations;")
bad=$(journalctl -u bb-app.service --no-pager --since "20 seconds ago" 2>/dev/null | grep -icE "no such column|protocol version mismatch|Rejecting daemon|shared-port activation failed")
conn=$(journalctl -u bb-app.service --no-pager --since "25 seconds ago" 2>/dev/null | grep -c "Connected to server")
echo "  health=$code  migrations=$applied  bad_lines=$bad  daemon_connected=$conn"
if [ "$code" = 200 ] && [ "$bad" -eq 0 ] && [ "$conn" -ge 1 ]; then
  echo "DEPLOY OK"
else
  echo "DEPLOY SUSPECT — rollback: for d in server/dist host-daemon/dist app/dist dist; do rm -rf \$LIVE/\$d; mv \$LIVE/\$d.broken-$TS \$LIVE/\$d; done; then restart"; exit 1
fi
