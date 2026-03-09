# Legacy SQLite schema kept for reference only.
# The active production runtime uses MySQL through site/server.js and the Entersoft importer.
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "app.db"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _has_column(cur: sqlite3.Cursor, table: str, column: str) -> bool:
    rows = cur.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row["name"] == column for row in rows)


def _ensure_column(cur: sqlite3.Cursor, table: str, column: str, ddl: str) -> None:
    if not _has_column(cur, table, column):
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def _has_index(cur: sqlite3.Cursor, table: str, index_name: str) -> bool:
    rows = cur.execute(f"PRAGMA index_list({table})").fetchall()
    return any(row["name"] == index_name for row in rows)


def _ensure_index(cur: sqlite3.Cursor, table: str, index_name: str, ddl: str) -> None:
    if not _has_index(cur, table, index_name):
        cur.execute(f"CREATE INDEX {index_name} ON {table} {ddl}")


def init_schema() -> None:
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE
        CHECK (
          length(code) > 0
          AND code GLOB '[0-9]*'
          AND code NOT GLOB '*[^0-9-+/.,_ ]*'
        ),
      description TEXT NOT NULL,
      image_url TEXT,
      pieces_per_package INTEGER NOT NULL CHECK(pieces_per_package > 0),
      volume_liters REAL NOT NULL CHECK(volume_liters >= 0),
      color TEXT,
      description_norm TEXT,
      color_norm TEXT
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      customer_code TEXT,
      notes TEXT,
      total_qty_pieces INTEGER NOT NULL DEFAULT 0,
      total_net_value REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_pieces INTEGER NOT NULL CHECK(qty_pieces > 0),
      unit_price REAL NOT NULL DEFAULT 0,
      discount_pct REAL NOT NULL DEFAULT 0,
      line_net_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT,
      source TEXT NOT NULL DEFAULT 'local'
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS customer_receivables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT NOT NULL,
      document_no TEXT NOT NULL,
      document_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      amount_total REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      open_balance REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(customer_code, document_no),
      FOREIGN KEY(customer_code) REFERENCES customers(code) ON DELETE CASCADE
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS imported_customers (
      customer_code TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      delivery_code TEXT,
      delivery_description TEXT,
      branch_code TEXT,
      branch_description TEXT,
      address_1 TEXT,
      postal_code TEXT,
      city TEXT,
      region TEXT,
      country TEXT,
      phone TEXT,
      pallet_info TEXT,
      delivery_method TEXT,
      salesperson_code TEXT,
      salesperson_name TEXT,
      is_inactive INTEGER NOT NULL DEFAULT 0,
      source_file TEXT,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS imported_sales_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT NOT NULL,
      order_date TEXT NOT NULL,
      order_year INTEGER NOT NULL,
      order_month INTEGER NOT NULL,
      document_no TEXT NOT NULL,
      document_type TEXT,
      item_code TEXT NOT NULL,
      item_description TEXT NOT NULL,
      unit_code TEXT,
      qty REAL NOT NULL DEFAULT 0,
      qty_base REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      net_value REAL NOT NULL DEFAULT 0,
      customer_code TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      delivery_code TEXT,
      delivery_description TEXT,
      account_code TEXT,
      account_description TEXT,
      branch_code TEXT,
      branch_description TEXT,
      note_1 TEXT,
      UNIQUE(source_file, document_no, item_code, customer_code, delivery_code, net_value, qty)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS imported_orders (
      order_id TEXT PRIMARY KEY,
      document_no TEXT NOT NULL DEFAULT '',
      customer_code TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      total_lines INTEGER NOT NULL DEFAULT 0,
      total_pieces REAL NOT NULL DEFAULT 0,
      total_net_value REAL NOT NULL DEFAULT 0,
      average_discount_pct REAL NOT NULL DEFAULT 0,
      document_type TEXT,
      delivery_code TEXT,
      delivery_description TEXT,
      source_file TEXT,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS imported_monthly_sales (
      customer_code TEXT NOT NULL,
      order_year INTEGER NOT NULL,
      order_month INTEGER NOT NULL,
      revenue REAL NOT NULL DEFAULT 0,
      pieces REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(customer_code, order_year, order_month)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS imported_product_sales (
      customer_code TEXT NOT NULL,
      item_code TEXT NOT NULL,
      item_description TEXT NOT NULL,
      revenue REAL NOT NULL DEFAULT 0,
      pieces REAL NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      avg_unit_price REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(customer_code, item_code)
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset TEXT NOT NULL,
      file_name TEXT NOT NULL,
      import_mode TEXT NOT NULL DEFAULT 'incremental',
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      source_files_json TEXT,
      source_checksum TEXT,
      source_row_count INTEGER NOT NULL DEFAULT 0,
      rows_in INTEGER NOT NULL DEFAULT 0,
      rows_upserted INTEGER NOT NULL DEFAULT 0,
      rows_skipped_duplicate INTEGER NOT NULL DEFAULT 0,
      rows_rejected INTEGER NOT NULL DEFAULT 0,
      rebuild_started_at TEXT,
      rebuild_finished_at TEXT,
      schema_version TEXT NOT NULL DEFAULT 'import-ledger-v2',
      trigger_source TEXT,
      metadata_json TEXT,
      error_text TEXT
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );
    """)

    _ensure_column(cur, "orders", "customer_code", "customer_code TEXT")
    _ensure_column(cur, "orders", "total_qty_pieces", "total_qty_pieces INTEGER NOT NULL DEFAULT 0")
    _ensure_column(cur, "orders", "total_net_value", "total_net_value REAL NOT NULL DEFAULT 0")
    _ensure_column(cur, "order_lines", "unit_price", "unit_price REAL NOT NULL DEFAULT 0")
    _ensure_column(cur, "order_lines", "discount_pct", "discount_pct REAL NOT NULL DEFAULT 0")
    _ensure_column(cur, "order_lines", "line_net_value", "line_net_value REAL NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_orders", "document_no", "document_no TEXT NOT NULL DEFAULT ''")
    _ensure_column(cur, "imported_customers", "branch_code", "branch_code TEXT")
    _ensure_column(cur, "imported_customers", "branch_description", "branch_description TEXT")
    _ensure_column(cur, "import_runs", "import_mode", "import_mode TEXT NOT NULL DEFAULT 'incremental'")
    _ensure_column(cur, "import_runs", "source_files_json", "source_files_json TEXT")
    _ensure_column(cur, "import_runs", "source_checksum", "source_checksum TEXT")
    _ensure_column(cur, "import_runs", "source_row_count", "source_row_count INTEGER NOT NULL DEFAULT 0")
    _ensure_column(cur, "import_runs", "rows_skipped_duplicate", "rows_skipped_duplicate INTEGER NOT NULL DEFAULT 0")
    _ensure_column(cur, "import_runs", "rows_rejected", "rows_rejected INTEGER NOT NULL DEFAULT 0")
    _ensure_column(cur, "import_runs", "rebuild_started_at", "rebuild_started_at TEXT")
    _ensure_column(cur, "import_runs", "rebuild_finished_at", "rebuild_finished_at TEXT")
    _ensure_column(cur, "import_runs", "schema_version", "schema_version TEXT NOT NULL DEFAULT 'import-ledger-v2'")
    _ensure_column(cur, "import_runs", "trigger_source", "trigger_source TEXT")
    _ensure_column(cur, "import_runs", "metadata_json", "metadata_json TEXT")
    _ensure_index(
        cur,
        "imported_sales_lines",
        "idx_imported_sales_line_lookup",
        "(order_date, document_no, item_code, customer_code, delivery_code)",
    )
    _ensure_index(
        cur,
        "imported_orders",
        "idx_imported_orders_customer_document_date",
        "(customer_code, document_no, created_at)",
    )

    conn.commit()
    conn.close()
