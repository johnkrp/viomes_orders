from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from db import get_conn, init_schema

BASE_DIR = Path(__file__).resolve().parent
CUSTOMERS_FILE = BASE_DIR / "customers.csv"
SALES_FILES = [
    BASE_DIR / "info_2025.csv",
    BASE_DIR / "info_2026.csv",
]


def parse_decimal(value: str | None) -> float:
    text = str(value or "").strip().replace(".", "").replace(",", ".")
    if not text:
      return 0.0
    return float(text)


def parse_int_flag(value: str | None) -> int:
    return 1 if str(value or "").strip() in {"1", "true", "True"} else 0


def parse_date(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
      return ""
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
      try:
        return datetime.strptime(text, fmt).date().isoformat()
      except ValueError:
        continue
    raise ValueError(f"Unsupported date format: {text}")


@dataclass
class ImportStats:
    dataset: str
    file_name: str
    rows_in: int = 0
    rows_upserted: int = 0


def begin_import(cur, dataset: str, file_name: str) -> int:
    started_at = datetime.now(UTC).isoformat()
    cur.execute(
        """
        INSERT INTO import_runs(dataset, file_name, status, started_at)
        VALUES (?, ?, 'running', ?)
        """,
        (dataset, file_name, started_at),
    )
    return cur.lastrowid


def finish_import(cur, run_id: int, stats: ImportStats, status: str = "success", error_text: str | None = None) -> None:
    finished_at = datetime.now(UTC).isoformat()
    cur.execute(
        """
        UPDATE import_runs
        SET status = ?, finished_at = ?, rows_in = ?, rows_upserted = ?, error_text = ?
        WHERE id = ?
        """,
        (status, finished_at, stats.rows_in, stats.rows_upserted, error_text, run_id),
    )


def import_customers(cur) -> ImportStats:
    stats = ImportStats(dataset="customers", file_name=CUSTOMERS_FILE.name)
    run_id = begin_import(cur, stats.dataset, stats.file_name)
    try:
        cur.execute("DELETE FROM imported_customers")

        with CUSTOMERS_FILE.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                stats.rows_in += 1
                customer_code = str(row.get("Κωδικός Πελάτη", "")).strip()
                customer_name = str(row.get("Επων. Πελάτη", "")).strip()
                if not customer_code or not customer_name:
                    continue
                cur.execute(
                    """
                    INSERT OR REPLACE INTO imported_customers(
                      customer_code, customer_name, delivery_code, delivery_description,
                      address_1, postal_code, city, region, country, phone,
                      pallet_info, delivery_method, salesperson_code, salesperson_name,
                      is_inactive, source_file
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        customer_code,
                        customer_name,
                        str(row.get("Κωδικός", "")).strip(),
                        str(row.get("Περιγραφή", "")).strip(),
                        str(row.get("Δ/νση 1", "")).strip(),
                        str(row.get("Ταχ.Κώδικας", "")).strip(),
                        str(row.get("Πόλη", "")).strip(),
                        str(row.get("Περιοχή", "")).strip(),
                        str(row.get("Χώρα", "")).strip(),
                        str(row.get("Τηλέφωνο 1", "")).strip(),
                        str(row.get("Παλέτες", "")).strip(),
                        str(row.get("Τρόπος Παράδοσης", "")).strip(),
                        str(row.get("Κωδικός Πωλητή", "")).strip(),
                        str(row.get("Επων. Πωλητή", "")).strip(),
                        parse_int_flag(row.get("Ανενεργός")),
                        CUSTOMERS_FILE.name,
                    ),
                )
                stats.rows_upserted += 1

        cur.execute("DELETE FROM customers WHERE source = 'entersoft_import'")
        cur.execute(
            """
            INSERT INTO customers(code, name, email, source)
            SELECT customer_code, customer_name, NULL, 'entersoft_import'
            FROM imported_customers
            """
        )
        finish_import(cur, run_id, stats)
        return stats
    except Exception as exc:
        finish_import(cur, run_id, stats, status="failed", error_text=str(exc))
        raise


def import_sales_lines(cur) -> ImportStats:
    stats = ImportStats(dataset="sales_lines", file_name=",".join(path.name for path in SALES_FILES))
    run_id = begin_import(cur, stats.dataset, stats.file_name)
    try:
        cur.execute("DELETE FROM imported_sales_lines")
        cur.execute("DELETE FROM imported_orders")
        cur.execute("DELETE FROM imported_monthly_sales")
        cur.execute("DELETE FROM imported_product_sales")

        for sales_file in SALES_FILES:
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
                    order_dt = datetime.fromisoformat(order_date)
                    cur.execute(
                        """
                        INSERT OR IGNORE INTO imported_sales_lines(
                          source_file, order_date, order_year, order_month, document_no, document_type,
                          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
                          customer_code, customer_name, delivery_code, delivery_description, account_code,
                          account_description, branch_code, branch_description, note_1
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            sales_file.name,
                            order_date,
                            order_dt.year,
                            order_dt.month,
                            document_no,
                            str(row.get("Τύπος Παραστατικών", "")).strip(),
                            item_code,
                            str(row.get("Περιγραφή", "")).strip(),
                            str(row.get("ΜΜ", "")).strip(),
                            parse_decimal(row.get("Ποσότητα")),
                            parse_decimal(row.get("Ποσότητα σε βασική ΜΜ")),
                            parse_decimal(row.get("Τιμή")),
                            parse_decimal(row.get("Καθαρή  αξία ")),
                            customer_code,
                            str(row.get("Επωνυμία/Ονοματεπώνυμο", "")).strip(),
                            str(row.get("Κωδικός1", "")).strip(),
                            str(row.get("Περιγραφή1", "")).strip(),
                            str(row.get("Κωδ. ΑΧ ", "")).strip(),
                            str(row.get("Περ. ΑΧ", "")).strip(),
                            str(row.get("Κωδ.υποκ.", "")).strip(),
                            str(row.get("Περ.υποκ.", "")).strip(),
                            str(row.get("Σχόλιο 1", "")).strip(),
                        ),
                    )
                    stats.rows_upserted += cur.rowcount

        cur.execute(
            """
            INSERT INTO imported_orders(
              order_id, customer_code, customer_name, created_at, total_lines, total_pieces,
              total_net_value, average_discount_pct, document_type, delivery_code,
              delivery_description, source_file
            )
            SELECT
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

        cur.execute(
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

        cur.execute(
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
              COUNT(DISTINCT document_no) AS orders,
              CASE
                WHEN COALESCE(SUM(qty_base), 0) > 0 THEN COALESCE(SUM(net_value), 0) / SUM(qty_base)
                ELSE 0
              END AS avg_unit_price
            FROM imported_sales_lines
            GROUP BY customer_code, item_code
            """
        )

        finish_import(cur, run_id, stats)
        return stats
    except Exception as exc:
        finish_import(cur, run_id, stats, status="failed", error_text=str(exc))
        raise


def main() -> None:
    init_schema()
    conn = get_conn()
    cur = conn.cursor()

    try:
        customer_stats = import_customers(cur)
        sales_stats = import_sales_lines(cur)
        conn.commit()
        print(
            f"Imported customers={customer_stats.rows_upserted}, "
            f"sales_lines={sales_stats.rows_upserted}"
        )
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
