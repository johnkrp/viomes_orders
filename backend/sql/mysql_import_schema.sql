CREATE TABLE IF NOT EXISTS imported_customers (
  customer_code VARCHAR(128) PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  delivery_code VARCHAR(128),
  delivery_description VARCHAR(255),
  address_1 VARCHAR(255),
  postal_code VARCHAR(64),
  city VARCHAR(128),
  region VARCHAR(128),
  country VARCHAR(128),
  phone VARCHAR(128),
  pallet_info VARCHAR(128),
  delivery_method VARCHAR(128),
  salesperson_code VARCHAR(128),
  salesperson_name VARCHAR(255),
  is_inactive TINYINT(1) NOT NULL DEFAULT 0,
  source_file VARCHAR(255),
  imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS imported_sales_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_file VARCHAR(255) NOT NULL,
  order_date DATE NOT NULL,
  order_year INT NOT NULL,
  order_month INT NOT NULL,
  document_no VARCHAR(128) NOT NULL,
  document_type VARCHAR(128),
  item_code VARCHAR(128) NOT NULL,
  item_description VARCHAR(255) NOT NULL,
  unit_code VARCHAR(32),
  qty DOUBLE NOT NULL DEFAULT 0,
  qty_base DOUBLE NOT NULL DEFAULT 0,
  unit_price DOUBLE NOT NULL DEFAULT 0,
  net_value DOUBLE NOT NULL DEFAULT 0,
  customer_code VARCHAR(128) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  delivery_code VARCHAR(128),
  delivery_description VARCHAR(255),
  account_code VARCHAR(128),
  account_description VARCHAR(255),
  branch_code VARCHAR(128),
  branch_description VARCHAR(255),
  note_1 VARCHAR(255),
  UNIQUE KEY uq_imported_sales_line(
    source_file, document_no, item_code, customer_code, delivery_code, net_value, qty
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS imported_orders (
  order_id VARCHAR(300) PRIMARY KEY,
  document_no VARCHAR(128) NOT NULL,
  customer_code VARCHAR(128) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  total_lines INT NOT NULL DEFAULT 0,
  total_pieces DOUBLE NOT NULL DEFAULT 0,
  total_net_value DOUBLE NOT NULL DEFAULT 0,
  average_discount_pct DOUBLE NOT NULL DEFAULT 0,
  document_type VARCHAR(128),
  delivery_code VARCHAR(128),
  delivery_description VARCHAR(255),
  source_file VARCHAR(255),
  imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS imported_monthly_sales (
  customer_code VARCHAR(128) NOT NULL,
  order_year INT NOT NULL,
  order_month INT NOT NULL,
  revenue DOUBLE NOT NULL DEFAULT 0,
  pieces DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY(customer_code, order_year, order_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS imported_product_sales (
  customer_code VARCHAR(128) NOT NULL,
  item_code VARCHAR(128) NOT NULL,
  item_description VARCHAR(255) NOT NULL,
  revenue DOUBLE NOT NULL DEFAULT 0,
  pieces DOUBLE NOT NULL DEFAULT 0,
  orders INT NOT NULL DEFAULT 0,
  avg_unit_price DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY(customer_code, item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS import_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dataset VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  import_mode VARCHAR(32) NOT NULL DEFAULT 'incremental',
  status VARCHAR(32) NOT NULL,
  started_at VARCHAR(64) NOT NULL,
  finished_at VARCHAR(64),
  source_files_json LONGTEXT,
  source_checksum VARCHAR(64),
  source_row_count INT NOT NULL DEFAULT 0,
  rows_in INT NOT NULL DEFAULT 0,
  rows_upserted INT NOT NULL DEFAULT 0,
  rows_skipped_duplicate INT NOT NULL DEFAULT 0,
  rows_rejected INT NOT NULL DEFAULT 0,
  rebuild_started_at VARCHAR(64),
  rebuild_finished_at VARCHAR(64),
  schema_version VARCHAR(32) NOT NULL DEFAULT 'import-ledger-v2',
  trigger_source VARCHAR(64),
  metadata_json LONGTEXT,
  error_text TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
