# VIOMES Order Form

Latest session handoff:

- `PROJECT_HANDOFF_2026-03-13.md`

This repo currently consists of two connected systems:

- `site/`
  - active Node.js runtime
  - serves the public order form and the admin dashboard
- `backend/`
  - active Python import/ETL tooling
  - imports Entersoft exports into MySQL/MariaDB

The active production path is Node + MySQL. The old FastAPI code now lives under `backend/legacy_fastapi/` and is dormant/reference-only.

## Current Production Architecture

- Runtime app:
  - `site/app.js`
  - `site/server.js`
- Import pipeline:
  - `backend/import_entersoft.py`
  - `site/scripts/run-entersoft-import.js`
- Production DB:
  - MySQL/MariaDB
  - current real host: `213.158.90.203`

Core data layout:

- operational:
  - `products`
  - `admin_users`
  - `admin_sessions`
- ingestion:
  - `import_runs`
  - `imported_sales_lines`
- projections:
  - `imported_customers`
  - `imported_orders`
  - `imported_monthly_sales`
  - `imported_product_sales`
  - `imported_customer_branches`
  - `imported_customer_ledgers`
  - `imported_customer_ledger_lines`
  - mirrored `customers`

`imported_sales_lines` remains the canonical raw sales fact table. The other `imported_*` tables are rebuildable projections or import-backed read models.

## What Changed Recently

Important current behavior:

- admin customer stats are projection-first and MySQL-backed
- admin login/logout same-origin browser requests were fixed in the runtime CORS layer
- sales importer now classifies document types instead of counting every raw row as a sale
- revised overlapping sales rows now replace older rows by business key instead of duplicating blindly
- the admin balances panel is now a daily ledger view, not an invoice-aging panel

## Daily Import Model

Current daily operational inputs:

- `backend/yearly-factuals.csv`
  - scheduled sales import
  - replaces only the current sales year in `imported_sales_lines`
- `backend/yearly-receivables.csv`
  - scheduled customer ledger snapshot
  - replaces `imported_customer_ledgers` and `imported_customer_ledger_lines`

No longer the primary daily app inputs:

- `backend/karteles.csv`
- `backend/eispr*.csv`
- `backend/new-kart.csv`

## Admin Balances / Ledger Panel

The admin panel no longer treats this area as open-invoice aging.

It now uses the latest imported ledger snapshot and shows:

- `Ανοιχτό υπόλοιπο`
  - latest `Υπόλοιπο`
- `Προοδ. πίστωση`
  - latest `Προοδ. Πίστωση`
- movement table
  - ledger rows from `imported_customer_ledger_lines`
  - newest first
  - 5 rows per page

The ledger panel is customer-level only and should remain hidden in branch/substore drill-down mode.

## Run The Runtime

From `site/`:

```powershell
npm install
npm run start
```

Expected env:

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

## Import Commands

### Replace current sales year from uploaded factuals

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --mode=replace_sales_year --replace-sales-year=2026 --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-factuals.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

### Dedupe after daily sales import

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run dedupe:sales -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

### Integrity check after dedupe

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run check:import-integrity -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

### Replace ledger snapshot from uploaded receivables

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-receivables.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

### Full reset + reload from canonical yearly sales files

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run reload:sales -- --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/2025.CSV,/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/2026.CSV --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

## Important Operational Notes

- Long imports should be run from shell or scheduled tasks, not interactive browser requests.
- Keep `MYSQL_PASSWORD` in the shell, scheduler, or host environment. Do not pass it as a CLI flag.
- For daily off-server exports, the intended pattern is: upload `yearly-factuals.csv` and `yearly-receivables.csv` into the server `backend` folder via SFTP/FTP, then let Plesk Scheduled Tasks run the direct importer commands. See [site/scripts/README.md](/d:/Desktop/programming/viomes/order_form/site/scripts/README.md) for the current WinSCP/PowerShell and Plesk command examples.
- If the DB looks correct but the UI still shows old behavior, the deployed Node app likely needs redeploy/restart.
- Same-origin runtime fixes do not take effect until the deployed app process is restarted.
- The active receivables import populates both:
  - `imported_customer_ledgers`
  - `imported_customer_ledger_lines`

## Tests

Node regression suite:

```powershell
cd site
npm test
```

Python importer tests:

```powershell
python -m unittest discover -s backend/tests
```
