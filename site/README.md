# Site Layer

This folder is the active production runtime.

## What Runs In Production

- `app.js`
  - Express app factory
- `server.js`
  - runtime bootstrap
- `public/`
  - public order form + admin frontend
- `lib/`
  - DB access, schema init, providers, import helpers
- `scripts/`
  - operational import/reset/check tasks

## Supported Runtime Matrix

- supported in production:
  - Node + MySQL/MariaDB
- supported in tests:
  - Node + SQLite/in-memory fixtures
- not a supported production target:
  - Node + SQLite deployment

## Runtime DB Expectations

Required env:

- `DB_CLIENT=mysql`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

Health endpoint:

```text
GET /api/health
```

## Admin Stats Model

The key admin endpoint remains:

```text
GET /api/admin/customers/:code/stats
```

Current behavior:

- sales analytics are projection-first and MySQL-backed
- customer search is projection-backed
- branch drill-down remains available for sales analytics
- balances/ledger panel is customer-level only

## Current Ledger / Balances Behavior

The old receivables/open-invoice semantics are no longer the active model for this panel.

The admin balances area now behaves as a ledger view driven by the latest imported ledger snapshot:

- `Ανοιχτό υπόλοιπο`
  - latest `Υπόλοιπο`
- `Προοδ. πίστωση`
  - latest `Προοδ. Πίστωση`
- ledger movement table
  - rows from `imported_customer_ledger_lines`
  - newest first
  - 5 rows per page

Branch rule:

- hide this panel in branch/substore drill-down mode
- show it at customer-total level

## Schema / Provider Notes

- runtime schema authority:
  - `lib/db/init-schema.js`
- shared MySQL import schema:
  - `../backend/sql/mysql_import_schema.sql`
- importer compatibility loader:
  - `../backend/mysql_db.py`

Current import-backed read models used by the runtime:

- `imported_orders`
- `imported_monthly_sales`
- `imported_product_sales`
- `imported_customer_branches`
- `imported_customer_ledgers`
- `imported_customer_ledger_lines`

`CUSTOMER_STATS_PROVIDER=sqlite` is still the historical provider name for the local SQL-backed provider. It does not mean the production runtime uses SQLite.

## Operational Notes

- If the DB looks correct but the live UI still shows old behavior, the deployed Node process likely needs redeploy/restart.
- The live app will not pick up backend/provider changes until the deployed process restarts.
- The ledger movement table depends on the latest receivables import, not just on legacy `imported_customer_ledgers` snapshot rows.

## Admin User Management

```bash
npm run admin:create-user -- --username=USERNAME --password=PASSWORD
```

## Tests

```powershell
cd site
npm test
```
