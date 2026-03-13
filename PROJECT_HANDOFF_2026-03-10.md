# Project Handoff - 2026-03-12

This file captures the current working state after the latest runtime, import, DB, and admin-panel changes.

## Active Production Shape

- Active runtime app: `site/app.js` + `site/server.js`
- Active frontend:
  - public order form: `site/public/index.html`, `site/public/order-form.js`
  - admin dashboard: `site/public/admin.html`, `site/public/admin.js`
- Active import pipeline:
  - importer: `backend/import_entersoft.py`
  - schema helpers: `backend/mysql_db.py`, `backend/sql/mysql_import_schema.sql`
  - Node wrappers: `site/scripts/*`
- Active production DB: MariaDB/MySQL on remote host `213.158.90.203`

Legacy FastAPI code under `backend/app/*` and `backend/main.py` is dormant/reference-only.

## Daily Operating Rules

Current daily uploads to the server:

- `backend/new-kart.csv`
  - daily customer-ledger export
  - source of truth for the admin balances/ledger panel
- daily factual sales CSVs
  - imported incrementally into `imported_sales_lines`

Not the primary daily app inputs anymore:

- `backend/karteles.csv`
- `backend/eispr*.csv`

## Current Balance / Ledger Model

The admin balances panel no longer behaves like invoice aging.

It now reflects the daily ledger export from `new-kart.csv`:

- `Ανοιχτό υπόλοιπο` = latest `Υπόλοιπο`
- second card = latest `Προοδ. Πίστωση`
- table = daily ledger movements, newest first
- table pagination = 5 rows per page

The panel is customer-level only and should stay hidden on branch/substore drill-down.

## Current Ledger Import Shape

`new-kart.csv` is imported into two tables:

- `imported_customer_ledgers`
  - latest per-customer snapshot
- `imported_customer_ledger_lines`
  - all imported ledger movement rows

Important persisted fields for ledger lines:

- `customer_code`
- `customer_name`
- `document_date`
- `document_no`
- `reason`
- `debit`
- `credit`
- `running_debit`
- `running_credit`
- `ledger_balance`
- `source_file`
- `imported_at`

## Sales Import / Classification State

Important completed work:

- document-type classification now excludes non-sales/internal document types from analytics
- credit/return document types affect revenue with sign rules
- discount fallback exists for historical data when CSV discount columns are zero:
  - derived from `net_value / (qty * unit_price)`
- overlapping revised sales rows are now replaced by business key instead of being blindly duplicated

## Current Import / DB Commands

### Daily sales import on server

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/cur-week.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

### Dedupe after sales import

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run dedupe:sales -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

### Integrity check after dedupe

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run check:import-integrity -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

### Daily ledger import on server

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/new-kart.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_PASSWORD'
```

## Important Production Lessons From This Chat

- same-origin browser login/logout 500s were caused by CORS behavior and were fixed in code; redeploy/restart is required for production to pick up fixes
- when the UI changed but values stayed empty, the root cause was often a stale deployed Node process, not a bad DB import
- `new-kart.csv` data can already be present in the DB while the live app still shows old behavior if the runtime was not restarted
- local testing preference:
  - when the user asks for real validation, prefer the actual deployed app or the real runtime/API path
  - do not rely on demo/mock servers unless explicitly requested

## Important Commits From This Chat

- `28d741a` Optimize imported customer stats queries
- `89c58aa` Classify imported documents and round discount values
- `0cedc92` Allow same-origin browser auth requests
- `f1e6fd6` Import karteles snapshot into admin balances
- `4481d9e` Fix ledger email upsert for MariaDB
- `d89bf40` Switch ledger snapshot import to new ledger export
- `7c5470a` Convert balances panel to daily ledger view
- `03aa1e6` Fix ledger panel text encoding
- `dce8daf` Paginate ledger movements table

## Current Known Truths

- production analytics are Node + MySQL only
- `imported_sales_lines` is the canonical raw sales fact table
- sales projections are rebuildable
- ledger/balance view is now driven by `new-kart.csv`, not `karteles.csv`
- `eispr*.csv` is useful for payment history, but is not the current source of truth for the admin balance panel

## Current Local-Only Data Files

These are intentionally not committed:

- `backend/cur-week.csv`
- `backend/eispr1003.csv`
- `backend/karteles.csv`
- `backend/new-kart.csv`
- `backend/ΠΑΡΑΣΤΑΤΙΚΑ.CSV`

## Recommended Next Chat Starting Point

1. Check `git status`.
2. Confirm deployed `main` matches the expected commit.
3. If a live UI mismatch appears, verify:
   - latest deploy is live
   - app process restarted
   - latest import run succeeded
4. Treat `new-kart.csv` + daily factual sales CSVs as the current operational import model.
