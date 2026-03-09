-- Live DB integrity audit query pack for admin_viomes_orders.
-- Intended for read-only execution against the live MariaDB instance.

-- 1. Connection / target confirmation
SELECT VERSION() AS server_version, DATABASE() AS database_name;

-- 2. Counts grouped by subsystem
SELECT subsystem, table_name, row_count
FROM (
  SELECT 'auth_admin' AS subsystem, 'admin_users' AS table_name, COUNT(*) AS row_count FROM admin_users
  UNION ALL
  SELECT 'auth_admin', 'admin_sessions', COUNT(*) FROM admin_sessions
  UNION ALL
  SELECT 'local_runtime', 'customers_local', COUNT(*) FROM customers WHERE source <> 'entersoft_import' OR source IS NULL
  UNION ALL
  SELECT 'local_runtime', 'customer_receivables', COUNT(*) FROM customer_receivables
  UNION ALL
  SELECT 'local_runtime', 'orders', COUNT(*) FROM orders
  UNION ALL
  SELECT 'local_runtime', 'order_lines', COUNT(*) FROM order_lines
  UNION ALL
  SELECT 'import_history', 'import_runs', COUNT(*) FROM import_runs
  UNION ALL
  SELECT 'import_history', 'imported_sales_lines', COUNT(*) FROM imported_sales_lines
  UNION ALL
  SELECT 'derived_import', 'imported_customers', COUNT(*) FROM imported_customers
  UNION ALL
  SELECT 'derived_import', 'imported_monthly_sales', COUNT(*) FROM imported_monthly_sales
  UNION ALL
  SELECT 'derived_import', 'imported_orders', COUNT(*) FROM imported_orders
  UNION ALL
  SELECT 'derived_import', 'imported_product_sales', COUNT(*) FROM imported_product_sales
  UNION ALL
  SELECT 'catalog', 'products', COUNT(*) FROM products
  UNION ALL
  SELECT 'catalog', 'customers_mirrored', COUNT(*) FROM customers WHERE source = 'entersoft_import'
) AS counts
ORDER BY subsystem, table_name;

-- 3. Duplicate logical imported sales-line groups
SELECT
  COUNT(*) AS duplicate_groups,
  COALESCE(SUM(group_size - 1), 0) AS duplicate_rows
FROM (
  SELECT COUNT(*) AS group_size
  FROM imported_sales_lines
  GROUP BY
    order_date,
    document_no,
    document_type,
    item_code,
    item_description,
    unit_code,
    qty,
    qty_base,
    unit_price,
    net_value,
    customer_code,
    customer_name,
    delivery_code,
    delivery_description,
    account_code,
    account_description,
    branch_code,
    branch_description,
    note_1
  HAVING COUNT(*) > 1
) AS duplicate_groups;

-- 4. Sample duplicate logical imported sales-line groups
SELECT
  order_date,
  document_no,
  customer_code,
  item_code,
  COUNT(*) AS copies,
  GROUP_CONCAT(DISTINCT source_file ORDER BY source_file SEPARATOR ', ') AS files
FROM imported_sales_lines
GROUP BY
  order_date,
  document_no,
  document_type,
  item_code,
  item_description,
  unit_code,
  qty,
  qty_base,
  unit_price,
  net_value,
  customer_code,
  customer_name,
  delivery_code,
  delivery_description,
  account_code,
  account_description,
  branch_code,
  branch_description,
  note_1
HAVING COUNT(*) > 1
ORDER BY copies DESC, order_date DESC, document_no, item_code
LIMIT 10;

-- 5. Imported order collisions
SELECT
  COUNT(*) AS imported_order_collision_groups
FROM (
  SELECT 1
  FROM imported_orders
  GROUP BY document_no, customer_code, created_at
  HAVING COUNT(*) > 1
) AS collisions;

-- 6. Imported order collision samples
SELECT
  document_no,
  customer_code,
  created_at,
  COUNT(*) AS copies
FROM imported_orders
GROUP BY document_no, customer_code, created_at
HAVING COUNT(*) > 1
ORDER BY created_at DESC, document_no, customer_code
LIMIT 10;

-- 7. Mirrored-customer consistency
SELECT COUNT(*) AS missing_mirrors
FROM imported_customers ic
LEFT JOIN customers c
  ON c.code = ic.customer_code
 AND c.source = 'entersoft_import'
WHERE c.code IS NULL;

SELECT COUNT(*) AS orphan_mirrors
FROM customers c
LEFT JOIN imported_customers ic
  ON ic.customer_code = c.code
WHERE c.source = 'entersoft_import'
  AND ic.customer_code IS NULL;

-- 8. Recent import activity
SELECT
  id,
  dataset,
  file_name,
  import_mode,
  status,
  started_at,
  finished_at,
  source_row_count,
  rows_in,
  rows_upserted,
  rows_skipped_duplicate,
  rows_rejected,
  rebuild_started_at,
  rebuild_finished_at,
  schema_version,
  trigger_source,
  TIMESTAMPDIFF(SECOND, started_at, finished_at) AS duration_seconds
FROM import_runs
ORDER BY id DESC
LIMIT 20;

-- 9. Suspicious recent runs where input existed but nothing new was upserted
SELECT
  id,
  dataset,
  file_name,
  import_mode,
  status,
  started_at,
  finished_at,
  source_row_count,
  rows_in,
  rows_upserted,
  rows_skipped_duplicate,
  rows_rejected,
  trigger_source
FROM import_runs
WHERE rows_in > 0
  AND rows_upserted = 0
ORDER BY id DESC
LIMIT 20;

-- 10. Failed runs, if any
SELECT
  id,
  dataset,
  file_name,
  import_mode,
  status,
  started_at,
  finished_at,
  source_row_count,
  rows_in,
  rows_upserted,
  rows_skipped_duplicate,
  rows_rejected,
  error_text
FROM import_runs
WHERE status <> 'success'
ORDER BY id DESC
LIMIT 20;

-- 11. Base import recency by order_date
SELECT
  DATE(order_date) AS order_date,
  COUNT(*) AS rows_on_date
FROM imported_sales_lines
GROUP BY DATE(order_date)
ORDER BY order_date DESC
LIMIT 14;

-- 12. Aggregate coverage: base distinct customer/item pairs vs product aggregates
SELECT
  (SELECT COUNT(*) FROM imported_product_sales) AS imported_product_sales_rows,
  (
    SELECT COUNT(*)
    FROM (
      SELECT customer_code, item_code
      FROM imported_sales_lines
      GROUP BY customer_code, item_code
    ) AS base_pairs
  ) AS distinct_customer_item_pairs;

-- 13. Monthly aggregate distribution
SELECT
  order_year,
  COUNT(*) AS monthly_rows,
  COUNT(DISTINCT customer_code) AS customers_covered,
  ROUND(SUM(revenue), 2) AS total_revenue,
  ROUND(SUM(pieces), 2) AS total_pieces
FROM imported_monthly_sales
GROUP BY order_year
ORDER BY order_year;

-- 14. Table size hotspots
SELECT
  table_name,
  table_rows,
  ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY (data_length + index_length) DESC
LIMIT 20;

-- 15. Imported-table column definitions
SELECT
  table_name,
  column_name,
  column_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (
    'imported_sales_lines',
    'imported_orders',
    'imported_product_sales',
    'imported_monthly_sales',
    'imported_customers'
  )
ORDER BY table_name, ordinal_position;

-- 16. Imported-table indexes
SELECT
  table_name,
  index_name,
  GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index,
  non_unique
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name IN (
    'imported_sales_lines',
    'imported_orders',
    'imported_product_sales',
    'imported_monthly_sales',
    'imported_customers'
  )
GROUP BY table_name, index_name, non_unique
ORDER BY table_name, index_name;
