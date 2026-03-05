#!/usr/bin/env bash
set -euo pipefail

# Nightly Entersoft import runner for Plesk Scheduled Tasks.
# Run with: /bin/bash /var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/scripts/nightly-import.sh

APP_ROOT="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/site"
DAILY_INFO_FILE="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/backend/daily_info.csv"
LOCK_FILE="/tmp/viomes-nightly-import.lock"
LOG_DIR="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/logs"

# DB settings (server-local MySQL)
MYSQL_HOST="127.0.0.1"
MYSQL_PORT="3306"
MYSQL_DATABASE="admin_viomes_orders"
MYSQL_USER="admin_viomes_app"
MYSQL_PASSWORD="Yudd042"

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

npm run import:entersoft -- \
  --python-install-deps=1 \
  --skip-customers=1 \
  --daily-info-file="$DAILY_INFO_FILE" \
  --mysql-host="$MYSQL_HOST" \
  --mysql-port="$MYSQL_PORT" \
  --mysql-database="$MYSQL_DATABASE" \
  --mysql-user="$MYSQL_USER" \
  --mysql-password="$MYSQL_PASSWORD"

echo "[$(date -Is)] nightly import completed successfully"
