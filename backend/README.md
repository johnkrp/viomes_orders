# Backend Layer

This folder now mainly hosts import tooling and data files for Entersoft.

## Active files

- `import_entersoft.py`: core CSV -> MySQL importer
- `mysql_db.py`: MySQL connection + schema init for importer
- `ENTERSOFT_IMPORT_README.md`: importer behavior, modes, commands
- `2025.CSV`, `2026.CSV`: baseline historical sales files (optional after initial load)
- `today.csv`: daily file consumed by nightly incremental import

## Current architecture

- Node app (`site/server.js`) is the runtime backend.
- Python in this folder is import/ETL only.
- Imported data lands in MySQL tables and is consumed by Node API.

Supported matrix:

- Supported production data path: Python importer -> MySQL -> Node runtime
- Not a supported production path: legacy FastAPI/SQLite backend files in this folder

Source-of-truth table layout:

- operational tables owned by runtime: `products`, `admin_users`, `admin_sessions`
- ingestion tables owned by importer: `import_runs`, `imported_sales_lines`
- rebuildable projections: `imported_customers`, `imported_orders`, `imported_monthly_sales`, `imported_product_sales`
- mirrored projection target: `customers` rows with `source='entersoft_import'`
- legacy/dormant compatibility tables: `orders`, `order_lines`, `customer_receivables`

Schema ownership note:

- the Node runtime schema initializer in `site/lib/db/init-schema.js` is the primary authority
- shared MySQL import-table DDL now lives in `sql/mysql_import_schema.sql`
- `mysql_db.py` loads that shared SQL for importer startup and should not diverge from the Node schema

Importer helper regression checks:

```powershell
python -m unittest discover -s backend/tests
```

## Legacy files

Some files may still exist for old flows (FastAPI/SQLite/demo). They are not part of current production runtime.
Examples: `main.py`, `db.py`, `app.db`, old `info_*.csv`, `customers.csv`, demo seed tools.

## Practical rule

If a file is not used by `import_entersoft.py` or current Node scripts, treat it as legacy unless explicitly re-enabled.

`import_runs` now acts as the import ledger for:

- import mode
- source file metadata and checksum
- duplicate skips / rejected rows
- projection rebuild timing
- schema version and trigger source
