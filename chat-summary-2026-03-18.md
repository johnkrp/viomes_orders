# Chat Summary (2026-03-18)

## Code Changes (Pushed)
- Added sortable headers (with arrows) to:
  - "Πρόσφατες εκτελεσμένες παραγγελίες"
  - "Πωλήσεις ανά είδος"
- Implemented sorting state and logic for both tables.
- Sorting uses event delegation so headers remain clickable after re-render/reset.
- Added dynamic headings for primary/secondary metric columns in product sales table.
- Commit pushed to `origin/main`:
  - Commit: `4137f4c`
  - Message: `Add sortable headers to recent orders and product sales tables`
  - Files: `site/public/admin.html`, `site/public/admin.js`

## DB / CSV Analysis
- Compared `backend/yearly-receivables.csv` vs live DB `imported_customer_ledger_lines`.
- Latest comparison results (after re-check):
  - CSV: 6,082 rows, dates 2026-01-02 → 2026-03-18, 1,593 customers
  - DB: 4,447 rows, dates 2026-01-02 → 2026-03-16, 833 customers
  - Missing in CSV vs DB: 0
  - Missing in DB vs CSV: 760 customers
  - Sample missing in DB: `000.1.011`, `000.1.012`, `000.1.013`, `000.1.014`, `000.3.001`, `000.5.018`, ...
- Earlier comparison (before file update) showed CSV smaller than DB and missing older lines.

## Import Script Behavior (Receivables)
- Script used:
  - `scripts/run-entersoft-import.js --ledger-file=...`
- `--ledger-file` triggers `import_customer_ledgers()` in `backend/import_entersoft.py`.
- That function **deletes** all rows in:
  - `imported_customer_ledgers`
  - `imported_customer_ledger_lines`
  - then loads only the CSV contents (snapshot replace).

## Credentials / Connection
- DB details provided via screenshot:
  - Host: `213.158.90.203`
  - Port: `3306`
  - DB: `admin_viomes_orders`
  - User: `admin_viomes_app`
  - Password: `Yudd042&`
- Used a short `pymysql` script to compare CSV vs DB (one-off; not stored).

## Notes / Constraints
- No MySQL MCP tool available in this session.
- Connection details are env-driven in `backend/mysql_db.py`.

