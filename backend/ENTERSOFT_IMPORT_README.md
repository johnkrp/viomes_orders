# Entersoft Import (Current)

## Scope

The importer is now sales-file-only.

- No `customers.csv` input is required.
- Customers are rebuilt from imported sales lines.
- Target runtime DB is MySQL/MariaDB.
- Default mode is incremental (`ENTERSOFT_IMPORT_MODE=incremental`).

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
- `import_runs` is the ingestion ledger and should be treated as operational telemetry, not just a success/failure row.

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

This daily file does not need to contain only "today".
It may contain several recent days or overlap with the canonical yearly file(s); the importer is designed to skip duplicate logical sales lines when the row content matches.

Force full refresh mode (clears `imported_sales_lines` first):

```powershell
npm run import:entersoft -- --mode=full_refresh --sales-files=/abs/path/2025.CSV,/abs/path/2026.CSV --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Cleanup historical duplicates already stored in `imported_sales_lines`:

```powershell
cd site
npm run dedupe:sales -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Run integrity checks after reload/import:

```powershell
cd site
npm run check:import-integrity -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

## Validation Queries

```sql
SELECT COUNT(*) FROM imported_sales_lines;
SELECT COUNT(*) FROM imported_orders;
SELECT COUNT(*) FROM imported_monthly_sales;
SELECT COUNT(*) FROM imported_product_sales;
SELECT COUNT(*) FROM imported_customers;
SELECT COUNT(*) FROM customers WHERE source = 'entersoft_import';

SELECT
  COUNT(*) AS duplicate_groups,
  COALESCE(SUM(group_size - 1), 0) AS duplicate_rows
FROM (
  SELECT COUNT(*) AS group_size
  FROM imported_sales_lines
  GROUP BY
    order_date,
    document_no,
    document_type,
    item_code,
    item_description,
    unit_code,
    qty,
    qty_base,
    unit_price,
    net_value,
    customer_code,
    customer_name,
    delivery_code,
    delivery_description,
    account_code,
    account_description,
    branch_code,
    branch_description,
    note_1
  HAVING COUNT(*) > 1
) duplicate_groups;

SELECT document_no, customer_code, created_at, COUNT(*)
FROM imported_orders
GROUP BY document_no, customer_code, created_at
HAVING COUNT(*) > 1;
```

## Notes

- Receivables are not imported yet.
- Incremental mode now skips duplicate logical sales lines even if the source filename changes.
- `imported_sales_lines` is the canonical raw imported-sales fact table.
- `imported_orders`, `imported_monthly_sales`, `imported_product_sales`, and `imported_customers` are rebuildable projections only.
- `customers` rows with `source='entersoft_import'` are a mirror/projection target, not the primary customer master.
- Existing historical duplicates already present in `imported_sales_lines` are not removed automatically by an incremental run; use `npm run dedupe:sales` or `full_refresh` if cleanup is needed.
- `dedupe:sales` preserves the earliest `imported_sales_lines.id` per logical sales line, deletes the rest, and then rebuilds all derived import tables plus mirrored customers.
- `imported_orders.order_id` is now a synthetic value: `{customer_code}::{order_date}::{document_no}`.
- `imported_orders`, `imported_monthly_sales`, `imported_product_sales`, and `imported_customers` are rebuilt from the full `imported_sales_lines` history on each run.
- `import_runs` now records import mode, file checksums, duplicate skips, rejected rows, rebuild timing, schema version, and trigger source.
- If import blocks on locks, stop Node app and retry.

## Troubleshooting

- The importer uses a single transaction. If any late step fails, everything rolls back and counts may stay at `0`.
- If `reset-business-data` succeeded but the later import failed, business/import tables remain empty until a successful import or reload completes.
- `Query execution was interrupted (max_statement_time exceeded)` means MySQL killed a long-running statement in the current session. The importer now attempts to disable `max_statement_time` for its own session before heavy rebuild queries.
- `Lock wait timeout exceeded` means another session is holding locks on the same tables. Stop the Node app and any overlapping maintenance/import tasks, then retry.
- `timed out after 1800s and was terminated` comes from the Node wrapper, not MySQL. Shell wrappers now export `ENTERSOFT_IMPORT_TIMEOUT_SECONDS=7200` by default.
- A `504` error from the Plesk web UI usually indicates the web request timed out. Run long imports through shell scripts, SSH, or Scheduled Tasks and inspect the log file instead of relying on the web request response.
