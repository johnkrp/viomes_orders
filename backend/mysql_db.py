import os
from pathlib import Path
from typing import List

import pymysql
from pymysql.cursors import DictCursor

# Transitional schema helper for the Python importer.
# The Node runtime schema initializer in site/lib/db/init-schema.js is the primary authority;
# keep this file compatible with it and avoid independent schema drift.

BASE_DIR = Path(__file__).resolve().parent
MYSQL_IMPORT_SCHEMA_PATH = BASE_DIR / "sql" / "mysql_import_schema.sql"


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def get_conn():
    host = os.getenv("MYSQL_HOST", "127.0.0.1").strip()
    port = int(os.getenv("MYSQL_PORT", "3306"))
    user = _required_env("MYSQL_USER")
    password = os.getenv("MYSQL_PASSWORD", "")
    database = _required_env("MYSQL_DATABASE")

    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        cursorclass=DictCursor,
        charset="utf8mb4",
        autocommit=False,
    )


def _has_column(cur, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT COUNT(*) AS n
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = %s
          AND column_name = %s
        """,
        (table, column),
    )
    row = cur.fetchone() or {}
    return int(row.get("n", 0)) > 0


def _ensure_column(cur, table: str, column: str, ddl: str) -> None:
    if not _has_column(cur, table, column):
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def _has_index(cur, table: str, index_name: str) -> bool:
    cur.execute(
        """
        SELECT COUNT(*) AS n
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = %s
          AND index_name = %s
        """,
        (table, index_name),
    )
    row = cur.fetchone() or {}
    return int(row.get("n", 0)) > 0


def _ensure_index(cur, table: str, index_name: str, ddl: str) -> None:
    if not _has_index(cur, table, index_name):
        cur.execute(f"CREATE INDEX {index_name} ON {table} {ddl}")


def _column_definition(cur, table: str, column: str) -> str:
    cur.execute(
        """
        SELECT column_type
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = %s
          AND column_name = %s
        """,
        (table, column),
    )
    row = cur.fetchone() or {}
    return str(row.get("column_type", "")).lower()


def _ensure_column_type(cur, table: str, column: str, ddl: str) -> None:
    definition = _column_definition(cur, table, column)
    if definition == ddl.lower():
        return
    cur.execute(f"ALTER TABLE {table} MODIFY COLUMN {column} {ddl}")


def _load_sql_statements(path: Path) -> List[str]:
    content = path.read_text(encoding="utf-8")
    return [statement.strip() for statement in content.split(";") if statement.strip()]


def init_schema() -> None:
    conn = get_conn()
    cur = conn.cursor()

    statements = [
        """
        CREATE TABLE IF NOT EXISTS customers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(128) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          source VARCHAR(64) NOT NULL DEFAULT 'local'
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """,
        *_load_sql_statements(MYSQL_IMPORT_SCHEMA_PATH),
    ]

    for sql in statements:
        cur.execute(sql)

    _ensure_column(cur, "customers", "source", "source VARCHAR(64) NOT NULL DEFAULT 'local'")
    _ensure_column(cur, "imported_orders", "document_no", "document_no VARCHAR(128) NOT NULL DEFAULT ''")
    _ensure_column(cur, "imported_sales_lines", "ordered_at", "ordered_at VARCHAR(64)")
    _ensure_column(cur, "imported_sales_lines", "sent_at", "sent_at VARCHAR(64)")
    _ensure_column(cur, "imported_orders", "ordered_at", "ordered_at VARCHAR(64)")
    _ensure_column(cur, "imported_orders", "sent_at", "sent_at VARCHAR(64)")
    _ensure_column(cur, "imported_customers", "branch_code", "branch_code VARCHAR(128)")
    _ensure_column(cur, "imported_customers", "branch_description", "branch_description VARCHAR(255)")
    _ensure_column(cur, "imported_customer_branches", "customer_name", "customer_name VARCHAR(255) NOT NULL")
    _ensure_column(cur, "imported_customer_branches", "orders", "orders INT NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_branches", "revenue", "revenue DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_branches", "last_order_date", "last_order_date VARCHAR(64)")
    _ensure_column(cur, "imported_customer_branches", "source_file", "source_file VARCHAR(255)")
    _ensure_column(cur, "imported_customer_ledgers", "customer_name", "customer_name VARCHAR(255) NOT NULL DEFAULT ''")
    _ensure_column(cur, "imported_customer_ledgers", "opening_balance", "opening_balance DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledgers", "debit", "debit DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledgers", "credit", "credit DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledgers", "ledger_balance", "ledger_balance DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledgers", "pending_instruments", "pending_instruments DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledgers", "commercial_balance", "commercial_balance DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledgers", "email", "email VARCHAR(255)")
    _ensure_column(cur, "imported_customer_ledgers", "is_inactive", "is_inactive TINYINT(1) NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledgers", "salesperson_code", "salesperson_code VARCHAR(128)")
    _ensure_column(cur, "imported_customer_ledgers", "source_file", "source_file VARCHAR(255)")
    _ensure_column(cur, "imported_customer_ledger_lines", "customer_name", "customer_name VARCHAR(255) NOT NULL DEFAULT ''")
    _ensure_column(cur, "imported_customer_ledger_lines", "document_date", "document_date DATE")
    _ensure_column(cur, "imported_customer_ledger_lines", "document_no", "document_no VARCHAR(128) NOT NULL DEFAULT ''")
    _ensure_column(cur, "imported_customer_ledger_lines", "reason", "reason VARCHAR(255) NOT NULL DEFAULT ''")
    _ensure_column(cur, "imported_customer_ledger_lines", "debit", "debit DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledger_lines", "credit", "credit DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledger_lines", "running_debit", "running_debit DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledger_lines", "running_credit", "running_credit DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledger_lines", "ledger_balance", "ledger_balance DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_customer_ledger_lines", "source_file", "source_file VARCHAR(255)")
    _ensure_column(cur, "import_runs", "import_mode", "import_mode VARCHAR(32) NOT NULL DEFAULT 'incremental'")
    _ensure_column(cur, "import_runs", "source_files_json", "source_files_json LONGTEXT")
    _ensure_column(cur, "import_runs", "source_checksum", "source_checksum VARCHAR(64)")
    _ensure_column(cur, "import_runs", "source_row_count", "source_row_count INT NOT NULL DEFAULT 0")
    _ensure_column(cur, "import_runs", "rows_skipped_duplicate", "rows_skipped_duplicate INT NOT NULL DEFAULT 0")
    _ensure_column(cur, "import_runs", "rows_rejected", "rows_rejected INT NOT NULL DEFAULT 0")
    _ensure_column(cur, "import_runs", "rebuild_started_at", "rebuild_started_at VARCHAR(64)")
    _ensure_column(cur, "import_runs", "rebuild_finished_at", "rebuild_finished_at VARCHAR(64)")
    _ensure_column(cur, "import_runs", "schema_version", "schema_version VARCHAR(32) NOT NULL DEFAULT 'import-ledger-v2'")
    _ensure_column(cur, "import_runs", "trigger_source", "trigger_source VARCHAR(64)")
    _ensure_column(cur, "import_runs", "metadata_json", "metadata_json LONGTEXT")
    _ensure_column(cur, "imported_sales_lines", "discount_pct_1", "discount_pct_1 DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_sales_lines", "discount_pct_2", "discount_pct_2 DOUBLE NOT NULL DEFAULT 0")
    _ensure_column(cur, "imported_sales_lines", "discount_pct_total", "discount_pct_total DOUBLE NOT NULL DEFAULT 0")
    _ensure_column_type(cur, "imported_orders", "order_id", "VARCHAR(300) NOT NULL")
    _ensure_index(
        cur,
        "imported_customer_branches",
        "idx_imported_customer_branches_customer_lookup",
        "(customer_code, branch_code, branch_description)",
    )
    _ensure_index(
        cur,
        "imported_customer_ledger_lines",
        "idx_imported_customer_ledger_lines_customer_date",
        "(customer_code, document_date, id)",
    )
    _ensure_index(
        cur,
        "imported_customer_branches",
        "idx_imported_customer_branches_name_lookup",
        "(customer_name(191), branch_description(191))",
    )
    _ensure_index(
        cur,
        "imported_sales_lines",
        "idx_imported_sales_line_lookup",
        "(order_date, document_no, item_code, customer_code, delivery_code)",
    )
    _ensure_index(
        cur,
        "imported_sales_lines",
        "idx_imported_sales_customer_date_doc",
        "(customer_code, order_date, document_no)",
    )
    _ensure_index(
        cur,
        "imported_sales_lines",
        "idx_imported_sales_customer_year_month",
        "(customer_code, order_year, order_month)",
    )
    _ensure_index(
        cur,
        "imported_sales_lines",
        "idx_imported_sales_customer_item",
        "(customer_code, item_code)",
    )
    _ensure_index(
        cur,
        "imported_orders",
        "idx_imported_orders_customer_document_date",
        "(customer_code, document_no, created_at)",
    )

    conn.commit()
    conn.close()
