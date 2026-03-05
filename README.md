# VIOMES Order Form

This project now uses:

- `site/` for the public static frontend and the active Node.js backend
- `backend/` for file import scripts (Entersoft CSVs -> MySQL)

The active production path is now the Node.js app in `site/server.js`, which is a better fit for Plesk deployment.

## Backend status

The Node backend currently provides:

- public API routes for catalog and order creation
- admin auth routes with cookie sessions
- protected admin customer stats endpoint
- detailed customer analytics, revenue metrics, and order drill-down data
- MariaDB/MySQL as the only runtime DB client

Current admin login defaults are for local development only:

- username: `admin`
- password: `change-me-now`

Change them with environment variables before any shared deployment.

## Run backend

From `site/`:

```powershell
npm install
npm run start
```

## Database setup (MariaDB/MySQL)

- `DB_CLIENT=mysql`
- `MYSQL_HOST=127.0.0.1`
- `MYSQL_PORT=3306`
- `MYSQL_DATABASE=...`
- `MYSQL_USER=...`
- `MYSQL_PASSWORD=...`

The app keeps the same routes, including `GET /api/admin/customers/:code/stats`.
On startup, it auto-creates required tables in MySQL.

## Seed demo customer stats

From `backend/`:

```powershell
.\.venv\Scripts\python.exe seed_demo_data.py
```

This creates demo customers and linked orders so `admin.html` can show real data immediately.

## Entersoft file import

The current real-data path is file-based.

Entersoft exports are placed in `backend/` and imported directly into MySQL by:

```powershell
python backend\import_entersoft.py
```

If your hosting panel only allows npm commands (Plesk Node.js runner), use:

```powershell
cd site
npm run import:entersoft
```

If Plesk npm runner does not inherit app env vars, pass DB args explicitly:

```powershell
npm run import:entersoft -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

If Python on server is missing `PyMySQL`, auto-install it in the same run:

```powershell
npm run import:entersoft -- --python-install-deps=1 --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Single daily file mode (skip customer master refresh):

```powershell
npm run import:entersoft -- --skip-customers=1 --daily-info-file=/absolute/path/daily_info.csv --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

You can also pass multiple sales files:

```powershell
npm run import:entersoft -- --sales-files=/path/info_2025.csv,/path/info_2026.csv --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Import command failsafe timeout:

- default: `1800` seconds
- override with `ENTERSOFT_IMPORT_TIMEOUT_SECONDS` (or `IMPORT_TIMEOUT_SECONDS`)

The SQLite -> MySQL migration command already supports explicit args the same way:

```powershell
npm run migrate:sqlite-to-db -- --target=mysql --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

## Plesk Nightly Task

Script added:

- `site/scripts/nightly-import.sh`

In Plesk `Scheduled Tasks` use:

- Task type: `Run a command`
- Command:

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/scripts/nightly-import.sh
```

The script logs to:

- `/var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/logs/nightly-import-YYYY-MM-DD.log`

Current files:

- `backend/customers.csv`
- `backend/info_2025.csv`
- `backend/info_2026.csv`

Detailed mapping, table behavior, and known limitations are documented in:

- [backend/ENTERSOFT_IMPORT_README.md](/d:/Desktop/programming/viomes/order_form/backend/ENTERSOFT_IMPORT_README.md)

## Next integration step

Replace the local SQL-backed customer stats implementation with an Entersoft-backed adapter while keeping the same JSON contract exposed by `site/server.js`.

## Customer stats provider switch

The admin endpoint `GET /api/admin/customers/:code/stats` now uses a provider layer.

Default:

- `CUSTOMER_STATS_PROVIDER=sqlite` (local SQL provider name)

Entersoft handoff mode:

- `CUSTOMER_STATS_PROVIDER=entersoft`
- `ENTERSOFT_BASE_URL=https://...`
- `ENTERSOFT_CUSTOMER_STATS_PATH=/customers/{code}/stats`
- `ENTERSOFT_RESPONSE_SHAPE=entersoft-customer-stats-v1`
- `ENTERSOFT_TIMEOUT_MS=10000`

Optional auth:

- `ENTERSOFT_BEARER_TOKEN=...`
- `ENTERSOFT_USERNAME=...`
- `ENTERSOFT_PASSWORD=...`
- `ENTERSOFT_API_KEY=...`
- `ENTERSOFT_API_KEY_HEADER=X-API-Key`

Supported upstream payload shapes:

- `viomes-admin-stats`
  Use this if the Entersoft-side adapter already returns the exact existing frontend contract.
- `entersoft-customer-stats-v1`
  Use this if the upstream returns a more Entersoft-oriented payload and should be mapped by Node before reaching the frontend.

The health endpoint now reports:

- `db_client` (`mysql`)
- `customer_stats_provider`

so staging can confirm the switch safely before production rollout.
