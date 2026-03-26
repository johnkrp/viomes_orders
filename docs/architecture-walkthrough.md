# Architecture Walkthrough

This is the single durable architecture summary for first-time contributors.

## 1) System Shape

The project has two active subsystems:

- `site/`
  - Node.js runtime (Express)
  - serves public order form and admin dashboard
- `backend/`
  - Python importer/ETL
  - imports Entersoft exports into MySQL/MariaDB

Legacy FastAPI code under `backend/legacy_fastapi/` is dormant/reference-only.

## 2) Runtime Architecture (`site/`)

Main entrypoints:

- `site/server.js`
- `site/app.js`

Routing:

- public routes: `site/lib/routes/public.js`
- admin routes: `site/lib/routes/admin.js`

Frontend entrypoints:

- public order form: `site/public/index.html`, `site/public/order-form.js`
- admin dashboard: `site/public/admin.html`, `site/public/admin.js`

Admin frontend modules:

- state: `site/public/admin-state.js`
- API client: `site/public/admin-api.js`
- actions: `site/public/admin-actions.js`
- rendering: `site/public/admin-render.js`
- table logic/sorting/paging: `site/public/admin-tables.js`
- admin↔order-form handoff: `site/public/admin-handoff.js`

## 3) Data Architecture

Canonical raw fact table:

- `imported_sales_lines`

Rebuildable projections/read models:

- `imported_customers`
- `imported_customer_branches`
- `imported_orders`
- `imported_open_orders`
- `imported_monthly_sales`
- `imported_product_sales`
- `imported_customer_ledgers`
- `imported_customer_ledger_lines`
- mirrored `customers` rows (`source = 'entersoft_import'`)

Operational tables:

- `products`
- `admin_users`
- `admin_sessions`

Legacy/dormant business tables (not primary analytics path):

- `orders`
- `order_lines`
- `customer_receivables`

## 4) Import / ETL Architecture (`backend/`)

Core importer:

- `backend/import_entersoft.py`

DB/schema support:

- `backend/mysql_db.py`
- `backend/sql/mysql_import_schema.sql`

Node wrappers and ops scripts:

- `site/scripts/run-entersoft-import.js`
- `site/scripts/check-import-integrity.js`
- `site/scripts/dedupe-imported-sales.js`
- `site/scripts/preflight-entersoft-import.js`

Import modes:

- `incremental`
- `full_refresh`
- `replace_sales_year`

Daily operational files:

- `backend/yearly-factuals.csv` (sales)
- `backend/yearly-receivables.csv` (ledger snapshot)

## 5) Business Rule Sources

Document/lifecycle semantics are centralized and shared by Node + Python:

- `document_type_rules.json`
- `factual_lifecycle_rules.json`

Runtime rule loaders:

- `site/lib/document-type-rules.js`
- `site/lib/factual-lifecycle.js`

Importer rule loaders:

- `backend/document_type_rules.py`
- `backend/factual_lifecycle.py`

## 6) Admin Stats Flow

Main endpoint:

- `GET /api/admin/customers/:code/stats`

Implemented through provider path:

- `site/lib/customer-stats/index.js`
- `site/lib/customer-stats/sqlite-provider.js`
- `site/lib/customer-stats/stats-imported-loader.js`

Current matching logic for ongoing/pre-approval tables is reference-aware and handles:

- open execution progression (`ΠΔΣ`)
- executed docs (`ΑΠΛ`, `ΤΔΑ`, `ΤΙΠ`)
- rejection progression (`ΠΑΑ`)
- fallback no-reference matching for older rows

## 7) Public Order Form Flow

The public form is browser-centric:

- loads `site/public/catalog.json`
- maintains search/cart/customer draft state in sessionStorage
- supports admin-triggered handoff/ranking
- generates order export in-browser (XLSX flow)

## 8) Tests and Validation

Node tests:

- `site/tests/*.test.js`

Python tests:

- `backend/tests/test_factual_lifecycle.py`
- `backend/tests/test_import_entersoft_helpers.py`

Most sensitive regression area is imported customer stats and ongoing-order matching:

- `site/tests/customer-stats-imported-provider.integration.test.js`

## 9) Environment and Runtime Assumptions

Production runtime is MySQL-backed.

Required env:

- `DB_CLIENT=mysql`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

Health endpoint:

- `GET /api/health`

## 10) First-Time Contributor Reading Order

1. `README.md`
2. `docs/architecture-walkthrough.md`
3. `docs/project-map.md`
4. `site/app.js`
5. `site/lib/routes/admin.js`
6. `site/lib/customer-stats/stats-imported-loader.js`
7. `site/lib/imported-sales.js`
8. `backend/import_entersoft.py`
9. `site/scripts/README.md`
10. `site/tests/customer-stats-imported-provider.integration.test.js`

## 11) Practical Guidance

- Treat `imported_sales_lines` as source of truth for imported analytics.
- Treat `imported_*` projections as rebuildable read models.
- Avoid modifying `backend/legacy_fastapi/` unless explicitly reviving legacy code.
- Validate lifecycle/order-state changes with focused integration tests before deploying.
