# Site Scripts

Operational scripts used by Plesk/local maintenance.

## Scripts

- `run-entersoft-import.js`
  - NPM-safe runner for Python importer.
  - Supports DB args and import mode.
  - Creates a timestamped log file under `site/logs/imports/` by default.
  - Honors `ENTERSOFT_IMPORT_LOG_DIR` and `ENTERSOFT_IMPORT_LOG_FILE` when set.
  - Uses an internal default timeout of `1800s` for daily/incremental runs and `10800s` for file-based/full-reload runs unless an env override is provided.

- `check-import-integrity.js`
  - Verifies imported row counts, duplicate logical sales lines, and imported-order collisions.
  - Exits non-zero if integrity checks fail.

- `nightly-import.sh`
  - Plesk scheduled-task entrypoint.
  - Historically reads a daily sales file such as `backend/today.csv`.
  - Runs importer with `--mode=incremental`.
  - Exports `ENTERSOFT_IMPORT_TIMEOUT_SECONDS=7200` by default.
  - Requires `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` to be set by the environment or scheduler.

- `manual-reload-sales.sh`
  - Server-side wrapper for a clean rebuild from canonical yearly sales files.
  - Creates a timestamped log file and runs integrity checks after the reload.
  - Exports `ENTERSOFT_IMPORT_TIMEOUT_SECONDS=7200` by default.
  - Requires `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` to be set by the environment or shell.

- `reset-business-data.js`
  - Clears business/import tables while keeping admin tables.

- `reset-and-reload-sales.js`
  - Pipeline: reset then run sales import.
  - Forces `--mode=full_refresh` unless explicitly overridden.

- `dedupe-imported-sales.js`
  - Removes historical duplicate logical sales lines from `imported_sales_lines`.
  - Rebuilds imported aggregates and mirrored customers afterwards.

## Import mode

- default: `incremental`
- optional: `full_refresh`
- optional: `replace_sales_year` with `--replace-sales-year=YYYY`

In incremental mode, history is preserved in `imported_sales_lines`.

Current practical daily workflow:

- import daily factual sales CSVs with `--sales-files=...`
- import `backend/new-kart.csv` with `--ledger-file=...`

Sales overlap handling:

- exact logical duplicates are skipped
- revised overlapping rows can replace older rows by business key when the importer can resolve a single match safely

The daily file does not need to contain only one day.
It may contain several recent days or overlap with yearly files as long as overlapping rows are logically identical.

Daily ledger note:

- `new-kart.csv` is now the current daily ledger source
- it populates both `imported_customer_ledgers` and `imported_customer_ledger_lines`
- the admin balances panel depends on that ledger import, not only on the old snapshot table

If bad history already exists in `imported_sales_lines`, run:

```powershell
$env:MYSQL_PASSWORD="YOUR_PASS"
npm run dedupe:sales -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER
```

To validate import integrity after a reload or nightly run, use:

```powershell
$env:MYSQL_PASSWORD="YOUR_PASS"
npm run check:import-integrity -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER
```

Use `full_refresh` instead when you want to rebuild from canonical yearly files.

Use `replace_sales_year` when a new yearly file should replace only one sales year while preserving older years already imported.

Example: replace existing 2026 sales rows, keep 2024/2025, then import the fresh 2026 yearly file:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
export MYSQL_PASSWORD='YOUR_PASSWORD'
npm run import:entersoft -- --mode=replace_sales_year --replace-sales-year=2026 --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-factuals.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

`npm run reload:sales -- ...` now does this automatically and records the run as `full_refresh` in `import_runs`.

Typical daily server commands:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
export MYSQL_PASSWORD='YOUR_PASSWORD'
npm run import:entersoft -- --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/cur-week.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
export MYSQL_PASSWORD='YOUR_PASSWORD'
npm run import:entersoft -- --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/new-kart.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

## Operational Notes

- Long imports should be run through these shell scripts, SSH, or Plesk Scheduled Tasks, not interactive web requests.
- A `504` in the Plesk web UI usually means the request path timed out, not that the DB necessarily failed.
- The importer uses a single transaction. If it fails before commit, other sessions may still show `0` rows and the final state may remain empty after rollback.
- `manual-reload-sales.sh` is the preferred script for a clean rebuild because it creates a timestamped log file and then runs integrity checks.
- Ad hoc `npm run import:entersoft` executions also create a dedicated importer log file under `site/logs/imports/`.
- Do not commit server credentials into these shell wrappers; keep DB configuration in host-level environment variables or scheduler configuration.
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
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site && MYSQL_PASSWORD='YOUR_DB_PASSWORD' node scripts/run-entersoft-import.js --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-factuals.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

Receivables import:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site && MYSQL_PASSWORD='YOUR_DB_PASSWORD' node scripts/run-entersoft-import.js --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-receivables.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
```

Recommended timing:

- run factuals first
- run receivables a few minutes later
- use `Errors only` notifications in Plesk

## Typical Plesk command

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders.viomes.gr/site/scripts/nightly-import.sh
```

Manual rebuild command:

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders.viomes.gr/site/scripts/manual-reload-sales.sh
```
