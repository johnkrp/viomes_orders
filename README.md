# VIOMES Order Form

This project now uses:

- `site/` for the public static frontend and the active Node.js backend
- `backend/` for file import scripts (Entersoft CSVs -> MySQL)

The active production path is now the Node.js app in `site/server.js`, which is a better fit for Plesk deployment.

## Architecture map

Treat the repo as two connected systems:

- Runtime app: `site/server.js` serves the public order form, admin UI, admin auth, catalog API, and customer stats API.
- Data pipeline: `backend/import_entersoft.py` imports Entersoft sales files into MySQL, usually through the wrappers in `site/scripts/`.

Current shared MySQL source-of-truth layout:

- operational: `products`, `admin_users`, `admin_sessions`
- ingestion: `import_runs`, `imported_sales_lines`
- projections: `imported_customers`, `imported_orders`, `imported_monthly_sales`, `imported_product_sales`, mirrored `customers`
- legacy/dormant compatibility tables: `orders`, `order_lines`, `customer_receivables`, non-import `customers`

Legacy-but-present code:

- `backend/app/*`
- `backend/main.py`
- older FastAPI/SQLite/demo helpers in `backend/`

Those legacy files are kept for reference only and are not part of the active production runtime unless explicitly re-enabled.

## Supported matrix

Supported today:

- Production runtime: Node app in `site/` with `DB_CLIENT=mysql`
- Import pipeline: Python importer in `backend/` targeting MySQL
- Automated tests: Node tests may use SQLite in-memory databases for integration coverage of the local SQL-backed provider branch

Not a supported production target:

- FastAPI backend in `backend/app/*`
- SQLite runtime deployment for the current production app
- Legacy `backend/db.py` path except as reference code

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

Schema ownership note:

- runtime authority: `site/lib/db/init-schema.js`
- shared MySQL import-table DDL: `backend/sql/mysql_import_schema.sql`
- importer compatibility loader: `backend/mysql_db.py`

Keep those definitions aligned. The Python schema helper is transitional and should not evolve independently from the Node runtime schema.
Treat `imported_sales_lines` as the canonical raw imported-sales fact table. The other `imported_*` tables are rebuildable projections.

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

Single daily file mode:

```powershell
npm run import:entersoft -- --daily-info-file=/absolute/path/daily_info.csv --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Import mode:

- default: `incremental` (keeps history in `imported_sales_lines`, skips duplicate logical sales lines even if the source filename changes)
- optional full refresh: `--mode=full_refresh`

You can also pass multiple sales files:

```powershell
npm run import:entersoft -- --sales-files=/path/2025.CSV,/path/2026.CSV --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Import command failsafe timeout:

- wrapper default: `1800` seconds
- override with `ENTERSOFT_IMPORT_TIMEOUT_SECONDS` (or `IMPORT_TIMEOUT_SECONDS`)

Server-side shell wrappers currently export:

- `ENTERSOFT_IMPORT_TIMEOUT_SECONDS=7200`

to avoid long imports being killed after only 30 minutes.

## Full Reset + Reload (new yearly files)

Reset business/import tables (keeps `admin_users` and `admin_sessions`):

```powershell
npm run reset:business-data -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Run reset + import in one command:

```powershell
npm run reload:sales -- --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/2025.CSV,/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/2026.CSV --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Manual full rebuild script with logging and post-check:

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders.viomes.gr/site/scripts/manual-reload-sales.sh
```

Cleanup historical duplicates already present in import history:

```powershell
cd site
npm run dedupe:sales -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Use `dedupe:sales` if bad history is already in `imported_sales_lines`. Use `full_refresh` if you want to rebuild from canonical yearly files.

Integrity check command:

```powershell
cd site
npm run check:import-integrity -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

## Plesk Nightly Task

Script added:

- `site/scripts/nightly-import.sh`

In Plesk `Scheduled Tasks` use:

- Task type: `Run a command`
- Command:

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders.viomes.gr/site/scripts/nightly-import.sh
```

The script logs to:

- `/var/www/vhosts/viomes.gr/orders.viomes.gr/site/logs/nightly-import-YYYY-MM-DD.log`

Current files:

- sales file(s) only, e.g. `backend/2025.CSV`, `backend/2026.CSV`, or a single `backend/today.csv`

`customers` / `imported_customers` are now rebuilt directly from sales lines during import (no mandatory `customers.csv` input).

`today.csv` does not need to contain only one day.
It can contain multiple recent days or overlap with the yearly file(s); the importer now skips duplicate logical sales lines when the row content matches.

Detailed mapping, table behavior, and known limitations are documented in:

- [backend/ENTERSOFT_IMPORT_README.md](/d:/Desktop/programming/viomes/order_form/backend/ENTERSOFT_IMPORT_README.md)

## Import Operations Notes

- Use `npm run import:entersoft` when adding newer monthly/daily data to existing history.
- Use `npm run reload:sales` or `manual-reload-sales.sh` only when you want to clear business/import tables and rebuild from canonical files.
- The importer runs inside a single DB transaction. If it fails before commit, imported tables remain unchanged or appear empty after a reset+reload attempt.
- A `504` from the Plesk web UI usually means the request path timed out; it does not prove the importer logic is wrong. Long imports should be run through shell scripts, SSH, or Scheduled Tasks, not interactive web requests.
- If a reset succeeded and the later import failed, `admin_users`, `admin_sessions`, and `products` remain, but import/business tables stay empty until a successful reload.

## Next integration step

Replace the projection-first local SQL-backed customer stats implementation with an Entersoft-backed adapter while keeping the same JSON contract exposed by `site/server.js`.

## Customer stats provider switch

The admin endpoint `GET /api/admin/customers/:code/stats` now uses a provider layer.

Default:

- `CUSTOMER_STATS_PROVIDER=sqlite` (local SQL provider name)

Despite the historical name, `sqlite` currently means the local SQL-backed customer-stats provider. In the active Node runtime it is projection-first and can read the MySQL-backed imported projections created by the current import/runtime flow.

Import observability:

- `import_runs` is now an ingestion ledger, not just a status table.
- It records import mode, source file metadata/checksums, duplicate skips, rejected rows, rebuild timing, schema version, and trigger source.
- `GET /api/health` now exposes the logical DB architecture and latest import-run summary.
- `GET /api/admin/import-health` exposes full projection integrity checks for admin users.

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

## Public/admin split

Current public ordering behavior is intentionally static-first:

- `site/public/order-form.js` loads `site/public/catalog.json`
- Excel generation happens client-side in the browser
- Gmail/Outlook draft creation happens client-side in the browser

Current admin/analytics behavior is runtime/API-backed:

- admin auth runs through `site/server.js`
- customer analytics run through MySQL-backed APIs and the customer-stats provider layer

Compatibility note:

- `POST /api/order/export-xlsx` still exists in `site/server.js`, but it is not the canonical path used by the current public order form

## Tests

Node-side regression checks:

```powershell
cd site
npm test
```

Python-side importer helper checks:

```powershell
python -m unittest discover -s backend/tests
```
