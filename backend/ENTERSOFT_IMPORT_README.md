# Entersoft Import (Current)

## Scope

The importer is now sales-file-only.

- No `customers.csv` input is required.
- Customers are rebuilt from imported sales lines.
- Target runtime DB is MySQL/MariaDB.

## Input Files

Default files (if no override is provided):

- `backend/2025.CSV`
- `backend/2026.CSV`

Optional daily mode:

- `ENTERSOFT_DAILY_INFO_FILE=/absolute/path/daily_info.csv`

Optional explicit multi-file mode:

- `ENTERSOFT_SALES_FILES=/path/a.csv,/path/b.csv`

Priority order:

1. `ENTERSOFT_SALES_FILES`
2. `ENTERSOFT_DAILY_INFO_FILE`
3. default `2025.CSV` + `2026.CSV`

## Required DB Environment

- `MYSQL_HOST` (default `127.0.0.1`)
- `MYSQL_PORT` (default `3306`)
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

## What the Importer Writes

Raw/normalized:

- `imported_sales_lines`

Derived aggregates:

- `imported_orders`
- `imported_monthly_sales`
- `imported_product_sales`

Customer mirror (rebuilt from sales):

- `imported_customers`
- `customers` (with `source = 'entersoft_import'`)

Run tracking:

- `import_runs`

## Run Commands

From repo root:

```powershell
python backend\import_entersoft.py
```

From `site/` (Plesk npm runner):

```powershell
npm run import:entersoft -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

With explicit sales files:

```powershell
npm run import:entersoft -- --sales-files=/abs/path/2025.CSV,/abs/path/2026.CSV --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

With daily file:

```powershell
npm run import:entersoft -- --daily-info-file=/abs/path/daily_info.csv --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

## Validation Queries

```sql
SELECT COUNT(*) FROM imported_sales_lines;
SELECT COUNT(*) FROM imported_orders;
SELECT COUNT(*) FROM imported_monthly_sales;
SELECT COUNT(*) FROM imported_product_sales;
SELECT COUNT(*) FROM imported_customers;
SELECT COUNT(*) FROM customers WHERE source = 'entersoft_import';
```

## Notes

- Receivables are not imported yet.
- Import writes are full refresh for imported tables.
- If import blocks on locks, stop Node app and retry.
