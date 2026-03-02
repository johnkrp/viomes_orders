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

def init_schema() -> None:
    conn = get_conn()
    cur = conn.cursor()

    # προϊόντα
    cur.execute("""
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE
        CHECK (
          length(code) > 0
          AND code GLOB '[0-9]*'
          AND code NOT GLOB '*[^0-9-+/.,_ ]*'
        ),   -- απλό constraint: αριθμοί-αριθμοί
      description TEXT NOT NULL,
      image_url TEXT,
      pieces_per_package INTEGER NOT NULL CHECK(pieces_per_package > 0),
      volume_liters REAL NOT NULL CHECK(volume_liters >= 0),
      color TEXT,
      description_norm TEXT,
      color_norm TEXT
              
    );
    """)

    # παραγγελίες
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

    conn.commit()
    conn.close()
