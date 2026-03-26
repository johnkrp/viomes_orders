# Project Map

This document is the durable repo-level reference for future work.

Use it together with:

- `README.md` for current production architecture and operator commands
- `docs/architecture-walkthrough.md` for the current end-to-end architecture walkthrough
- `site/scripts/README.md` for import and scheduler operations

## What Is Active

The repo currently has two active systems and one dormant codebase:

- `site/`
  - active Node.js runtime
  - serves the public order form and the admin dashboard
- `backend/`
  - active Python import / ETL tooling
  - imports Entersoft exports into MySQL / MariaDB
- `backend/legacy_fastapi/`
  - dormant, reference-only
  - do not treat as the current runtime

## Current Runtime Model

The runtime is MySQL-backed.

Important consequence:

- `site/lib/db/client.js` is now MySQL-only at runtime
- old local SQLite deployment is not a supported production target
- the `"sqlite"` customer stats provider name is a compatibility label for the SQL-backed provider path, not a statement about the production DB engine

Main runtime entrypoints:

- `site/server.js`
- `site/app.js`

Route registration:

- `site/lib/routes/public.js`
- `site/lib/routes/admin.js`

Frontend entrypoints:

- public order form:
  - `site/public/index.html`
  - `site/public/order-form.js`
- admin dashboard:
  - `site/public/admin.html`
  - `site/public/admin.js`

## Data Architecture

The real data model is import-driven and projection-first.

### Canonical raw fact table

- `imported_sales_lines`

This is the main imported business fact table and should be treated as the canonical raw sales source.

### Projection / read-model tables

- `imported_customers`
- `imported_customer_branches`
- `imported_orders`
- `imported_open_orders`
- `imported_monthly_sales`
- `imported_product_sales`
- `imported_customer_ledgers`
- `imported_customer_ledger_lines`
- mirrored `customers` rows with `source = 'entersoft_import'`

These are rebuildable and are intentionally derived from imported source data.

### Operational tables

- `products`
- `admin_users`
- `admin_sessions`

### Legacy / dormant tables

- `orders`
- `order_lines`
- `customer_receivables`

These still exist in schema/test compatibility paths but are not the primary production analytics path anymore.

## Main Data Flows

### 1. Public order form

The public page loads catalog data from `catalog.json`, supports cart building, and can export an order workbook locally in the browser.

Key files:

- `site/public/index.html`
- `site/public/order-form.js`
- `site/public/catalog.json`

Notable behavior:

- sessionStorage persistence for search, prepared quantities, cart, and customer fields
- admin-to-form handoff via sessionStorage keys
- order Excel generation in-browser

### 2. Admin dashboard

The admin page authenticates with cookie-based sessions and then queries imported customer data and imported customer stats.

Key files:

- `site/public/admin.html`
- `site/public/admin.js`
- `site/lib/routes/admin.js`
- `site/lib/admin-auth.js`
- `site/lib/admin-customer-search.js`

Important behavior:

- customer search is import-backed
- customer stats are projection-first
- branch filtering is supported
- ledger panel is customer-level only and should stay hidden in branch drill-down mode
- state is preserved when switching away and back

### 3. Import pipeline

The importer is implemented in Python and normally launched through Node wrapper scripts.

Core files:

- `backend/import_entersoft.py`
- `backend/mysql_db.py`
- `backend/sql/mysql_import_schema.sql`
- `site/scripts/run-entersoft-import.js`
- `site/scripts/check-import-integrity.js`
- `site/scripts/dedupe-imported-sales.js`
- `site/scripts/reset-and-reload-sales.js`

The normal import sequence is:

1. import raw sales rows into `imported_sales_lines`
2. rebuild customer projections
3. rebuild sales aggregates
4. import ledger snapshot into `imported_customer_ledgers` and `imported_customer_ledger_lines`
5. mirror imported customers into `customers`
6. record the run in `import_runs`

## Business Logic Hotspots

These files hold the most repo-specific logic and should be checked before changing analytics behavior:

- `site/lib/customer-stats/sqlite-provider.js`
  - main SQL-backed customer stats implementation
  - despite the name, this is the active provider path for MySQL-backed runtime stats
- `site/lib/customer-stats/shared.js`
  - payload normalization and response shaping
- `site/lib/customer-stats/entersoft-provider.js`
  - alternate upstream HTTP provider path
- `site/lib/imported-sales.js`
  - projection rebuilds, health checks, duplicate logic, architecture constants
- `site/lib/document-type-rules.js`
  - determines which imported rows count toward analytics
- `site/lib/factual-lifecycle.js`
  - document lifecycle semantics for executed, open, and pre-execution orders
- `backend/import_entersoft.py`
  - importer behavior, duplicate handling, year replacement, ledger snapshot loading

## Important Current Product Rules

- sales analytics are driven by imported projections, not the legacy local `orders` path
- `imported_sales_lines` is the source of truth for raw imported sales
- revised overlapping sales rows can replace older rows by business key
- exact duplicates can be deduped after import
- ledger imports are snapshot-replace, not append-only
- the admin balances area is now a ledger view, not an invoice-aging view
- branch/substore context affects analytics but the ledger panel stays customer-level only

## Operational Files That Matter

If future work touches deployment, imports, or production behavior, read these first:

- `README.md`
- `docs/architecture-walkthrough.md`
- `site/scripts/README.md`
- `CODEX_MCP_SETUP.md`

## Tests Worth Knowing

Node tests live under `site/tests/`.

Higher-signal current tests include:

- `site/tests/admin-routes.integration.test.js`
- `site/tests/customer-stats-imported-provider.integration.test.js`
- `site/tests/customer-stats-local-provider.integration.test.js`
- `site/tests/http-security.test.js`
- `site/tests/factual-lifecycle.test.js`
- `site/tests/entersoft-provider.test.js`

Python importer tests live under `backend/tests/`.

Main ones:

- `backend/tests/test_import_entersoft_helpers.py`
- `backend/tests/test_factual_lifecycle.py`

## MCP Guidance For This Repo

Useful MCPs for this codebase:

- `mysql`
  - highest value for this repo
  - use it to inspect imported data, projections, run health checks, and verify whether issues are data-side or UI-side
- `browser` / `playwright`
  - use for validating the actual admin and order-form UX once the local app is running
- `github`
  - useful for repo, issue, PR, and code-search workflows
- `context7`
  - useful for current library/framework documentation when needed

Low-value MCP for this repo right now:

- SQLite-focused inspection tooling
  - the active production path is MySQL, so SQLite-centric analysis adds noise unless a specific local fixture path is under test

## Practical MCP Workflow

For user-facing bugs:

1. inspect the DB with `mysql`
2. check whether projections and latest import runs look correct
3. run the app locally
4. validate the UI with `browser` or `playwright`

For import bugs:

1. inspect `import_runs`
2. inspect `imported_sales_lines`
3. inspect derived projection tables
4. check the relevant importer script and lifecycle/document-type rules

For admin analytics bugs:

1. inspect customer stats SQL/provider code
2. inspect imported tables for the affected customer and branch
3. confirm whether the issue is in backend aggregation or frontend rendering/state

## Known Interpretation Traps

- Do not assume any file named `legacy_*` is active.
- Do not assume `"sqlite"` means the runtime DB is SQLite.
- Do not treat `orders` / `order_lines` as the primary sales analytics source.
- Do not assume stale live behavior means the DB is wrong; deployment restart issues have already been a recurring cause.
- Some historical markdown files render Greek text badly in terminal output; confirm with source code and current docs rather than trusting mojibake text blindly.

## Recommended First Read For Future Sessions

If starting fresh, read in this order:

1. `docs/project-map.md`
2. `README.md`
3. `docs/architecture-walkthrough.md`
4. the specific files for the feature area being changed
