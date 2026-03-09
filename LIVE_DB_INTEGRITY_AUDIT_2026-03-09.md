# Live DB Integrity Audit

Audit date: 2026-03-09  
Target: `admin_viomes_orders` on `213.158.90.203:3306`  
Server version: `10.11.16-MariaDB-cll-lve`  
Method: read-only audit over the live MariaDB database

Reusable query pack: [backend/sql/live_db_integrity_audit.sql](/d:/Desktop/programming/viomes/order_form/backend/sql/live_db_integrity_audit.sql)

## Status

No immediate integrity defects were found in the live import-backed analytics path.

Confirmed:
- duplicate logical groups in `imported_sales_lines`: `0`
- imported-order collision groups in `imported_orders`: `0`
- missing mirrored customers (`imported_customers` -> `customers`): `0`
- orphan mirrored customers (`customers.source='entersoft_import'` -> `imported_customers`): `0`
- failed `import_runs`: `0`

The live database matches the current repo assumptions:
- `imported_*` tables are the active analytics source of truth
- local runtime `orders`, `order_lines`, `customer_receivables`, and non-import `customers` are dormant
- `products` remains active independently of local order capture

## Counts

### Auth / Admin

| Table | Rows |
| --- | ---: |
| `admin_users` | 1 |
| `admin_sessions` | 6 |

### Local Runtime

| Table | Rows |
| --- | ---: |
| `customers` with non-import source | 0 |
| `customer_receivables` | 0 |
| `orders` | 0 |
| `order_lines` | 0 |

### Import History

| Table | Rows |
| --- | ---: |
| `import_runs` | 2 |
| `imported_sales_lines` | 609,609 |

### Derived Import Data

| Table | Rows |
| --- | ---: |
| `imported_customers` | 650 |
| `imported_orders` | 41,386 |
| `imported_monthly_sales` | 3,021 |
| `imported_product_sales` | 42,275 |

### Catalog

| Table | Rows |
| --- | ---: |
| `products` | 2,088 |
| mirrored import customers in `customers` | 650 |

## Import Activity

Only two import runs currently exist in `import_runs`, both successful:

| Run ID | File(s) | Status | Rows In | Rows Upserted | Duration |
| --- | --- | --- | ---: | ---: | ---: |
| 37 | `today.csv` | success | 3,367 | 0 | 12s |
| 36 | `2025.CSV,2026.CSV` | success | 610,094 | 609,609 | 2,402s |

Interpretation:
- Run `36` is the effective full historical load.
- Run `37` looks like an incremental overlap replay rather than a failure. `rows_in > 0` with `rows_upserted = 0` is consistent with the importer's dedupe key and the live data shape, not with a broken import, because:
  - the run status is `success`
  - there are no failed runs
  - duplicate logical row groups remain at `0`
  - recent `order_date` coverage is present through `2026-03-04`

## Aggregate Consistency

### Customer Mirror

`imported_customers` and mirrored `customers WHERE source='entersoft_import'` are aligned exactly:
- imported customers: `650`
- mirrored customers: `650`
- missing mirrors: `0`
- orphan mirrors: `0`

### Product Aggregate Coverage

Product aggregate cardinality matches the distinct `(customer_code, item_code)` pairs in base import history:
- `imported_product_sales`: `42,275`
- distinct pairs from `imported_sales_lines`: `42,275`

That is the expected shape given the rebuild logic in the importer and the Node-side maintenance helpers.

### Monthly Aggregate Distribution

| Year | Aggregate Rows | Customers Covered | Revenue | Pieces |
| --- | ---: | ---: | ---: | ---: |
| 2025 | 2,571 | 613 | 23,949,411.30 | 22,295,547.04 |
| 2026 | 450 | 253 | 3,918,288.24 | 3,766,773.00 |

The distribution looks internally coherent for a historical year plus a partial current-year slice.

## Storage / Hotspots

Largest tables by on-disk footprint:

| Table | Size |
| --- | ---: |
| `imported_sales_lines` | 284.19 MB |
| `imported_orders` | 25.14 MB |
| `imported_product_sales` | 6.52 MB |
| `products` | 1.59 MB |

Operational implication:
- `imported_sales_lines` is the dominant storage and scan hotspot by a large margin.
- Any future expensive validation, backfill, or reporting query should assume that table is the main cost center.

Note: `information_schema.tables.table_rows` is approximate for InnoDB; the audit uses direct `COUNT(*)` where exact row counts matter.

## Schema / Index Drift Check

The live imported-table shape matches the current repo expectations for the critical analytics path:
- `imported_orders.order_id` is `VARCHAR(300)`
- `imported_orders.document_no` exists and is non-null with default `''`
- live indexes include:
  - `uq_imported_sales_line(source_file, document_no, item_code, customer_code, delivery_code, net_value, qty)`
  - `idx_imported_sales_line_lookup(order_date, document_no, item_code, customer_code, delivery_code)`
  - `idx_imported_orders_customer_document_date(customer_code, document_no, created_at)`

No critical column or index drift was found for the imported tables inspected.

## Architectural Reality

The live DB confirms the current production shape more clearly than the repo alone:
- import-backed analytics are active and populated
- local order capture tables are structurally present but not used
- customer mirroring from import data is active
- the product catalog is populated even though local orders are empty

This matches the current split documented in the repo: the public flow is static-first, while analytics/admin reads depend on the live DB and imported aggregates.

## Remediation Backlog

### Medium

1. Increase `import_runs` retention and metadata quality. Two rows are enough to prove current success, but not enough for trend analysis, anomaly detection, or operational forensics. Add explicit run mode (`full_refresh` vs `incremental`) and preserve more history.

2. Treat `imported_sales_lines` as the primary scaling risk. At `284 MB`, it already dominates the schema. Before adding heavier audits or analytics, define acceptable scan times and consider whether additional covering indexes or archival strategy will eventually be needed.

3. Make production-vs-dormant table ownership explicit in operator docs. The live DB still contains dormant local runtime tables next to active import-backed analytics tables, which is easy to misread during debugging.

### Low

1. Add a scheduled integrity snapshot. The queries in the audit pack are lightweight enough to run periodically and persist results somewhere outside the DB for easier drift detection.

2. Surface import freshness directly in admin tooling. Right now freshness has to be inferred from `import_runs` and `imported_sales_lines.order_date`; an explicit status view would reduce operator guesswork.

## Bottom Line

The live database is healthy for the active import-backed analytics path. No duplicate or mirror-consistency issues were found, no failed imports are recorded, and the schema/index shape aligns with the current codebase. The main remaining concerns are operational observability and the long-term cost of the large `imported_sales_lines` table, not current data correctness.
