# Site Scripts

Operational scripts used by Plesk/local maintenance.

## Scripts

- `run-entersoft-import.js`
  - NPM-safe runner for Python importer.
  - Supports DB args and import mode.
  - Creates a timestamped log file under `site/logs/imports/` by default.
  - Honors `ENTERSOFT_IMPORT_LOG_DIR` and `ENTERSOFT_IMPORT_LOG_FILE` when set.
  - Uses an internal default timeout of `1800s` for daily/incremental runs and `10800s` for file-based/full-reload runs unless an env override is provided.

- `preflight-entersoft-import.js`
  - Validates import inputs before running the importer.
  - Checks required DB env (`MYSQL_DATABASE`, `MYSQL_USER`) and warns if `MYSQL_PASSWORD` is empty.
  - Verifies importer path, Python availability, and CSV file existence/readability.
  - Tests MySQL connectivity and reports missing import tables as warnings.
  - Supports the same non-secret CLI DB overrides as the importer (`--mysql-host`, `--mysql-port`, `--mysql-database`, `--mysql-user`).

- `check-import-integrity.js`
  - Verifies imported row counts, duplicate logical sales lines, and imported-order collisions.
  - Exits non-zero if integrity checks fail.

- `reset-business-data.js`
  - Clears business/import tables while keeping admin tables.

- `reset-and-reload-sales.js`
  - Pipeline: reset then run sales import.
  - Forces `--mode=full_refresh` unless explicitly overridden.

- `dedupe-imported-sales.js`
  - Removes historical duplicate logical sales lines from `imported_sales_lines`.
  - Rebuilds imported aggregates and mirrored customers afterwards.

### Order catalog pipeline

The order form's catalog is `site/public/catalog.json`. It is regenerated from the
`products` table, which the server also validates order quantities against — so the
`products` table, not the JSON, is the thing that has to track ES1. Two steps:

```
exports/products.csv  ──▶  sync-products-from-csv.js   ──▶  products table
                      ──▶  generate-catalog-from-db.js  ──▶  public/catalog.json
```

- `sync-products-from-csv.js` (`npm run sync:catalog`)
  - Upserts the `products` table from a fresh ES1 item export (`exports/products.csv`, tab-separated).
  - Membership: keeps `Χ5-orders = 1`, drops `X6-Private Label = 1`, drops "mixed content" movement-control SKUs. In-scope codes get `orderable = 1`; everything else gets `orderable = 0` (rows are never deleted — `order_lines.product_id` references `products.id`).
  - From the CSV: `code`, `description`, `color`, `pieces_per_package` (`Υποσυσκευασία` else `Συσκευασία`). Not in the CSV: `volume_liters` is preserved from the existing row by code (0 + logged for brand-new codes); `image_url` is computed from the code (`…/packshot_photos/viomes_<code>.jpg`).
  - Before any write it dumps the current table + a `rollback-<ts>.sql` to `site/logs/catalog-sync/`, and always writes `catalog-sync-anomalies.json` (new codes at volume 0, pack fallbacks, de-flagged codes, mixed-content skips). Refuses to run if >200 codes would be de-flagged in one pass unless `--force`.
  - Flags: `--input=<path>` (default `D:/Desktop/programming/viomes/viomes_db/exports/products.csv`), `--dry-run` (backup + anomalies only, no DB writes), `--log-dir=<path>`, `--force`, and the same non-secret `--mysql-*` overrides as the importer scripts.

- `generate-catalog-from-db.js` (`npm run generate:catalog`)
  - Generates `site/public/catalog.json` from `products WHERE orderable = 1`.
  - Supports `--output`, `--dry-run`, and the non-secret `--mysql-*` overrides.
  - Run it right after `sync:catalog`, then review the diff and upload `catalog.json`.

Example (production DB):

```bash
cd site
# 1. dry run — review site/logs/catalog-sync/ before the real run
MYSQL_PASSWORD='YOUR_DB_PASSWORD' npm run sync:catalog -- --dry-run --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
# 2. apply
MYSQL_PASSWORD='YOUR_DB_PASSWORD' npm run sync:catalog -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
# 3. regenerate catalog.json + review the diff
MYSQL_PASSWORD='YOUR_DB_PASSWORD' npm run generate:catalog -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
git -C .. diff -- site/public/catalog.json
```

- `generate-catalog-from-products-csv.js` (`npm run generate:catalog:csv`, legacy)
  - Wrote `catalog.json` straight from `exports/products.csv`, bypassing the `products` table — so the server kept validating against stale table data. Superseded by the two-step pipeline above; kept for reference.

- `generate-catalog-from-xlsx.py` (legacy, superseded)
  - Generated `site/public/catalog.json` from an Excel source (default: `backend/archive/legacy-inputs/products.xlsx`), decoupled from the `products` table.
  - This is what caused a large drift between catalog.json and the database (1,187 pack-size mismatches, 381 products missing from the catalog entirely) before `generate-catalog-from-db.js` replaced it. Kept only for reference; do not use it to regenerate catalog.json going forward.

## Import mode

- default: `incremental`
- optional: `full_refresh`
- optional: `replace_sales_year` with `--replace-sales-year=YYYY`

In incremental mode, history is preserved in `imported_sales_lines`.

Current practical daily workflow:

- upload `backend/yearly-factuals.csv`
- upload `backend/yearly-receivables.csv`
- replace only sales year `2026`
- replace the full ledger snapshot

Sales overlap handling:

- exact logical duplicates are skipped
- revised overlapping rows can replace older rows by business key when the importer can resolve a single match safely

Current ledger note:

- `yearly-receivables.csv` is the current scheduled ledger source
- it populates both `imported_customer_ledgers` and `imported_customer_ledger_lines`
- the admin balances panel depends on that ledger import, not only on the old snapshot table

If bad history already exists in `imported_sales_lines`, run:

```powershell
$env:MYSQL_PASSWORD="YOUR_PASS"
npm run dedupe:sales -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER
```

To validate import integrity after an import run, use:

```powershell
$env:MYSQL_PASSWORD="YOUR_PASS"
npm run check:import-integrity -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER
```

Use `full_refresh` instead when you want to rebuild from canonical yearly files.

Use `replace_sales_year` when a new yearly file should replace only one sales year while preserving older years already imported.

Run a preflight check before each manual or scheduled import:

```powershell
$env:MYSQL_PASSWORD="YOUR_PASS"
npm run preflight:import -- --mode=replace_sales_year --replace-sales-year=2026 --sales-files=../backend/yearly-factuals.csv --ledger-file=../backend/yearly-receivables.csv --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER
```

If preflight fails, do not run the importer until the reported errors are fixed.

Example: replace existing 2026 sales rows, keep 2024/2025, then import the fresh 2026 yearly file:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
export MYSQL_PASSWORD='YOUR_PASSWORD'
npm run import:entersoft -- --mode=replace_sales_year --replace-sales-year=2026 --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-factuals.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

`npm run reload:sales -- ...` still does a full rebuild and records the run as `full_refresh` in `import_runs`.

## Operational Notes

- Long imports should be run through direct shell commands, SSH, or Plesk Scheduled Tasks, not interactive web requests.
- A `504` in the Plesk web UI usually means the request path timed out, not that the DB necessarily failed.
- The importer uses a single transaction. If it fails before commit, other sessions may still show `0` rows and the final state may remain empty after rollback.
- Ad hoc `npm run import:entersoft` executions also create a dedicated importer log file under `site/logs/imports/`.
- Keep DB configuration in host-level environment variables or scheduler configuration.
- Do not pass `MYSQL_PASSWORD` as a CLI flag. Keep it in the environment so it does not leak through shell history or process listings.

## Daily Upload Workflow

If the daily export runs on another computer and direct SSH access is not available there, use this pattern:

1. Upload the latest CSVs to the server `backend` folder over SFTP/FTP.
2. Keep stable server-side filenames:
   - `yearly-factuals.csv`
   - `yearly-receivables.csv`
3. Let Plesk Scheduled Tasks run the importer commands on the server.

Known hosting details from current production setup:

- SFTP/SSH system user: `viomesad`
- Server IP: `213.158.90.203`
- Plesk shows shell access as `/bin/bash (chrooted)`

Because the account is chrooted, confirm the visible SFTP path once manually before automating uploads. The intended target folder is the project `backend` directory for `orders.viomes.gr`.

Example PowerShell + WinSCP upload flow on the export machine:

```powershell
param(
  [string]$WinScpPath = "C:\Program Files (x86)\WinSCP\WinSCP.com",
  [string]$HostName = "213.158.90.203",
  [int]$Port = 22,
  [string]$UserName = "viomesad",
  [string]$Password = "YOUR_PLESK_SYSTEM_USER_PASSWORD",
  [string]$RemoteDir = "/var/www/vhosts/viomes.gr/orders.viomes.gr/backend",
  [string]$FactualsFile = "C:\Exports\yearly-factuals.csv",
  [string]$ReceivablesFile = "C:\Exports\yearly-receivables.csv"
)

$scriptFile = Join-Path $env:TEMP "winscp-upload-viomes.txt"
$winscpScript = @"
open sftp://$UserName`:$Password@$HostName`:$Port -hostkey=*
cd "$RemoteDir"
put "$FactualsFile" "yearly-factuals.csv"
put "$ReceivablesFile" "yearly-receivables.csv"
exit
"@

Set-Content -Path $scriptFile -Value $winscpScript -Encoding ASCII
& $WinScpPath "/script=$scriptFile"
Remove-Item $scriptFile -Force -ErrorAction SilentlyContinue
```

Recommended Plesk Scheduled Tasks:

Factuals import:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site && MYSQL_PASSWORD='YOUR_DB_PASSWORD' node scripts/run-entersoft-import.js --mode=replace_sales_year --replace-sales-year=2026 --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-factuals.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

Receivables import:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site && MYSQL_PASSWORD='YOUR_DB_PASSWORD' node scripts/run-entersoft-import.js --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-receivables.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

Recommended timing:

- run factuals first
- run receivables a few minutes later
- run integrity check after both
- use `Errors only` notifications in Plesk
