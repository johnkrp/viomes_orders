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
  - Reads `backend/today.csv`.
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

In incremental mode, history is preserved in `imported_sales_lines` and duplicate logical sales lines are skipped even if the source filename changes.

The daily file does not need to contain only one day.
It may contain several recent days or overlap with yearly files as long as overlapping rows are logically identical.

If bad history already exists in `imported_sales_lines`, run:

```powershell
npm run dedupe:sales -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

To validate import integrity after a reload or nightly run, use:

```powershell
npm run check:import-integrity -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Use `full_refresh` instead when you want to rebuild from canonical yearly files.

`npm run reload:sales -- ...` now does this automatically and records the run as `full_refresh` in `import_runs`.

## Operational Notes

- Long imports should be run through these shell scripts, SSH, or Plesk Scheduled Tasks, not interactive web requests.
- A `504` in the Plesk web UI usually means the request path timed out, not that the DB necessarily failed.
- The importer uses a single transaction. If it fails before commit, other sessions may still show `0` rows and the final state may remain empty after rollback.
- `manual-reload-sales.sh` is the preferred script for a clean rebuild because it creates a timestamped log file and then runs integrity checks.
- Ad hoc `npm run import:entersoft` executions also create a dedicated importer log file under `site/logs/imports/`.
- Do not commit server credentials into these shell wrappers; keep DB configuration in host-level environment variables or scheduler configuration.

## Typical Plesk command

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders.viomes.gr/site/scripts/nightly-import.sh
```

Manual rebuild command:

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders.viomes.gr/site/scripts/manual-reload-sales.sh
```
