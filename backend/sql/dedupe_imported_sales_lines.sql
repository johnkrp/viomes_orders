-- Preview duplicate logical sales-line groups, ignoring source_file.
SELECT
  COUNT(*) AS duplicate_groups,
  COALESCE(SUM(group_size - 1), 0) AS duplicate_rows_to_delete
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
) duplicate_groups;

-- Sample duplicate groups before cleanup.
SELECT
  order_date,
  document_no,
  customer_code,
  item_code,
  COUNT(*) AS copies,
  GROUP_CONCAT(source_file ORDER BY source_file SEPARATOR ', ') AS source_files
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
LIMIT 20;

-- Delete later duplicates while preserving the earliest row by id.
DELETE duplicate_row
FROM imported_sales_lines duplicate_row
JOIN imported_sales_lines keeper
  ON keeper.id < duplicate_row.id
 AND keeper.order_date = duplicate_row.order_date
 AND keeper.document_no = duplicate_row.document_no
 AND keeper.document_type <=> duplicate_row.document_type
 AND keeper.item_code = duplicate_row.item_code
 AND keeper.item_description = duplicate_row.item_description
 AND keeper.unit_code <=> duplicate_row.unit_code
 AND keeper.qty = duplicate_row.qty
 AND keeper.qty_base = duplicate_row.qty_base
 AND keeper.unit_price = duplicate_row.unit_price
 AND keeper.net_value = duplicate_row.net_value
 AND keeper.customer_code = duplicate_row.customer_code
 AND keeper.customer_name = duplicate_row.customer_name
 AND keeper.delivery_code <=> duplicate_row.delivery_code
 AND keeper.delivery_description <=> duplicate_row.delivery_description
 AND keeper.account_code <=> duplicate_row.account_code
 AND keeper.account_description <=> duplicate_row.account_description
 AND keeper.branch_code <=> duplicate_row.branch_code
 AND keeper.branch_description <=> duplicate_row.branch_description
 AND keeper.note_1 <=> duplicate_row.note_1;

-- Validate that no duplicate logical sales-line groups remain.
SELECT
  COUNT(*) AS remaining_duplicate_groups,
  COALESCE(SUM(group_size - 1), 0) AS remaining_duplicate_rows
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
) duplicate_groups;
