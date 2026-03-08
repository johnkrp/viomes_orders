# Site Scripts

Operational scripts used by Plesk/local maintenance.

## Scripts

- `run-entersoft-import.js`
  - NPM-safe runner for Python importer.
  - Supports DB args and import mode.

- `check-import-integrity.js`
  - Verifies imported row counts, duplicate logical sales lines, and imported-order collisions.
  - Exits non-zero if integrity checks fail.

- `nightly-import.sh`
  - Plesk scheduled-task entrypoint.
  - Reads `backend/today.csv`.
  - Runs importer with `--mode=incremental`.

- `manual-reload-sales.sh`
  - Server-side wrapper for a clean rebuild from canonical yearly sales files.
  - Creates a timestamped log file and runs integrity checks after the reload.

- `reset-business-data.js`
  - Clears business/import tables while keeping admin tables.

- `reset-and-reload-sales.js`
  - Pipeline: reset then run sales import.

- `dedupe-imported-sales.js`
  - Removes historical duplicate logical sales lines from `imported_sales_lines`.
  - Rebuilds imported aggregates and mirrored customers afterwards.

## Import mode

- default: `incremental`
- optional: `full_refresh`

In incremental mode, history is preserved in `imported_sales_lines` and duplicate logical sales lines are skipped even if the source filename changes.

If bad history already exists in `imported_sales_lines`, run:

```powershell
npm run dedupe:sales -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

To validate import integrity after a reload or nightly run, use:

```powershell
npm run check:import-integrity -- --mysql-host=127.0.0.1 --mysql-port=3306 --mysql-database=YOUR_DB --mysql-user=YOUR_USER --mysql-password=YOUR_PASS
```

Use `full_refresh` instead when you want to rebuild from canonical yearly files.

## Typical Plesk command

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/scripts/nightly-import.sh
```

Manual rebuild command:

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/scripts/manual-reload-sales.sh
```
