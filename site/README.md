# Site Layer

This is the active runtime application.

## What runs in production

- `server.js`: main Node/Express backend + static hosting
- `public/`: customer/admin frontend files served by Node
- `lib/`: DB and customer-stats provider logic
- `scripts/`: operational scripts (import/reset/nightly)

## Runtime boundaries

This folder is the active production runtime.

- Public flow: static-first UI from `public/`, currently using `public/catalog.json` plus browser-side XLSX/email draft generation.
- Admin flow: runtime-backed auth and analytics APIs served by `server.js`.
- Import flow: operational wrappers in `scripts/` call the Python importer in `backend/import_entersoft.py`.

Runtime support matrix:

- Supported in production: Node + MySQL
- Supported in automated tests: Node + SQLite in-memory fixtures for local SQL-backed provider coverage
- Not a supported production mode: Node + SQLite deployment

## Runtime DB mode

Expected env on server:

- `DB_CLIENT=mysql`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

Health check:

- `GET /api/health`

## Key API contract

- `GET /api/admin/customers/:code/stats` (must remain stable)

## Admin users

Create or update admin portal credentials with:

```bash
npm run admin:create-user -- --username=USERNAME --password=PASSWORD
```

Optional:

- `--active=0` creates or updates the user as inactive
- rerunning the command for the same username resets the password and active flag

## Schema and provider notes

- Runtime schema authority lives in `lib/db/init-schema.js`.
- Shared MySQL import-table DDL lives in `../backend/sql/mysql_import_schema.sql`.
- The Python importer loads that shared import schema via `backend/mysql_db.py`; treat the remaining duplication as transitional and keep it aligned.
- Runtime DB architecture is logical, not flat:
  - operational: `products`, `admin_users`, `admin_sessions`
  - ingestion: `import_runs`, `imported_sales_lines`
  - projections: `imported_customers`, `imported_orders`, `imported_monthly_sales`, `imported_product_sales`, mirrored import customers
  - legacy/dormant compatibility: `orders`, `order_lines`, `customer_receivables`, non-import customer behavior
- `CUSTOMER_STATS_PROVIDER=sqlite` is the historical name for the local SQL-backed provider, not a guarantee that the runtime DB is SQLite.
- The active SQL-backed provider is projection-first: imported projections are the primary analytics read model, while `imported_sales_lines` remains the raw fact table for rebuilds and drill-down.
- `CUSTOMER_STATS_PROVIDER=entersoft` switches the admin stats endpoint to an external upstream adapter while preserving the frontend JSON contract.

## Notes

- This folder is the deployment target for Node on Plesk.
- Import scheduling is handled through `scripts/nightly-import.sh`.
- `POST /api/order/export-xlsx` is retained as a compatibility endpoint; the current public order form does not depend on it.
- `GET /api/admin/import-health` is the admin-facing integrity endpoint for projection checks and latest import-ledger status.
- Run the lightweight Node regression suite with `npm test`.
