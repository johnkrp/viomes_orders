# VIOMES Order Form

This repo currently consists of two connected systems:

- `site/`
  - active Node.js runtime
  - serves the public order form and the admin dashboard
- `backend/`
  - active Python import/ETL tooling
  - imports Entersoft exports into MySQL/MariaDB

The active production path is Node + MySQL. The old FastAPI code under `backend/app/*` and `backend/main.py` is dormant/reference-only.

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

- daily sales/factual CSVs
  - imported incrementally into `imported_sales_lines`
- `backend/new-kart.csv`
  - daily customer ledger export
  - source of truth for the balances/ledger panel in admin

No longer the primary daily app inputs:

- `backend/karteles.csv`
- `backend/eispr*.csv`

## Admin Balances / Ledger Panel

The admin panel no longer treats this area as open-invoice aging.

It now uses `new-kart.csv` and shows:

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

### Incremental daily sales import

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/cur-week.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

### Dedupe after daily sales import

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run dedupe:sales -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

### Integrity check after dedupe

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run check:import-integrity -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

### Daily ledger import

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/new-kart.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

### Full reset + reload from canonical yearly sales files

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run reload:sales -- --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/2025.CSV,/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/2026.CSV --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

## Important Operational Notes

- Long imports should be run from shell or scheduled tasks, not interactive browser requests.
- For daily off-server exports, the intended pattern is: upload `yearly-factuals.csv` and `yearly-receivables.csv` into the server `backend` folder via SFTP/FTP, then let Plesk Scheduled Tasks run the importer commands. See [site/scripts/README.md](/d:/Desktop/programming/viomes/order_form/site/scripts/README.md) for the current WinSCP/PowerShell and Plesk command examples.
- If the DB looks correct but the UI still shows old behavior, the deployed Node app likely needs redeploy/restart.
- Same-origin runtime fixes do not take effect until the deployed app process is restarted.
- `new-kart.csv` import populates both:
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
