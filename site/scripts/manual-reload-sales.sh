#!/usr/bin/env bash
set -euo pipefail

# Manual full reload runner for Plesk/SSH.
# Run with:
# /bin/bash /var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/scripts/manual-reload-sales.sh

APP_ROOT="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/site"
BACKEND_ROOT="/var/www/vhosts/viomes.gr/orders-test.viomes.gr/backend"
LOCK_FILE="/tmp/viomes-manual-reload-sales.lock"
LOG_DIR="$APP_ROOT/logs"

# Canonical sales files used for a clean rebuild.
SALES_FILES="${SALES_FILES:-$BACKEND_ROOT/2025.CSV,$BACKEND_ROOT/2026.CSV}"

# DB settings (server-local MySQL)
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_DATABASE="${MYSQL_DATABASE:-admin_viomes_orders}"
MYSQL_USER="${MYSQL_USER:-admin_viomes_app}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-Yudd042&}"

# Plesk scheduled tasks may have minimal PATH.
export PATH="/opt/plesk/node/24/bin:/opt/plesk/node/22/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/manual-reload-sales-$(date +%F-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$(date -Is)] manual reload started"
echo "[$(date -Is)] log file: $LOG_FILE"
echo "[$(date -Is)] sales files: $SALES_FILES"

IFS=',' read -r -a SALES_FILE_LIST <<< "$SALES_FILES"
for sales_file in "${SALES_FILE_LIST[@]}"; do
  if [[ ! -f "$sales_file" ]]; then
    echo "[$(date -Is)] missing sales file: $sales_file"
    exit 2
  fi
done

# Prevent overlapping manual/nightly maintenance runs.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] another reload/import is already running"
  exit 3
fi

cd "$APP_ROOT"

RUN_ARGS=(
  --sales-files="$SALES_FILES"
  --mysql-host="$MYSQL_HOST"
  --mysql-port="$MYSQL_PORT"
  --mysql-database="$MYSQL_DATABASE"
  --mysql-user="$MYSQL_USER"
  --mysql-password="$MYSQL_PASSWORD"
)

CHECK_ARGS=(
  --mysql-host="$MYSQL_HOST"
  --mysql-port="$MYSQL_PORT"
  --mysql-database="$MYSQL_DATABASE"
  --mysql-user="$MYSQL_USER"
  --mysql-password="$MYSQL_PASSWORD"
)

echo "[$(date -Is)] step 1/2 reload sales"
npm run reload:sales -- "${RUN_ARGS[@]}"

echo "[$(date -Is)] step 2/2 check import integrity"
npm run check:import-integrity -- "${CHECK_ARGS[@]}"

echo "[$(date -Is)] manual reload completed successfully"
