import csv
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from mysql_db import get_conn, init_schema

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SALES_FILES = [
    BASE_DIR / "2025.CSV",
    BASE_DIR / "2026.CSV",
]
PROGRESS_EVERY_ROWS = 5000
LOCK_WAIT_TIMEOUT_SECONDS = 5
VALID_IMPORT_MODES = {"incremental", "full_refresh"}


def parse_decimal(value):
    text = str(value or "").strip().replace(".", "").replace(",", ".")
    if not text:
        return 0.0
    return float(text)


def parse_date(value):
    text = str(value or "").strip()
    if not text:
        return ""
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"Unsupported date format: {text}")


class ImportStats:
    def __init__(self, dataset, file_name):
        self.dataset = dataset
        self.file_name = file_name
        self.rows_in = 0
        self.rows_upserted = 0


def resolve_sales_files():
    env = os.environ
    explicit = str(env.get("ENTERSOFT_SALES_FILES", "")).strip()
    if explicit:
        files = [Path(part.strip()) for part in explicit.split(",") if part.strip()]
        if files:
            return files

    daily = str(env.get("ENTERSOFT_DAILY_INFO_FILE", "")).strip()
    if daily:
        return [Path(daily)]

    return list(DEFAULT_SALES_FILES)


def resolve_import_mode() -> str:
    mode = str(os.getenv("ENTERSOFT_IMPORT_MODE", "incremental")).strip().lower()
    if mode not in VALID_IMPORT_MODES:
        raise RuntimeError(
            f"Unsupported ENTERSOFT_IMPORT_MODE='{mode}'. "
            f"Allowed values: {', '.join(sorted(VALID_IMPORT_MODES))}"
        )
    return mode


def begin_import(cur, dataset: str, file_name: str) -> int:
    started_at = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        INSERT INTO import_runs(dataset, file_name, status, started_at)
        VALUES (%s, %s, 'running', %s)
        """,
        (dataset, file_name, started_at),
    )
    return cur.lastrowid


def configure_session(cur) -> None:
    # Fail fast if a table lock/metadata lock blocks import writes.
    cur.execute(f"SET SESSION innodb_lock_wait_timeout = {LOCK_WAIT_TIMEOUT_SECONDS}")


def execute_step(cur, label: str, sql: str, params=None) -> None:
    try:
        if params is None:
            cur.execute(sql)
        else:
            cur.execute(sql, params)
    except Exception as exc:
        message = str(exc).lower()
        if "lock wait timeout" in message:
            print(
                f"[import] lock timeout during '{label}'. "
                "Another session is locking tables. Stop Node app, kill long Sleep localhost DB sessions, retry.",
                flush=True,
            )
        raise


def finish_import(cur, run_id: int, stats: ImportStats, status: str = "success", error_text: Optional[str] = None) -> None:
    finished_at = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        UPDATE import_runs
        SET status = %s, finished_at = %s, rows_in = %s, rows_upserted = %s, error_text = %s
        WHERE id = %s
        """,
        (status, finished_at, stats.rows_in, stats.rows_upserted, error_text, run_id),
    )


def rebuild_customers_from_sales(cur) -> None:
    execute_step(cur, "truncate imported_customers", "DELETE FROM imported_customers")
    execute_step(
        cur,
        "rebuild imported_customers from sales",
        """
        INSERT INTO imported_customers(
          customer_code,
          customer_name,
          delivery_code,
          delivery_description,
          source_file
        )
        SELECT
          customer_code,
          COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS customer_name,
          MAX(delivery_code) AS delivery_code,
          MAX(delivery_description) AS delivery_description,
          MAX(source_file) AS source_file
        FROM imported_sales_lines
        GROUP BY customer_code
        """,
    )
    execute_step(
        cur,
        "delete mirrored customers",
        "DELETE FROM customers WHERE source = 'entersoft_import'",
    )
    execute_step(
        cur,
        "mirror imported customers",
        """
        INSERT INTO customers(code, name, email, source)
        SELECT customer_code, customer_name, NULL, 'entersoft_import'
        FROM imported_customers
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          email = VALUES(email),
          source = VALUES(source)
        """,
    )


def rebuild_sales_aggregates(cur) -> None:
    execute_step(cur, "truncate imported_orders", "DELETE FROM imported_orders")
    execute_step(cur, "truncate imported_monthly_sales", "DELETE FROM imported_monthly_sales")
    execute_step(cur, "truncate imported_product_sales", "DELETE FROM imported_product_sales")

    execute_step(
        cur,
        "build imported_orders",
        """
        INSERT INTO imported_orders(
          order_id, document_no, customer_code, customer_name, created_at, total_lines, total_pieces,
          total_net_value, average_discount_pct, document_type, delivery_code,
          delivery_description, source_file
        )
        SELECT
          CONCAT(customer_code, '::', order_date, '::', document_no) AS order_id,
          document_no,
          customer_code,
          MAX(customer_name),
          order_date,
          COUNT(*) AS total_lines,
          COALESCE(SUM(qty_base), 0) AS total_pieces,
          COALESCE(SUM(net_value), 0) AS total_net_value,
          0 AS average_discount_pct,
          MAX(document_type),
          MAX(delivery_code),
          MAX(delivery_description),
          MAX(source_file)
        FROM imported_sales_lines
        GROUP BY document_no, customer_code, order_date
        """
    )

    execute_step(
        cur,
        "build imported_monthly_sales",
        """
        INSERT INTO imported_monthly_sales(customer_code, order_year, order_month, revenue, pieces)
        SELECT
          customer_code,
          order_year,
          order_month,
          COALESCE(SUM(net_value), 0) AS revenue,
          COALESCE(SUM(qty_base), 0) AS pieces
        FROM imported_sales_lines
        GROUP BY customer_code, order_year, order_month
        """
    )

    execute_step(
        cur,
        "build imported_product_sales",
        """
        INSERT INTO imported_product_sales(
          customer_code, item_code, item_description, revenue, pieces, orders, avg_unit_price
        )
        SELECT
          customer_code,
          item_code,
          MAX(item_description),
          COALESCE(SUM(net_value), 0) AS revenue,
          COALESCE(SUM(qty_base), 0) AS pieces,
          COUNT(DISTINCT CONCAT(customer_code, '::', order_date, '::', document_no)) AS orders,
          CASE
            WHEN COALESCE(SUM(qty_base), 0) > 0 THEN COALESCE(SUM(net_value), 0) / SUM(qty_base)
            ELSE 0
          END AS avg_unit_price
        FROM imported_sales_lines
        GROUP BY customer_code, item_code
        """
    )


def import_sales_lines(cur, sales_files, import_mode: str) -> ImportStats:
    stats = ImportStats(dataset="sales_lines", file_name=",".join(path.name for path in sales_files))
    print(f"[import] sales_lines: starting ({stats.file_name})", flush=True)
    run_id = begin_import(cur, stats.dataset, stats.file_name)
    try:
        if import_mode == "full_refresh":
            execute_step(cur, "truncate imported_sales_lines", "DELETE FROM imported_sales_lines")

        for sales_file in sales_files:
            print(f"[import] sales_lines: reading {sales_file.name}", flush=True)
            with sales_file.open("r", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f, delimiter="\t")
                for row in reader:
                    stats.rows_in += 1
                    customer_code = str(row.get("Κωδικός", "")).strip()
                    document_no = str(row.get("Παραστατικό", "")).strip()
                    item_code = str(row.get("Είδος", "")).strip()
                    order_date = parse_date(row.get("Ημ/νία "))
                    if not (customer_code and document_no and item_code and order_date):
                        continue

                    order_dt = datetime.strptime(order_date, "%Y-%m-%d")
                    document_type = str(row.get("Τύπος Παραστατικών", "")).strip()
                    item_description = str(row.get("Περιγραφή", "")).strip()
                    unit_code = str(row.get("ΜΜ", "")).strip()
                    qty = parse_decimal(row.get("Ποσότητα"))
                    qty_base = parse_decimal(row.get("Ποσότητα σε βασική ΜΜ"))
                    unit_price = parse_decimal(row.get("Τιμή"))
                    net_value = parse_decimal(row.get("Καθαρή  αξία "))
                    customer_name = str(row.get("Επωνυμία/Ονοματεπώνυμο", "")).strip()
                    delivery_code = str(row.get("Κωδικός1", "")).strip()
                    delivery_description = str(row.get("Περιγραφή1", "")).strip()
                    account_code = str(row.get("Κωδ. ΑΧ ", "")).strip()
                    account_description = str(row.get("Περ. ΑΧ", "")).strip()
                    branch_code = str(row.get("Κωδ.υποκ.", "")).strip()
                    branch_description = str(row.get("Περ.υποκ.", "")).strip()
                    note_1 = str(row.get("Σχόλιο 1", "")).strip()

                    execute_step(
                        cur,
                        "insert imported_sales_lines row",
                        """
                        INSERT IGNORE INTO imported_sales_lines(
                          source_file, order_date, order_year, order_month, document_no, document_type,
                          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
                          customer_code, customer_name, delivery_code, delivery_description, account_code,
                          account_description, branch_code, branch_description, note_1
                        )
                        SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        FROM DUAL
                        WHERE NOT EXISTS (
                          SELECT 1
                          FROM imported_sales_lines existing
                          WHERE existing.order_date = %s
                            AND existing.document_no = %s
                            AND existing.document_type = %s
                            AND existing.item_code = %s
                            AND existing.item_description = %s
                            AND existing.unit_code = %s
                            AND existing.qty = %s
                            AND existing.qty_base = %s
                            AND existing.unit_price = %s
                            AND existing.net_value = %s
                            AND existing.customer_code = %s
                            AND existing.customer_name = %s
                            AND existing.delivery_code = %s
                            AND existing.delivery_description = %s
                            AND existing.account_code = %s
                            AND existing.account_description = %s
                            AND existing.branch_code = %s
                            AND existing.branch_description = %s
                            AND existing.note_1 = %s
                        )
                        """,
                        (
                            sales_file.name,
                            order_date,
                            order_dt.year,
                            order_dt.month,
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
                            note_1,
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
                            note_1,
                        ),
                    )
                    stats.rows_upserted += cur.rowcount
                    if stats.rows_in % PROGRESS_EVERY_ROWS == 0:
                        print(
                            f"[import] sales_lines: rows_in={stats.rows_in}, rows_upserted={stats.rows_upserted}",
                            flush=True,
                        )

            print(
                f"[import] sales_lines: finished {sales_file.name} (rows_in={stats.rows_in}, rows_upserted={stats.rows_upserted})",
                flush=True,
            )

        rebuild_customers_from_sales(cur)
        print("[import] customers: rebuilt from sales files", flush=True)
        rebuild_sales_aggregates(cur)

        finish_import(cur, run_id, stats)
        print(
            f"[import] sales_lines: completed rows_in={stats.rows_in}, rows_upserted={stats.rows_upserted}",
            flush=True,
        )
        return stats
    except Exception as exc:
        finish_import(cur, run_id, stats, status="failed", error_text=str(exc))
        print(f"[import] sales_lines: failed ({exc})", flush=True)
        raise


def main() -> None:
    init_schema()
    conn = get_conn()
    cur = conn.cursor()
    configure_session(cur)
    print(f"[import] session lock wait timeout set to {LOCK_WAIT_TIMEOUT_SECONDS}s", flush=True)
    import_mode = resolve_import_mode()
    print(f"[import] mode: {import_mode}", flush=True)
    sales_files = resolve_sales_files()

    if not sales_files:
        raise RuntimeError("No sales files configured. Set ENTERSOFT_SALES_FILES or ENTERSOFT_DAILY_INFO_FILE.")

    for sales_file in sales_files:
        if not sales_file.exists():
            raise FileNotFoundError(f"Sales file not found: {sales_file}")

    print(f"[import] using sales files: {', '.join(str(p) for p in sales_files)}", flush=True)

    try:
        sales_stats = import_sales_lines(cur, sales_files, import_mode)
        conn.commit()
        print(f"Imported sales_lines={sales_stats.rows_upserted}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        raise
