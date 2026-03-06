#!/usr/bin/env bash
set -euo pipefail

# Nightly Entersoft import runner for Plesk Scheduled Tasks.
# Run with: /bin/bash /var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/scripts/nightly-import.sh

APP_ROOT="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/site"
DAILY_INFO_FILE="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/backend/today.csv"
LOCK_FILE="/tmp/viomes-nightly-import.lock"
LOG_DIR="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/logs"
IMPORT_RUNNER_JS="$APP_ROOT/scripts/run-entersoft-import.js"

# DB settings (server-local MySQL)
MYSQL_HOST="127.0.0.1"
MYSQL_PORT="3306"
MYSQL_DATABASE="admin_viomes_orders"
MYSQL_USER="admin_viomes_app"
MYSQL_PASSWORD="Yudd042&"

# Plesk scheduled tasks may have minimal PATH.
export PATH="/opt/plesk/node/24/bin:/opt/plesk/node/22/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/nightly-import-$(date +%F).log"
exec >>"$LOG_FILE" 2>&1

echo "[$(date -Is)] nightly import started"

if [[ ! -f "$DAILY_INFO_FILE" ]]; then
  echo "[$(date -Is)] missing input file: $DAILY_INFO_FILE"
  exit 2
fi

# Prevent overlapping runs.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] another import is already running"
  exit 3
fi

cd "$APP_ROOT"

IMPORT_ARGS=(
  --mode=incremental
  --python-install-deps=1
  --daily-info-file="$DAILY_INFO_FILE"
  --mysql-host="$MYSQL_HOST"
  --mysql-port="$MYSQL_PORT"
  --mysql-database="$MYSQL_DATABASE"
  --mysql-user="$MYSQL_USER"
  --mysql-password="$MYSQL_PASSWORD"
)

if [[ -x "/opt/plesk/node/24/bin/npm" ]]; then
  /opt/plesk/node/24/bin/npm run import:entersoft -- "${IMPORT_ARGS[@]}"
elif [[ -x "/opt/plesk/node/22/bin/npm" ]]; then
  /opt/plesk/node/22/bin/npm run import:entersoft -- "${IMPORT_ARGS[@]}"
elif command -v npm >/dev/null 2>&1; then
  npm run import:entersoft -- "${IMPORT_ARGS[@]}"
else
  NODE_BIN=""
  for candidate in /opt/plesk/node/24/bin/node /opt/plesk/node/22/bin/node /usr/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
  if [[ -z "$NODE_BIN" ]]; then
    echo "[$(date -Is)] no npm/node binary found"
    exit 4
  fi
  "$NODE_BIN" "$IMPORT_RUNNER_JS" "${IMPORT_ARGS[@]}"
fi

echo "[$(date -Is)] nightly import completed successfully"
