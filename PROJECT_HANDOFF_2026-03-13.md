# Project Handoff - 2026-03-13

This file captures the important product, admin, import, and operational changes completed in the latest working session.

## Current Runtime Shape

- Active runtime app:
  - `site/app.js`
  - `site/server.js`
- Active frontend:
  - public order form: `site/public/index.html`, `site/public/order-form.js`
  - admin dashboard: `site/public/admin.html`, `site/public/admin.js`
- Active import pipeline:
  - `backend/import_entersoft.py`
  - `site/scripts/run-entersoft-import.js`
  - `site/scripts/check-import-integrity.js`
- Active production DB:
  - MySQL/MariaDB on `213.158.90.203`

Legacy FastAPI code under `backend/legacy_fastapi/` is still dormant/reference-only.

## Important Product Features Now In Place

### Public order form

- Global Enter add:
  - if catalog rows have prepared quantities, pressing `Enter` from anywhere on the page adds those prepared rows
- Visible bulk add:
  - toolbar now has `Προσθήκη έτοιμων γραμμών`
  - enabled only when one or more rows have prepared quantities
- Better cart editing:
  - inline `- / quantity / +` editing in the cart
  - duplicate quantity indicator below the stepper was removed
  - separate `X` remove button was removed
  - reducing quantity down to zero removes the row naturally
- State persistence:
  - index page preserves search, toolbar qty, prepared row values, cart, customer fields, and notes when switching away and back

### Admin dashboard

- Greek-first UI copy is now the core admin language
- Import health was reduced from a whole section to a lightweight latest-import session message after login
- Sales time-range filtering:
  - applies to sales-by-product, top products, and recent orders
  - does not affect `Πωλήσεις ανά μήνα`
  - includes smaller periods such as `7d`, `14d`, and `1m`
- Recent orders:
  - paginated at 10 rows per page
  - sorted by most recently received first
  - displays date only, not time
- Order detail:
  - action button `Άνοιγμα στη φόρμα παραγγελίας` is shown on the right under the total value
- State persistence:
  - admin preserves current authenticated dashboard state, search fields, selected customer, filters, and recent rendered stats when switching away and back

## Admin <-> Index Integration

Two connected flows now exist between the admin page and the public order form.

### 1. Open exact order as catalog draft

From admin order detail:

- clicking `Άνοιγμα στη φόρμα παραγγελίας`
- opens `index.html`
- keeps cart empty
- filters the catalog to the order products
- prefills the ordered quantities on the catalog rows

This replaced the earlier behavior that pushed the order directly into the cart.

### 2. Customer-specific product ranking

From the admin `Πρόσφατες παραγγελίες` panel:

- button: `Άνοιγμα φόρμας με κατάταξη`
- opens `index.html`
- keeps the full catalog visible
- reorders the catalog so the customer's strongest products appear first
- ranking uses the current admin `Πωλήσεις ανά είδος` sort order and selected period
- if a substore/branch is selected in admin, the ranking uses that filtered branch context

Important distinction:

- this ranking does not filter the catalog down to only historical products
- it only reprioritizes the full product list

## Import / Ops Workflow Confirmed

### Daily file model

Operational daily files are:

- sales / factual CSVs
- receivables / ledger CSVs

Current practical fixed filenames for automation:

- `yearly-factuals.csv`
- `yearly-receivables.csv`

### Plesk scheduled task model

Preferred production automation on shared hosting:

1. upload the two files into server `backend/`
2. use Plesk `Run a command` scheduled tasks
3. import factuals first
4. import receivables second
5. optionally run integrity check third

Important production lesson:

- Plesk scheduled tasks may not have `node` on `PATH`
- use the full Plesk Node binary path if needed, for example:
  - `/opt/plesk/node/22/bin/node`
  - or the exact installed version on that server

### Daily server commands

Factuals:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --sales-files=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-factuals.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_DB_PASSWORD'
```

Receivables:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run import:entersoft -- --ledger-file=/var/www/vhosts/viomes.gr/orders.viomes.gr/backend/yearly-receivables.csv --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_DB_PASSWORD'
```

Integrity check:

```bash
cd /var/www/vhosts/viomes.gr/orders.viomes.gr/site
npm run check:import-integrity -- --mysql-host=213.158.90.203 --mysql-port=3306 --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app --mysql-password='YOUR_DB_PASSWORD'
```

Additional detailed notes for WinSCP/PowerShell upload and Plesk scheduled tasks are already documented in:

- `site/scripts/README.md`

## DB / Import Lessons From This Session

- Duplicate customer symptoms were not caused by duplicated `imported_customers`
- The real issue was branch projection behavior in `imported_customer_branches`
- Branch projection/search/provider logic was fixed so duplicate branch descriptions do not multiply customer results
- `dedupe:sales` only removes true duplicate business rows; it does not solve all UI duplication causes by itself
- DB cleanup alone is not enough when production is still serving stale Node code
- If the DB looks correct but the live UI still behaves wrongly, check deploy + restart before suspecting the importer

## Admin User Operations

Admin users can be created with:

```powershell
cd site
npm run admin:create-user -- --username=USERNAME --password=PASSWORD
```

During this session, an additional admin user was created successfully using the existing script and live DB path.

Do not store live passwords in repo docs.

## Browser / Validation Notes

The browser MCP was used repeatedly against the real runtime and real MySQL-backed data to validate:

- admin login/session behavior
- recent-order drilldown
- admin -> index order handoff
- admin -> index customer ranking handoff
- table/layout fixes
- date/filter behavior

Preferred validation rule for future work:

- for anything user-facing, validate on the real runtime path when possible
- do not rely only on static HTML rendering if the behavior depends on API state

## Latest Relevant Commits

These are the most important recent commits from the current working period:

- `2b603c1` Preserve index and admin page state
- `f63a564` Link admin orders to order form
- `7c9cc56` Show admin orders as catalog draft
- `a8e98e7` Add customer product ranking workflow

## Recommended Next Chat Starting Point

1. Check `git log -5 --oneline` and confirm `main` includes `a8e98e7`.
2. If testing locally, run the real Node app and open:
   - `http://127.0.0.1:3001/index.html`
   - `http://127.0.0.1:3001/admin.html`
3. If testing production and something looks stale:
   - pull latest `main`
   - restart the Node/Plesk runtime
   - confirm latest imports succeeded
4. Treat this handoff file plus `site/scripts/README.md` as the current operational reference.
