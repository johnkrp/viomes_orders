# Backend Layer

This folder is the active import/ETL layer for the production Node app.

## Active Responsibilities

- import Entersoft sales CSVs into MySQL/MariaDB
- rebuild sales projections used by the admin dashboard
- import the daily customer ledger export used by the balances panel

Main files:

- `import_entersoft.py`
  - core importer
- `mysql_db.py`
  - DB connection + shared schema loader
- `sql/mysql_import_schema.sql`
  - shared import-table DDL
- `ENTERSOFT_IMPORT_README.md`
  - lower-level import behavior/details

## Current Supported Production Path

```text
Python importer -> MySQL/MariaDB -> Node runtime in site/
```

Not a supported production path:

- legacy FastAPI backend files under `legacy_fastapi/`
- old SQLite/demo flows unless explicitly re-enabled

## Current Daily Inputs

Daily operational inputs going forward:

- `yearly-factuals.csv`
  - scheduled sales import
  - replaces only the current sales year in `imported_sales_lines`
- `yearly-receivables.csv`
  - scheduled ledger snapshot
  - replaces `imported_customer_ledgers` and `imported_customer_ledger_lines`

No longer the primary daily app import inputs:

- `karteles.csv`
- `eispr*.csv`
- `new-kart.csv`

## Current Import Outputs

Sales import outputs:

- `imported_sales_lines`
- `imported_customers`
- `imported_orders`
- `imported_monthly_sales`
- `imported_product_sales`
- `imported_customer_branches`

Daily ledger import outputs:

- `imported_customer_ledgers`
  - latest row per customer
- `imported_customer_ledger_lines`
  - all movement rows from the current receivables snapshot

Important ledger line fields:

- `customer_code`
- `customer_name`
- `document_date`
- `document_no`
- `reason`
- `debit`
- `credit`
- `running_debit`
- `running_credit`
- `ledger_balance`
- `source_file`
- `imported_at`

## Important Import Behavior

### Sales rows

- `imported_sales_lines` is the canonical raw sales fact table
- overlapping revised rows now replace older rows by business key when possible
- document-type rules decide which rows count toward sales analytics
- historical discount fallback derives discount from:
  - `net_value / (qty * unit_price)`
  - when imported discount columns are zero

### Current ledger file

- `yearly-receivables.csv` is treated as the current scheduled ledger source
- importer replaces the previous ledger snapshot/movement dataset deterministically
- latest per-customer row feeds the admin summary cards
- full movement rows feed the admin ledger table

## Commands

### Replace current sales year from uploaded factuals

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --mode=replace_sales_year --replace-sales-year=2026 --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-factuals.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

### Replace ledger snapshot from uploaded receivables

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-receivables.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

### Dedupe sales history

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run dedupe:sales -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

### Integrity check

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run check:import-integrity -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

## Practical Rule

If a file is not used by `import_entersoft.py` or the current Node wrappers in `site/scripts/`, treat it as legacy/reference-only unless explicitly brought back into the workflow.

## Tests

```powershell
python -m unittest discover -s backend/tests
```

## Shared Lifecycle Artifact

If you change `factual_rules.csv`, regenerate the checked-in lifecycle artifact:

```powershell
python backend/generate_factual_lifecycle_rules.py
```
