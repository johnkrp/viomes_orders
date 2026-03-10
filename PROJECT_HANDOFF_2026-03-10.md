# Project Handoff - 2026-03-10

This file captures the important work completed in the current collaboration so a future scan of the repo can continue from the right state quickly.

## Current Product Shape

- Active runtime app: `site/server.js`
- Active frontend:
  - public order form: `site/public/index.html`, `site/public/order-form.js`
  - admin dashboard: `site/public/admin.html`, `site/public/admin.js`, `site/public/styles.css`
- Active import pipeline:
  - importer: `backend/import_entersoft.py`
  - MySQL schema helpers: `backend/mysql_db.py`, `backend/sql/mysql_import_schema.sql`
  - wrappers/scripts: `site/scripts/*`
- Active DB: MariaDB on the remote server, with import-backed analytics tables as the real production data source.

## Architecture Decisions Made

### Database

- Keep one physical MariaDB database for now.
- Treat the schema as logically split into:
  - operational: admin/auth and product catalog
  - ingestion: raw imported sales and import ledger
  - projections: rebuildable customer/order/month/product aggregates
- `imported_sales_lines` is the canonical raw imported fact table.
- `imported_orders`, `imported_monthly_sales`, `imported_product_sales`, `imported_customers` are rebuildable projections.
- Dormant local runtime tables remain present but are not the active production path:
  - `orders`
  - `order_lines`
  - `customer_receivables`

### Customer Analytics

- Customer stats are import-backed in production.
- Customer selection must happen at customer level first.
- If a customer has many substores, the branch selector is populated after customer selection.
- Branch/substore view is a filtered drill-down of the customer, not a separate customer identity.

### Receivables UX

- Receivables are shown only on total customer stats.
- Receivables must not be shown on branch/substore-level stats.

## Live DB Work Completed

- Remote DB access was fixed by switching from local `127.0.0.1` assumptions to the real remote DB host.
- Live DB connectivity through MCP was verified.
- A read-only integrity audit was performed and documented.
- A full import of:
  - `2024.csv`
  - `2025.CSV`
  - `2026.CSV`
  was successfully completed on the server.

### Current Live Data Shape After Full Import

- `imported_sales_lines`: about 1.146M rows
- `imported_orders`: about 76k rows
- `imported_product_sales`: about 59k rows
- `imported_monthly_sales`: about 5.3k rows
- `imported_customers`: about 808 rows
- mirrored `customers`: aligned with imported customers

### Integrity Status

- duplicate logical sales-line groups: clean
- imported-order collisions: clean
- mirrored customer consistency: clean

## Importer / Ops Changes Completed

- Removed committed DB secrets from operational scripts.
- Tightened runtime credential requirements for non-local environments.
- Added automatic log file creation for the importer wrapper:
  - logs go under `site/logs/imports`
- Raised default timeout behavior for large file-based/full reload imports.
- Fixed a bug where `reload:sales` was recorded as incremental instead of full refresh.
- Added/expanded the import ledger fields in `import_runs`.

## Testing / CI Work Completed

- Added Node tests for:
  - runtime config guardrails
  - customer stats shared logic
  - imported-data provider behavior
  - local SQL-backed provider behavior
  - imported-sales rebuild/integrity helper logic
- Added Python tests for importer helpers.
- Added CI workflow under `.github/workflows/ci.yml`.

## Admin UX Changes Completed

### Search

- The admin search moved from exact-code-only toward a richer customer search.
- Search currently uses separate fields for:
  - customer name
  - customer code
  - branch code
  - branch description / location
- Autocomplete/suggestion UI was later removed.
- The results table is the single selection surface now.

### Branch Selection

- After loading a customer, the user can choose among that customer's substores.
- The branch selector also supports keyboard-oriented filtering via the dedicated branch search field.

### Layout / Presentation

- Three-year monthly sales view was introduced.
- Year labels are concrete years, not generic placeholders.
- Table title alignment and column alignment were improved across admin tables.
- The top search panel collapses after customer load for a cleaner dashboard view.

### Terminology

- `Περιγραφή Υποκ.` was updated in the UI to a clearer label:
  - `Τοποθεσία / Διεύθυνση`

## Business Clarifications Captured

These are not all fully implemented yet, but they were clarified during the session:

- CSV columns 25 and 26 are unnecessary.
- CSV columns 21-31 should not be ignored in principle.
- Columns 6 and 7 currently appear equal in the sample import checked, but they should still be treated conceptually as distinct fields.
- Branch code and branch description are important for admin search UX.
- Customer lookup should support recognition, not just exact recall of codes.
- `Τύπος Παραστατικών` needs a future business classification pass because not all document types should count as sales.

## Important Files Touched During This Session

- `site/server.js`
- `site/public/admin.html`
- `site/public/admin.js`
- `site/public/styles.css`
- `site/lib/customer-stats/*`
- `site/lib/imported-sales.js`
- `site/lib/runtime-config.js`
- `site/lib/db/init-schema.js`
- `site/scripts/*`
- `backend/import_entersoft.py`
- `backend/mysql_db.py`
- `backend/sql/mysql_import_schema.sql`
- `backend/tests/*`
- `site/tests/*`
- `.github/workflows/ci.yml`
- `README.md`
- `site/README.md`
- `backend/README.md`

## Important Git History Created During This Session

The session included multiple pushes to `main`. Relevant milestones included:

- hardening import architecture and DB integrity tooling
- Python runtime compatibility fix for importer typing
- admin customer search improvements
- three-year monthly sales view
- full import timeout improvements
- branch-aware customer stats behavior
- admin user CLI
- cache-control improvements for admin assets
- revert of postal-code admin search changes

## Current UX Constraint To Remember

- On branch view:
  - receivables should be hidden
  - monthly sales should remain visible
- The current discussion at the end of the session focused on using more of the admin page width for the search row and dashboard layout.

## Current Local Working Tree Notes

At the end of this session there were local changes not yet pushed.

Important ones:

- `site/public/admin.html`
- `site/public/admin.js`
- `site/public/styles.css`
- `site/server.js`

Notes:

- The receivables panel fix is in local code:
  - the `Υπόλοιπα` section has `id="receivablesPanel"`
  - `admin.js` hides it only for branch view
- `site/server.js` currently contains a user-edited default admin password value. That should be reviewed carefully before any future push.
- `CODEX_MCP_SETUP.md` was intentionally kept out of commits and should continue to be treated as local setup documentation.

## Recommended Next-Step Workflow For The Next Chat

1. Scan the repo and compare it with this handoff.
2. Check `git status` first, because there are local uncommitted changes.
3. Review the current diffs in:
   - `site/public/admin.html`
   - `site/public/admin.js`
   - `site/public/styles.css`
   - `site/server.js`
4. Confirm whether the remaining local changes should be:
   - kept and committed
   - adjusted
   - or reverted
5. Continue from the admin UX / layout thread, unless priorities change.

## Useful Open Follow-Ups

- Classify `Τύπος Παραστατικών` values into counted-sale vs non-sale/internal categories.
- Preserve more raw CSV fields if business reporting needs them.
- Add CLI/admin tooling for:
  - listing admin users
  - disabling admin users
  - resetting admin passwords
- Consider a more intentional admin layout pass after the current width/layout issue is settled.
