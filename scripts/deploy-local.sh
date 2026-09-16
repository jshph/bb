#!/usr/bin/env bash
# Canonical production deploy for the Beelink-hosted bb workspace checkout.
#
# Usage: scripts/deploy-local.sh            # build, back up, and restart
#        scripts/deploy-local.sh --no-build # back up and restart the existing build
set -euo pipefail

export PATH="/home/dev/.local/bin:/home/dev/.local/npm/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SRC=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PKG="$SRC/packages/bb-app"
DB=/home/dev/.bb/bb.db
SERVICE=bb-app.service
PORT=38886
TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_ROOT="/home/dev/.bb/deploy-backups/$TS"
DB_BACKUP="/home/dev/.bb/bb.db.predeploy-$TS"

log() { printf "\n=== %s ===\n" "$*"; }
fail() { printf "FATAL: %s\n" "$*" >&2; exit 1; }

case "${1:-}" in
  "") ;;
  --no-build) ;;
  --help|-h)
    sed -n '2,5p' "$0"
    exit 0
    ;;
  *) fail "usage: $0 [--no-build]" ;;
esac

[[ $(id -u) -ne 0 ]] || fail "run as the dev user, not root"
[[ $SRC == /workspace/projects/bb ]] || \
  fail "production deploy must run from /workspace/projects/bb (resolved $SRC)"
set +e
sudo -n systemctl status "$SERVICE" >/dev/null 2>&1
sudo_status=$?
set -e
[[ $sudo_status == 0 || $sudo_status == 3 ]] || \
  fail "passwordless control of $SERVICE is unavailable"

mkdir -p "$BACKUP_ROOT"

if [[ ${1:-} != --no-build ]]; then
  log "preserve current workspace build"
  for path in server/dist host-daemon/dist app/dist dist; do
    [[ -d $PKG/$path ]] || continue
    mkdir -p "$BACKUP_ROOT/$(dirname "$path")"
    cp -a "$PKG/$path" "$BACKUP_ROOT/$path"
  done

  log "build workspace checkout"
  cd "$SRC"
  NODE_ENV=production GOMAXPROCS=2 pnpm exec turbo run build \
    --concurrency=1 \
    --filter=@bb/scripts \
    --filter=@bb/app \
    --filter=@bb/server \
    --filter=@bb/host-daemon \
    --filter=@bb/cli \
    --filter=bb-app
fi

log "verify one complete workspace build"
for path in server/dist host-daemon/dist app/dist dist; do
  [[ -d $PKG/$path ]] || fail "missing $PKG/$path"
done

log "back up live database"
sqlite3 "$DB" ".backup $DB_BACKUP"
[[ $(sqlite3 "$DB_BACKUP" "PRAGMA integrity_check;") == ok ]] || \
  fail "database backup failed integrity check"
echo "backup: $DB_BACKUP"

systemctl --quiet is-enabled "$SERVICE" || fail "$SERVICE is not enabled for reboot"

log "submit atomic workspace-backed service restart"
echo "restart submitted: workspace=$SRC origin=http://127.0.0.1:$PORT"
echo "the invoking BB thread may disconnect; verify after it reconnects"
sudo -n systemctl restart "$SERVICE"
