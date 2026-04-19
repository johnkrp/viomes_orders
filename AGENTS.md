# AGENTS

Read this first before changing code in this repo.

## Active systems

- `site/` is the active Node.js/Express app for the public order form and admin dashboard.
- `backend/` is the active Python import and ETL layer for Entersoft CSVs into MySQL/MariaDB.
- The production database is MySQL/MariaDB; do not assume SQLite.
- `backend/legacy_fastapi/` is dormant and reference-only.

## What to check first

- Start with `README.md` and `docs/project-map.md`.
- Runtime entrypoints: `site/app.js` and `site/server.js`.
- Frontend entrypoints: `site/public/index.html`, `site/public/order-form.js`, `site/public/admin.html`, `site/public/admin.js`.
- Importer files: `backend/import_entersoft.py`, `backend/mysql_db.py`, `backend/sql/mysql_import_schema.sql`, `site/scripts/run-entersoft-import.js`.

## Validation

- For order-form or admin UI work, run `site` npm test when relevant.
- For importer work, run `python -m unittest discover -s backend/tests` when relevant.
- If live behavior seems stale, a deployed Node restart may be needed.

## Avoid common traps

- Do not assume the dormant FastAPI code is current.
- Do not change database assumptions to SQLite.
- Do not skip validation on UI or importer changes when the work touches those paths.

## Notes

- Keep changes focused and aligned with the active runtime and importer flow.
- Treat the docs above as the source of truth for repo structure and ownership.

## Live deployment

- Site: https://orders.viomes.gr
- Hosted on shared Plesk
- Deployment repo: https://github.com/johnkrp/viomes_orders.git
- Live DB: host 213.158.90.203, port 3306, database admin_viomes_orders, user admin_viomes_app
- After each repo change, pull/deploy so the live site stays current
