# Site Scripts

Operational scripts used by Plesk/local maintenance.

## Scripts

- `run-entersoft-import.js`
  - NPM-safe runner for Python importer.
  - Supports DB args and import mode.

- `nightly-import.sh`
  - Plesk scheduled-task entrypoint.
  - Reads `backend/today.csv`.
  - Runs importer with `--mode=incremental`.

- `reset-business-data.js`
  - Clears business/import tables while keeping admin tables.

- `reset-and-reload-sales.js`
  - Pipeline: reset then run sales import.

## Import mode

- default: `incremental`
- optional: `full_refresh`

In incremental mode, history is preserved in `imported_sales_lines` and exact duplicates are skipped by DB unique key.

## Typical Plesk command

```bash
/bin/bash /var/www/vhosts/viomes.gr/orders-test.viomes.gr/site/scripts/nightly-import.sh
```
