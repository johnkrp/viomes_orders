# VIOMES Order Form

This project now uses:

- `site/` for the public static frontend and the active Node.js backend
- `backend/` as the shared SQLite/demo-data source and reference Python prototype

The active production path is now the Node.js app in `site/server.js`, which is a better fit for Plesk deployment.

## Backend status

The Node backend currently provides:

- public API routes for catalog and order creation
- admin auth routes with cookie sessions
- protected admin customer stats endpoint
- detailed customer analytics, revenue metrics, and order drill-down data
- DB access through:
  - SQLite (`backend/app.db`) by default
  - MariaDB/MySQL via Plesk Databases when `DB_CLIENT=mysql`

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

## Database client switch (SQLite or MariaDB)

Default mode:

- `DB_CLIENT=sqlite`

MariaDB/MySQL mode:

- `DB_CLIENT=mysql`
- `MYSQL_HOST=127.0.0.1`
- `MYSQL_PORT=3306`
- `MYSQL_DATABASE=...`
- `MYSQL_USER=...`
- `MYSQL_PASSWORD=...`

The app keeps the same routes, including `GET /api/admin/customers/:code/stats`.
On startup, it auto-creates required tables for the selected DB client.

## Seed demo customer stats

From `backend/`:

```powershell
.\.venv\Scripts\python.exe seed_demo_data.py
```

This creates demo customers and linked orders so `admin.html` can show real data immediately.

## Entersoft file import

The current real-data path is file-based.

Entersoft exports are placed in `backend/` and imported into `backend/app.db` by:

```powershell
python backend\import_entersoft.py
```

Current files:

- `backend/customers.csv`
- `backend/info_2025.csv`
- `backend/info_2026.csv`

Detailed mapping, table behavior, and known limitations are documented in:

- [backend/ENTERSOFT_IMPORT_README.md](/d:/Desktop/programming/viomes/order_form/backend/ENTERSOFT_IMPORT_README.md)

## Migrate existing SQLite data into MariaDB

After you create the DB/user in Plesk and set MySQL env vars:

```powershell
cd site
npm run migrate:sqlite-to-db
```

If your command runner does not inherit app env vars, pass them explicitly:

```powershell
npm run migrate:sqlite-to-db -- --target=mysql --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Optional source path override:

- `SOURCE_SQLITE_PATH=D:\path\to\app.db`

Notes:

- Migration copies all tables used by app/admin/imported Entersoft data.
- Target DB is truncated first.
- Script requires `DB_CLIENT=mysql`.

## Next integration step

Replace the local SQLite-backed customer stats implementation with an Entersoft-backed adapter while keeping the same JSON contract exposed by `site/server.js`.

## Customer stats provider switch

The admin endpoint `GET /api/admin/customers/:code/stats` now uses a provider layer.

Default:

- `CUSTOMER_STATS_PROVIDER=sqlite`

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

- `db_client` (sqlite or mysql)
- `customer_stats_provider`

so staging can confirm the switch safely before production rollout.
