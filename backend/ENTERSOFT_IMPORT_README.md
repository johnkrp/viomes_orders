# Entersoft File Import Notes

This document explains how the current Entersoft file-based import works.

The current import path is:

1. Entersoft exports flat text files into `backend/`
2. `backend/import_entersoft.py` reads those files
3. the importer normalizes them into MySQL/MariaDB tables
4. the Node admin API reads those imported tables through `site/lib/customer-stats/sqlite-provider.js`

This is the active non-API integration approach for customer analytics.

## Storage Target

`import_entersoft.py` now imports directly into MySQL/MariaDB.

Required environment variables before running the importer:

- `MYSQL_HOST` (default `127.0.0.1`)
- `MYSQL_PORT` (default `3306`)
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

## Files Used

Current expected files:

- `backend/customers.csv`
- `backend/info_2025.csv`
- `backend/info_2026.csv`

`customers.csv` is the customer/store master export.

`info_2025.csv` and `info_2026.csv` are line-level sales exports from Entersoft.

At the moment, receivables are not imported.

## File Format Assumptions

The importer currently expects all three files to be:

- tab-delimited
- encoded as `utf-8-sig`
- flat row exports
- one header row only

For the sales files, each row is treated as one sales line.

Important:

- the importer assumes the Entersoft column names stay stable
- if Entersoft changes the exported header labels, the importer will stop mapping correctly

## How `customers.csv` Is Handled

Source file:

- `backend/customers.csv`

Reader settings:

- `csv.DictReader(..., delimiter="\\t")`
- encoding: `utf-8-sig`

Used columns:

- `Κωδικός Πελάτη` -> `customer_code`
- `Επων. Πελάτη` -> `customer_name`
- `Κωδικός` -> `delivery_code`
- `Περιγραφή` -> `delivery_description`
- `Δ/νση 1` -> `address_1`
- `Ταχ.Κώδικας` -> `postal_code`
- `Πόλη` -> `city`
- `Περιοχή` -> `region`
- `Χώρα` -> `country`
- `Τηλέφωνο 1` -> `phone`
- `Παλέτες` -> `pallet_info`
- `Τρόπος Παράδοσης` -> `delivery_method`
- `Κωδικός Πωλητή` -> `salesperson_code`
- `Επων. Πωλητή` -> `salesperson_name`
- `Ανενεργός` -> `is_inactive`

Output tables:

- `imported_customers`
- `customers`

Behavior:

- the importer deletes all rows from `imported_customers`
- it reloads the whole file
- then it mirrors the imported customer codes/names into `customers` with `source = 'entersoft_import'`

This means customer lookup in the admin can work even if sales data is missing for a code.

## How `info_2025.csv` / `info_2026.csv` Are Handled

Source files:

- `backend/info_2025.csv`
- `backend/info_2026.csv`

Reader settings:

- `csv.DictReader(..., delimiter="\\t")`
- encoding: `utf-8-sig`

Used columns:

- `Ημ/νία ` -> order date
- `Παραστατικό` -> document number / order id
- `Είδος` -> item code
- `Περιγραφή` -> item description
- `ΜΜ` -> unit code
- `Ποσότητα` -> `qty`
- `Ποσότητα σε βασική ΜΜ` -> `qty_base`
- `Τιμή` -> `unit_price`
- `Καθαρή  αξία ` -> `net_value`
- `Κωδικός` -> customer code
- `Επωνυμία/Ονοματεπώνυμο` -> customer name
- `Τύπος Παραστατικών` -> document type
- `Κωδικός1` -> delivery code
- `Περιγραφή1` -> delivery description
- `Κωδ. ΑΧ ` -> account code
- `Περ. ΑΧ` -> account description
- `Κωδ.υποκ.` -> branch code
- `Περ.υποκ.` -> branch description
- `Σχόλιο 1` -> note_1

Date handling:

- `parse_date()` accepts:
  - `%d/%m/%Y`
  - `%d/%m/%y`
- dates are stored in ISO format: `YYYY-MM-DD`

Decimal handling:

- `parse_decimal()` currently does:
  - trim
  - remove `.` characters
  - replace `,` with `.`
  - parse as float

This is designed for Greek numeric formatting from Entersoft, for example:

- `1.234,56` -> `1234.56`
- `312,0600000000` -> `312.06`

## Imported Tables and Meaning

The importer writes the sales files into these normalized tables:

### `imported_sales_lines`

One row per imported sales line.

This is the raw normalized table and the base for all later aggregates.

Important fields:

- `order_date`
- `document_no`
- `item_code`
- `item_description`
- `qty`
- `qty_base`
- `unit_price`
- `net_value`
- `customer_code`
- `customer_name`

### `imported_orders`

Built by grouping `imported_sales_lines` by:

- `document_no`
- `customer_code`
- `order_date`

Derived values:

- `total_lines = COUNT(*)`
- `total_pieces = SUM(qty_base)`
- `total_net_value = SUM(net_value)`
- `average_discount_pct = 0`

Current limitation:

- discount is not present in the Entersoft export we use now, so average discount is hardcoded to `0`

### `imported_monthly_sales`

Built by grouping `imported_sales_lines` by:

- `customer_code`
- `order_year`
- `order_month`

Derived values:

- `revenue = SUM(net_value)`
- `pieces = SUM(qty_base)`

### `imported_product_sales`

Built by grouping `imported_sales_lines` by:

- `customer_code`
- `item_code`

Derived values:

- `revenue = SUM(net_value)`
- `pieces = SUM(qty_base)`
- `orders = COUNT(DISTINCT document_no)`
- `avg_unit_price = SUM(net_value) / SUM(qty_base)` when `qty_base > 0`

Important:

- the UI value `Μ. τιμή μονάδας` comes directly from this formula
- if the source file has wrong or non-commercial quantities for a code, the average price will also be wrong

## Why the Admin UI Can Show a Customer With Zero Data

This is expected behavior in one case:

- the customer exists in `customers.csv`
- but there are no matching rows for that customer code in `info_2025.csv` / `info_2026.csv`

Then the admin page can show:

- customer name found
- all KPI values zero
- empty monthly/product/order data

That does not necessarily mean the import failed.

## How the Node Admin API Uses Imported Data

File:

- `site/lib/customer-stats/sqlite-provider.js`

Behavior:

1. it checks whether `imported_sales_lines` has any rows
2. if yes, it uses the imported Entersoft tables
3. if no, it falls back to the older local/demo tables

So imported data takes precedence automatically once the import succeeds.

## Run the Import

From the repo root:

```powershell
python backend\import_entersoft.py
```

Expected success output is similar to:

```text
Imported customers=..., sales_lines=...
```

## Verify the Import

Check row counts:

```powershell
@'
import os
import pymysql
conn = pymysql.connect(
    host=os.getenv("MYSQL_HOST", "127.0.0.1"),
    port=int(os.getenv("MYSQL_PORT", "3306")),
    user=os.environ["MYSQL_USER"],
    password=os.getenv("MYSQL_PASSWORD", ""),
    database=os.environ["MYSQL_DATABASE"],
)
cur = conn.cursor()
for table in [
    'imported_customers',
    'imported_sales_lines',
    'imported_orders',
    'imported_monthly_sales',
    'imported_product_sales',
]:
    print(table, cur.execute(f"select count(*) from {table}").fetchone()[0])
'@ | python -
```

Check one known customer:

```powershell
@'
import os
import pymysql
conn = pymysql.connect(
    host=os.getenv("MYSQL_HOST", "127.0.0.1"),
    port=int(os.getenv("MYSQL_PORT", "3306")),
    user=os.environ["MYSQL_USER"],
    password=os.getenv("MYSQL_PASSWORD", ""),
    database=os.environ["MYSQL_DATABASE"],
)
cur = conn.cursor()
code = '177.5.013'
cur.execute("select count(*) from imported_orders where customer_code = %s", (code,))
print('orders', cur.fetchone()[0])
cur.execute("select count(*) from imported_sales_lines where customer_code = %s", (code,))
print('lines', cur.fetchone()[0])
'@ | python -
```

## Current Known Limitations

### 1. Receivables are not imported

The current file-based integration does not populate:

- open balance
- overdue balance
- receivables rows

The admin UI keeps that section empty for now.

### 2. Discount is not imported

The current `info_*.csv` exports do not provide line discount in a usable way for the importer.

As a result:

- `average_discount_pct` is currently `0` for imported orders

### 3. Average unit price can be misleading

Example seen during testing:

- item `101-01` showed an unrealistically high average unit price

This happened because the imported rows for that item already contained:

- `qty_base = 1`
- very high `net_value`

So the importer did the math correctly, but the source export did not behave like a normal per-piece sales-line export for that product.

Conclusion:

- if an item has unrealistic `Μ. τιμή μονάδας`, the problem is usually upstream in the Entersoft export, not in the UI math

### 4. Customer/product data quality depends completely on Entersoft export quality

This importer assumes:

- one row in `info_*.csv` = one real sales line
- `qty_base` is the quantity we want to aggregate
- `net_value` is the line net value we want to aggregate

If any of these assumptions are false for a specific report/export, then:

- KPIs
- monthly sales
- product sales
- average unit price

can all become misleading.

## Recommended Next Improvements

1. Get a stricter Entersoft invoice-line export with confirmed business meaning for:
   - quantity
   - base quantity
   - unit price
   - net value
   - discount
2. Add a separate receivables export.
3. Consider hiding `avg_unit_price` in the UI until the Entersoft line export is validated for all products.
4. Add a small validation report after import, for example:
   - top 20 items by highest average price
   - rows with zero quantity but non-zero revenue
   - rows with negative revenue
