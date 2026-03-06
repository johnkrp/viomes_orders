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

## Legacy files

Some files may still exist for old flows (FastAPI/SQLite/demo). They are not part of current production runtime.
Examples: `main.py`, `db.py`, `app.db`, old `info_*.csv`, `customers.csv`, demo seed tools.

## Practical rule

If a file is not used by `import_entersoft.py` or current Node scripts, treat it as legacy unless explicitly re-enabled.
