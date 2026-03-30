import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from document_type_rules import (
    build_analytics_line_filter,
    build_count_in_order_totals_case,
    build_customer_activity_filter,
    build_effective_pieces_expression,
    build_effective_revenue_expression,
)
from factual_lifecycle import (
    EXECUTED_ORDER_DOCUMENT_TYPES,
    OPEN_EXECUTION_DOCUMENT_TYPES,
    build_document_type_sql_list,
)
from mysql_db import get_conn, init_schema

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SALES_FILES = [
    BASE_DIR / "2025.CSV",
    BASE_DIR / "2026.CSV",
]
PROGRESS_EVERY_ROWS = 5000
LOCK_WAIT_TIMEOUT_SECONDS = 5
VALID_IMPORT_MODES = {"incremental", "full_refresh", "replace_sales_year"}
IMPORT_SCHEMA_VERSION = "import-ledger-v2"
RAW_FACT_TABLE = "imported_sales_lines"
PROJECTION_TABLES = [
    "imported_customers",
    "imported_customer_branches",
    "imported_orders",
    "imported_open_orders",
    "imported_monthly_sales",
    "imported_product_sales",
]
LEGACY_DORMANT_TABLES = [
    "orders",
    "order_lines",
    "customer_receivables",
]

IMPORTED_DISCOUNT_PERCENT_EXPRESSION = """
CASE
  WHEN COALESCE(discount_pct_total, 0) <> 0 THEN discount_pct_total
  WHEN COALESCE(qty_base, 0) > 0 AND COALESCE(unit_price, 0) > 0 THEN
    CASE
      WHEN (100 - ((ABS(net_value) / (ABS(qty_base) * ABS(unit_price))) * 100)) < 0 THEN 0
      WHEN (100 - ((ABS(net_value) / (ABS(qty_base) * ABS(unit_price))) * 100)) > 100 THEN 100
      ELSE (100 - ((ABS(net_value) / (ABS(qty_base) * ABS(unit_price))) * 100))
    END
  ELSE 0
END
""".strip()

OPEN_ORDER_REF_EXPRESSION = (
        "NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(SUBSTRING_INDEX(note_1, ':', -1))), '|', ''), ' ', ''), '.', ''), ':', ''), '')"
)

OPEN_EXECUTION_DOCUMENT_TYPES_SQL = build_document_type_sql_list(OPEN_EXECUTION_DOCUMENT_TYPES)
EXECUTED_ORDER_DOCUMENT_TYPES_SQL = build_document_type_sql_list(EXECUTED_ORDER_DOCUMENT_TYPES)


def parse_decimal(value):
    text = str(value or "").strip().replace(".", "").replace(",", ".")
    if not text:
        return 0.0
    return float(text)


def get_row_value(row, *keys):
    for key in keys:
        try:
            value = row.get(key)
        except Exception:
            continue
        if value not in (None, ""):
            return value
    return ""


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


def parse_optional_datetime_date(value):
    text = str(value or "").strip()
    if not text:
        return ""
    return parse_date(text.split(" ")[0])


def build_branch_description(branch_description, postal_code):
    description = str(branch_description or "").strip()
    postcode = str(postal_code or "").strip()
    if not postcode:
        return description
    if not description:
        return postcode
    if postcode in description:
        return description
    return f"{description} ({postcode})"


class ImportStats:
    def __init__(self, dataset, file_name, import_mode, source_files_json, source_checksum, trigger_source, metadata_json):
        self.dataset = dataset
        self.file_name = file_name
        self.import_mode = import_mode
        self.source_files_json = source_files_json
        self.source_checksum = source_checksum
        self.trigger_source = trigger_source
        self.metadata_json = metadata_json
        self.source_row_count = 0
        self.rows_in = 0
        self.rows_upserted = 0
        self.rows_skipped_duplicate = 0
        self.rows_replaced = 0
        self.rows_skipped_ambiguous = 0
        self.rows_rejected = 0
        self.rebuild_started_at = None
        self.rebuild_finished_at = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_trigger_source() -> Optional[str]:
    for key in ("IMPORT_TRIGGER_SOURCE", "ENTERSOFT_IMPORT_TRIGGER_SOURCE"):
        value = str(os.getenv(key, "")).strip()
        if value:
            return value
    return "manual_or_cli"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def describe_source_files(sales_files) -> Tuple[str, str]:
    files = []
    overall_digest = hashlib.sha256()

    for sales_file in sales_files:
        stat = sales_file.stat()
        checksum = sha256_file(sales_file)
        files.append(
            {
                "name": sales_file.name,
                "path": str(sales_file),
                "size_bytes": int(stat.st_size),
                "sha256": checksum,
            }
        )
        overall_digest.update(f"{sales_file.name}:{checksum}".encode("utf-8"))

    return (
        json.dumps(files, ensure_ascii=True, separators=(",", ":")),
        overall_digest.hexdigest(),
    )


def build_import_metadata_json(import_mode: str, replace_sales_year: Optional[int] = None) -> str:
    return json.dumps(
        {
            "raw_fact_table": RAW_FACT_TABLE,
            "projection_tables": PROJECTION_TABLES,
            "customer_projection_table": "customers",
            "projection_strategy": "truncate_and_recompute",
            "legacy_dormant_tables": LEGACY_DORMANT_TABLES,
            "import_mode": import_mode,
            "replace_sales_year": replace_sales_year,
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )


def build_ledger_snapshot_metadata_json() -> str:
    return json.dumps(
        {
            "snapshot_table": "imported_customer_ledgers",
            "lines_table": "imported_customer_ledger_lines",
            "snapshot_strategy": "truncate_and_replace",
            "customer_projection_table": "customers",
            "balance_metric": "ledger_balance",
            "dataset": "customer_ledgers",
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )


def has_explicit_sales_config() -> bool:
    env = os.environ
    return bool(
        str(env.get("ENTERSOFT_SALES_FILES", "")).strip()
        or str(env.get("ENTERSOFT_DAILY_INFO_FILE", "")).strip()
    )


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


def resolve_ledger_file() -> Optional[Path]:
    explicit = str(os.getenv("ENTERSOFT_LEDGER_FILE", "")).strip()
    if explicit:
        return Path(explicit)
    return None


def resolve_import_mode() -> str:
    mode = str(os.getenv("ENTERSOFT_IMPORT_MODE", "incremental")).strip().lower()
    if mode not in VALID_IMPORT_MODES:
        raise RuntimeError(
            f"Unsupported ENTERSOFT_IMPORT_MODE='{mode}'. "
            f"Allowed values: {', '.join(sorted(VALID_IMPORT_MODES))}"
        )
    return mode


def resolve_replace_sales_year(import_mode: str) -> Optional[int]:
    value = str(os.getenv("ENTERSOFT_REPLACE_SALES_YEAR", "")).strip()
    if not value:
        if import_mode == "replace_sales_year":
            raise RuntimeError(
                "ENTERSOFT_REPLACE_SALES_YEAR is required when ENTERSOFT_IMPORT_MODE=replace_sales_year."
            )
        return None
    try:
        year = int(value)
    except ValueError as exc:
        raise RuntimeError(f"Invalid ENTERSOFT_REPLACE_SALES_YEAR='{value}'. Expected a 4-digit year.") from exc
    if year < 2000 or year > 2100:
        raise RuntimeError(f"Invalid ENTERSOFT_REPLACE_SALES_YEAR='{value}'. Expected a year between 2000 and 2100.")
    return year


def begin_import(cur, stats: ImportStats) -> int:
    started_at = utc_now_iso()
    cur.execute(
        """
        INSERT INTO import_runs(
          dataset,
          file_name,
          import_mode,
          status,
          started_at,
          source_files_json,
          source_checksum,
          schema_version,
          trigger_source,
          metadata_json
        )
        VALUES (%s, %s, %s, 'running', %s, %s, %s, %s, %s, %s)
        """,
        (
            stats.dataset,
            stats.file_name,
            stats.import_mode,
            started_at,
            stats.source_files_json,
            stats.source_checksum,
            IMPORT_SCHEMA_VERSION,
            stats.trigger_source,
            stats.metadata_json,
        ),
    )
    return cur.lastrowid


def configure_session(cur) -> None:
    # Fail fast if a table lock/metadata lock blocks import writes.
    cur.execute(f"SET SESSION innodb_lock_wait_timeout = {LOCK_WAIT_TIMEOUT_SECONDS}")
    try:
        cur.execute("SET SESSION max_statement_time = 0")
        print("[import] session max_statement_time disabled", flush=True)
    except Exception as exc:
        print(f"[import] could not disable session max_statement_time: {exc}", flush=True)


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


def find_matching_sales_line_ids(
    cur,
    *,
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
):
    execute_step(
        cur,
        "lookup imported_sales_lines business-key matches",
        """
        SELECT id
        FROM imported_sales_lines
        WHERE order_date = %s
          AND document_no = %s
          AND document_type = %s
          AND item_code = %s
          AND item_description = %s
          AND unit_code = %s
          AND net_value = %s
          AND customer_code = %s
          AND customer_name = %s
          AND delivery_code = %s
          AND delivery_description = %s
          AND account_code = %s
          AND account_description = %s
          AND branch_code = %s
          AND branch_description = %s
          AND qty = %s
          AND qty_base = %s
          AND unit_price = %s
        ORDER BY id ASC
        """,
        (
            order_date,
            document_no,
            document_type,
            item_code,
            item_description,
            unit_code,
            net_value,
            customer_code,
            customer_name,
            delivery_code,
            delivery_description,
            account_code,
            account_description,
            branch_code,
            branch_description,
            qty,
            qty_base,
            unit_price,
        ),
    )
    rows = cur.fetchall()
    ids = []
    for row in rows:
        if isinstance(row, dict):
            ids.append(row.get("id"))
        else:
            ids.append(row[0])
    return [row_id for row_id in ids if row_id is not None]


def find_unique_sales_line_ids(cur, *, source_file, document_no, item_code, customer_code, delivery_code, net_value, qty):
    execute_step(
        cur,
        "lookup imported_sales_lines unique-key matches",
        """
        SELECT id
        FROM imported_sales_lines
        WHERE source_file = %s
          AND document_no = %s
          AND item_code = %s
          AND customer_code = %s
          AND delivery_code = %s
          AND net_value = %s
          AND qty = %s
        ORDER BY id ASC
        """,
        (
            source_file,
            document_no,
            item_code,
            customer_code,
            delivery_code,
            net_value,
            qty,
        ),
    )
    rows = cur.fetchall()
    ids = []
    for row in rows:
        if isinstance(row, dict):
            ids.append(row.get("id"))
        else:
            ids.append(row[0])
    return [row_id for row_id in ids if row_id is not None]


def replace_sales_line_by_id(
    cur,
    *,
    row_id,
    source_file,
    item_description,
    unit_code,
    net_value,
    discount_pct_1,
    discount_pct_2,
    discount_pct_total,
    customer_name,
    delivery_description,
    account_code,
    account_description,
    branch_description,
    ordered_at,
    sent_at,
    note_1,
):
    execute_step(
        cur,
        "replace imported_sales_lines row by business key",
        """
        UPDATE imported_sales_lines
        SET source_file = %s,
            item_description = %s,
            unit_code = %s,
            net_value = %s,
            discount_pct_1 = %s,
            discount_pct_2 = %s,
            discount_pct_total = %s,
            customer_name = %s,
            delivery_description = %s,
            account_code = %s,
            account_description = %s,
            branch_description = %s,
            ordered_at = %s,
            sent_at = %s,
            note_1 = %s
        WHERE id = %s
        """,
        (
            source_file,
            item_description,
            unit_code,
            net_value,
            discount_pct_1,
            discount_pct_2,
            discount_pct_total,
            customer_name,
            delivery_description,
            account_code,
            account_description,
            branch_description,
            ordered_at,
            sent_at,
            note_1,
            row_id,
        ),
    )


def delete_sales_lines_by_ids(cur, row_ids):
    if not row_ids:
        return 0
    placeholders = ", ".join(["%s"] * len(row_ids))
    execute_step(
        cur,
        "delete colliding imported_sales_lines rows",
        f"DELETE FROM imported_sales_lines WHERE id IN ({placeholders})",
        tuple(row_ids),
    )
    return cur.rowcount or 0


def sync_mirrored_imported_customers(cur) -> None:
    execute_step(
        cur,
        "delete stale mirrored customers",
        """
        DELETE FROM customers
        WHERE source = 'entersoft_import'
          AND code NOT IN (
            SELECT customer_code FROM imported_customers
            UNION
            SELECT customer_code FROM imported_customer_ledgers
          )
        """,
    )
    execute_step(
        cur,
        "mirror imported sales customers",
        """
        INSERT INTO customers(code, name, email, source)
        SELECT customer_code, customer_name, NULL, 'entersoft_import'
        FROM imported_customers
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          email = COALESCE(customers.email, VALUES(email)),
          source = VALUES(source)
        """,
    )
    execute_step(
        cur,
        "mirror imported ledger customers",
        """
        INSERT INTO customers(code, name, email, source)
        SELECT customer_code, customer_name, email, 'entersoft_import'
        FROM imported_customer_ledgers
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          email = CASE
            WHEN VALUES(email) IS NOT NULL AND VALUES(email) <> '' THEN VALUES(email)
            ELSE customers.email
          END,
          source = VALUES(source)
        """,
    )


def finish_import(cur, run_id: int, stats: ImportStats, status: str = "success", error_text: Optional[str] = None) -> None:
    finished_at = utc_now_iso()
    cur.execute(
        """
        UPDATE import_runs
        SET status = %s,
            finished_at = %s,
            import_mode = %s,
            source_files_json = %s,
            source_checksum = %s,
            source_row_count = %s,
            rows_in = %s,
            rows_upserted = %s,
            rows_skipped_duplicate = %s,
            rows_rejected = %s,
            rebuild_started_at = %s,
            rebuild_finished_at = %s,
            schema_version = %s,
            trigger_source = %s,
            metadata_json = %s,
            error_text = %s
        WHERE id = %s
        """,
        (
            status,
            finished_at,
            stats.import_mode,
            stats.source_files_json,
            stats.source_checksum,
            stats.source_row_count,
            stats.rows_in,
            stats.rows_upserted,
            stats.rows_skipped_duplicate,
            stats.rows_rejected,
            stats.rebuild_started_at,
            stats.rebuild_finished_at,
            IMPORT_SCHEMA_VERSION,
            stats.trigger_source,
            stats.metadata_json,
            error_text,
            run_id,
        ),
    )


def rebuild_customers_from_sales(cur) -> None:
    execute_step(cur, "truncate imported_customer_branches", "DELETE FROM imported_customer_branches")
    execute_step(
        cur,
        "rebuild imported_customer_branches from sales",
        f"""
        INSERT INTO imported_customer_branches(
          customer_code,
          customer_name,
          branch_code,
          branch_description,
          orders,
          revenue,
          last_order_date,
          source_file
        )
        SELECT
          customer_code,
          COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS customer_name,
          COALESCE(branch_code, '') AS branch_code,
          COALESCE(branch_description, '') AS branch_description,
          COUNT(DISTINCT CASE
            WHEN {build_count_in_order_totals_case()} = 1 THEN CONCAT(customer_code, '::', order_date, '::', document_no)
            ELSE NULL
          END) AS orders,
          COALESCE(SUM({build_effective_revenue_expression()}), 0) AS revenue,
          MAX(CASE
            WHEN {build_customer_activity_filter()} THEN order_date
            ELSE NULL
          END) AS last_order_date,
          MAX(source_file) AS source_file
        FROM imported_sales_lines
        WHERE {build_customer_activity_filter()}
        GROUP BY customer_code, COALESCE(branch_code, ''), COALESCE(branch_description, '')
        """,
    )
    execute_step(cur, "truncate imported_customers", "DELETE FROM imported_customers")
    execute_step(
        cur,
        "rebuild imported_customers from sales",
        f"""
        INSERT INTO imported_customers(
          customer_code,
          customer_name,
          delivery_code,
          delivery_description,
          branch_code,
          branch_description,
          source_file
        )
        SELECT
          customer_code,
          COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS customer_name,
          MAX(delivery_code) AS delivery_code,
          MAX(delivery_description) AS delivery_description,
          MAX(branch_code) AS branch_code,
          MAX(branch_description) AS branch_description,
          MAX(source_file) AS source_file
        FROM imported_sales_lines
        WHERE {build_customer_activity_filter()}
        GROUP BY customer_code
        """,
    )
    sync_mirrored_imported_customers(cur)


def rebuild_sales_aggregates(cur) -> None:
    execute_step(cur, "truncate imported_orders", "DELETE FROM imported_orders")
    execute_step(cur, "truncate imported_open_orders", "DELETE FROM imported_open_orders")
    execute_step(cur, "truncate imported_monthly_sales", "DELETE FROM imported_monthly_sales")
    execute_step(cur, "truncate imported_product_sales", "DELETE FROM imported_product_sales")

    execute_step(
        cur,
        "build imported_orders",
        f"""
        INSERT INTO imported_orders(
          order_id, document_no, customer_code, customer_name, created_at, total_lines, total_pieces,
          total_net_value, average_discount_pct, ordered_at, sent_at, document_type, delivery_code,
          delivery_description, source_file
        )
        SELECT
          CONCAT(customer_code, '::', order_date, '::', document_no) AS order_id,
          document_no,
          customer_code,
          MAX(customer_name),
          order_date,
          COUNT(*) AS total_lines,
          COALESCE(SUM({build_effective_pieces_expression()}), 0) AS total_pieces,
          COALESCE(SUM({build_effective_revenue_expression()}), 0) AS total_net_value,
          COALESCE(AVG({IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct,
          MAX(ordered_at),
          MAX(sent_at),
          MAX(document_type),
          MAX(delivery_code),
          MAX(delivery_description),
          MAX(source_file)
        FROM imported_sales_lines
        WHERE {build_count_in_order_totals_case()} = 1
        GROUP BY document_no, customer_code, order_date
        """
    )

    execute_step(
        cur,
        "build imported_open_orders",
        f"""
        INSERT INTO imported_open_orders(
          order_id, document_no, customer_code, customer_name, created_at, total_lines, total_pieces,
          total_net_value, average_discount_pct, ordered_at, sent_at, document_type, delivery_code,
          delivery_description, source_file
        )
        SELECT
          pending.order_id,
          pending.document_no,
          pending.customer_code,
          pending.customer_name,
          pending.created_at,
          pending.total_lines,
          pending.total_pieces,
          pending.total_net_value,
          pending.average_discount_pct,
          pending.ordered_at,
          pending.sent_at,
          pending.document_type,
          pending.delivery_code,
          pending.delivery_description,
          pending.source_file
        FROM (
          SELECT
            CONCAT(customer_code, '::', order_date, '::', document_no) AS order_id,
            document_no,
            customer_code,
            MAX(customer_name) AS customer_name,
            order_date AS created_at,
            COUNT(*) AS total_lines,
            COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
            COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value,
            COALESCE(AVG({IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct,
            MAX(ordered_at) AS ordered_at,
            MAX(sent_at) AS sent_at,
            MAX(document_type) AS document_type,
            MAX({OPEN_ORDER_REF_EXPRESSION}) AS order_ref,
            MAX(delivery_code) AS delivery_code,
            MAX(delivery_description) AS delivery_description,
            MAX(source_file) AS source_file
          FROM imported_sales_lines
          WHERE COALESCE(document_type, '') IN ({OPEN_EXECUTION_DOCUMENT_TYPES_SQL})
          GROUP BY document_no, customer_code, order_date
        ) pending
                LEFT JOIN (
                    SELECT
                        customer_code,
                        order_ref,
                        MAX(total_lines) AS total_lines,
                        MAX(total_pieces) AS total_pieces,
                        MAX(total_net_value) AS total_net_value
                    FROM (
                        SELECT
                            customer_code,
                            {OPEN_ORDER_REF_EXPRESSION} AS order_ref,
                            document_no,
                            order_date,
                            COUNT(*) AS total_lines,
                            COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
                            COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value
                        FROM imported_sales_lines
                        WHERE {build_count_in_order_totals_case()} = 1
                            AND COALESCE(document_type, '') IN ({EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
                            AND {OPEN_ORDER_REF_EXPRESSION} IS NOT NULL
                        GROUP BY customer_code, {OPEN_ORDER_REF_EXPRESSION}, document_no, order_date
                    ) executed_docs
                    GROUP BY customer_code, order_ref
                ) executed_by_ref
                    ON executed_by_ref.customer_code = pending.customer_code
                 AND pending.order_ref IS NOT NULL
                 AND pending.order_ref <> ''
                 AND executed_by_ref.order_ref = pending.order_ref
                 AND executed_by_ref.total_lines >= pending.total_lines
                 AND executed_by_ref.total_pieces >= pending.total_pieces
                 AND ROUND(executed_by_ref.total_net_value, 2) >= ROUND(pending.total_net_value, 2)
                LEFT JOIN (
                    SELECT
                        customer_code,
                        order_date AS created_at,
                        COUNT(*) AS total_lines,
                        COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
                        COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value,
                        COALESCE(MAX({OPEN_ORDER_REF_EXPRESSION}), '') AS order_ref
                    FROM imported_sales_lines
                    WHERE {build_count_in_order_totals_case()} = 1
                        AND COALESCE(document_type, '') IN ({EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
                        AND ({OPEN_ORDER_REF_EXPRESSION} IS NULL OR {OPEN_ORDER_REF_EXPRESSION} = '')
                    GROUP BY document_no, customer_code, order_date
                ) executed_no_ref
                    ON executed_no_ref.customer_code = pending.customer_code
                 AND (pending.order_ref IS NULL OR pending.order_ref = '')
                 AND (executed_no_ref.order_ref IS NULL OR executed_no_ref.order_ref = '')
                 AND COALESCE(executed_no_ref.created_at, '') = COALESCE(pending.created_at, '')
                 AND executed_no_ref.total_lines = pending.total_lines
                 AND executed_no_ref.total_pieces = pending.total_pieces
                 AND ROUND(executed_no_ref.total_net_value, 2) = ROUND(pending.total_net_value, 2)
                WHERE executed_by_ref.customer_code IS NULL
                    AND executed_no_ref.customer_code IS NULL
        """
    )

    execute_step(
        cur,
        "build imported_monthly_sales",
        f"""
        INSERT INTO imported_monthly_sales(customer_code, order_year, order_month, revenue, pieces)
        SELECT
          customer_code,
          order_year,
          order_month,
          COALESCE(SUM({build_effective_revenue_expression()}), 0) AS revenue,
          COALESCE(SUM({build_effective_pieces_expression()}), 0) AS pieces
        FROM imported_sales_lines
        WHERE {build_analytics_line_filter()}
        GROUP BY customer_code, order_year, order_month
        """
    )

    execute_step(
        cur,
        "build imported_product_sales",
        f"""
        INSERT INTO imported_product_sales(
          customer_code, item_code, item_description, revenue, pieces, orders, avg_unit_price
        )
        SELECT
          customer_code,
          item_code,
          MAX(item_description),
          COALESCE(SUM({build_effective_revenue_expression()}), 0) AS revenue,
          COALESCE(SUM({build_effective_pieces_expression()}), 0) AS pieces,
          COUNT(DISTINCT CASE
            WHEN {build_count_in_order_totals_case()} = 1 THEN CONCAT(customer_code, '::', order_date, '::', document_no)
            ELSE NULL
          END) AS orders,
          CASE
            WHEN COALESCE(SUM({build_effective_pieces_expression()}), 0) > 0
              THEN COALESCE(SUM({build_effective_revenue_expression()}), 0) / SUM({build_effective_pieces_expression()})
            ELSE 0
          END AS avg_unit_price
        FROM imported_sales_lines
        WHERE {build_analytics_line_filter()}
        GROUP BY customer_code, item_code
        """
    )


def import_sales_lines(cur, sales_files, import_mode: str, replace_sales_year: Optional[int] = None) -> ImportStats:
    source_files_json, source_checksum = describe_source_files(sales_files)
    stats = ImportStats(
        dataset="sales_lines",
        file_name=",".join(path.name for path in sales_files),
        import_mode=import_mode,
        source_files_json=source_files_json,
        source_checksum=source_checksum,
        trigger_source=resolve_trigger_source(),
        metadata_json=build_import_metadata_json(import_mode, replace_sales_year),
    )
    print(f"[import] sales_lines: starting ({stats.file_name})", flush=True)
    run_id = begin_import(cur, stats)
    try:
        if import_mode == "full_refresh":
            execute_step(cur, "truncate imported_sales_lines", "DELETE FROM imported_sales_lines")
        elif import_mode == "replace_sales_year":
            execute_step(
                cur,
                f"delete imported_sales_lines for year {replace_sales_year}",
                "DELETE FROM imported_sales_lines WHERE order_year = %s",
                (replace_sales_year,),
            )

        for sales_file in sales_files:
            print(f"[import] sales_lines: reading {sales_file.name}", flush=True)
            with sales_file.open("r", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f, delimiter="\t")
                for row in reader:
                    stats.source_row_count += 1
                    stats.rows_in += 1
                    customer_code = str(get_row_value(row, "Κωδικός", "ΞΟ‰Ξ΄ΞΉΞΊΟΟ‚")).strip()
                    document_no = str(get_row_value(row, "Παραστατικό", "Ξ Ξ±ΟΞ±ΟƒΟ„Ξ±Ο„ΞΉΞΊΟ")).strip()
                    item_code = str(get_row_value(row, "Είδος", "Ξ•Ξ―Ξ΄ΞΏΟ‚")).strip()
                    order_date = parse_date(get_row_value(row, "Ημ/νία ", "Ξ—ΞΌ/Ξ½Ξ―Ξ± "))
                    if not (customer_code and document_no and item_code and order_date):
                        stats.rows_rejected += 1
                        continue

                    order_dt = datetime.strptime(order_date, "%Y-%m-%d")
                    document_type = str(
                        get_row_value(row, "Τύπος Παραστατικών", "Ξ¤ΟΟ€ΞΏΟ‚ Ξ Ξ±ΟΞ±ΟƒΟ„Ξ±Ο„ΞΉΞΊΟΞ½")
                    ).strip()
                    item_description = str(get_row_value(row, "Περιγραφή", "Ξ ΞµΟΞΉΞ³ΟΞ±Ο†Ξ®")).strip()
                    unit_code = str(get_row_value(row, "ΜΜ", "ΞΞ")).strip()
                    qty = parse_decimal(get_row_value(row, "Ποσότητα", "Ξ ΞΏΟƒΟΟ„Ξ·Ο„Ξ±"))
                    qty_base = parse_decimal(
                        get_row_value(row, "Ποσότητα σε βασική ΜΜ", "Ξ ΞΏΟƒΟΟ„Ξ·Ο„Ξ± ΟƒΞµ Ξ²Ξ±ΟƒΞΉΞΊΞ® ΞΞ")
                    )
                    unit_price = parse_decimal(get_row_value(row, "Τιμή", "Ξ¤ΞΉΞΌΞ®"))
                    net_value = parse_decimal(get_row_value(row, "Καθαρή  αξία ", "ΞΞ±ΞΈΞ±ΟΞ®  Ξ±ΞΎΞ―Ξ± "))
                    customer_name = str(
                        get_row_value(row, "Επωνυμία/Ονοματεπώνυμο", "Ξ•Ο€Ο‰Ξ½Ο…ΞΌΞ―Ξ±/ΞΞ½ΞΏΞΌΞ±Ο„ΞµΟ€ΟΞ½Ο…ΞΌΞΏ")
                    ).strip()
                    delivery_code = str(get_row_value(row, "Κωδικός1", "ΞΟ‰Ξ΄ΞΉΞΊΟΟ‚1")).strip()
                    delivery_description = str(get_row_value(row, "Περιγραφή1", "Ξ ΞµΟΞΉΞ³ΟΞ±Ο†Ξ®1")).strip()
                    account_code = str(get_row_value(row, "Κωδ. ΑΧ ", "ΞΟ‰Ξ΄. Ξ‘Ξ§ ")).strip()
                    account_description = str(get_row_value(row, "Περ. ΑΧ", "Ξ ΞµΟ. Ξ‘Ξ§")).strip()
                    branch_code = str(get_row_value(row, "Κωδ.υποκ.", "ΞΟ‰Ξ΄.Ο…Ο€ΞΏΞΊ.")).strip()
                    branch_postal_code = str(
                        get_row_value(row, "Ταχ.Κώδικας", "Ξ¤Ξ±Ο‡.ΞΟΞ΄ΞΉΞΊΞ±Ο‚")
                    ).strip()
                    branch_description = build_branch_description(
                        get_row_value(row, "Περ.υποκ.", "Ξ ΞµΟ.Ο…Ο€ΞΏΞΊ."),
                        branch_postal_code,
                    )
                    ordered_at = parse_optional_datetime_date(
                        get_row_value(
                            row,
                            "Ημ/νία Καταχώρησης Παραγγελίας",
                            "Ξ—ΞΌ/Ξ½Ξ―Ξ± ΞΞ±Ο„Ξ±Ο‡ΟΟΞ·ΟƒΞ·Ο‚ Ξ Ξ±ΟΞ±Ξ³Ξ³ΞµΞ»Ξ―Ξ±Ο‚",
                            "Ημ/νία Λήψης Παραγγελίας",
                            "Ξ—ΞΌ/Ξ½Ξ―Ξ± Ξ›Ξ®ΟΞ·Ο‚ Ξ Ξ±ΟΞ±Ξ³Ξ³ΞµΞ»Ξ―Ξ±Ο‚",
                        )
                    )
                    sent_at = parse_optional_datetime_date(
                        get_row_value(
                            row,
                            "Ημ/νία Παράδοσης από Έδρα μας",
                            "Ξ—ΞΌ/Ξ½Ξ―Ξ± Ξ Ξ±ΟΞ¬Ξ΄ΞΏΟƒΞ·Ο‚ Ξ±Ο€Ο ΈΞ΄ΟΞ± ΞΌΞ±Ο‚",
                        )
                    )
                    note_1 = str(get_row_value(row, "Σχόλιο 1", "Ξ£Ο‡ΟΞ»ΞΉΞΏ 1")).strip()

                    discount_pct_1 = parse_decimal(get_row_value(row, "% Ξ­ΞΊΟ€Ο„.1"))
                    discount_pct_2 = parse_decimal(get_row_value(row, "% Ξ­ΞΊΟ€Ο„.2"))
                    discount_pct_total = discount_pct_1 + discount_pct_2

                    matching_ids = find_matching_sales_line_ids(
                        cur,
                        order_date=order_date,
                        document_no=document_no,
                        document_type=document_type,
                        item_code=item_code,
                        item_description=item_description,
                        unit_code=unit_code,
                        net_value=net_value,
                        customer_code=customer_code,
                        customer_name=customer_name,
                        delivery_code=delivery_code,
                        delivery_description=delivery_description,
                        account_code=account_code,
                        account_description=account_description,
                        branch_code=branch_code,
                        branch_description=branch_description,
                        qty=qty,
                        qty_base=qty_base,
                        unit_price=unit_price,
                    )

                    if len(matching_ids) > 1:
                        deleted_rows = delete_sales_lines_by_ids(cur, matching_ids)
                        stats.rows_replaced += deleted_rows
                        print(
                            "[import] sales_lines: resolved business-key collision in favor of incoming row "
                            f"(order_date={order_date}, document_no={document_no}, document_type={document_type}, "
                            f"item_code={item_code}, customer_code={customer_code}, deleted_old_rows={deleted_rows})",
                            flush=True,
                        )
                        matching_ids = []

                    if len(matching_ids) == 1:
                        replace_sales_line_by_id(
                            cur,
                            row_id=matching_ids[0],
                            source_file=sales_file.name,
                            item_description=item_description,
                            unit_code=unit_code,
                            net_value=net_value,
                            discount_pct_1=discount_pct_1,
                            discount_pct_2=discount_pct_2,
                            discount_pct_total=discount_pct_total,
                            customer_name=customer_name,
                            delivery_description=delivery_description,
                            account_code=account_code,
                            account_description=account_description,
                            branch_description=branch_description,
                            ordered_at=ordered_at,
                            sent_at=sent_at,
                            note_1=note_1,
                        )
                        if cur.rowcount:
                            stats.rows_upserted += 1
                            stats.rows_replaced += 1
                        else:
                            stats.rows_skipped_duplicate += 1
                    else:
                        unique_key_ids = find_unique_sales_line_ids(
                            cur,
                            source_file=sales_file.name,
                            document_no=document_no,
                            item_code=item_code,
                            customer_code=customer_code,
                            delivery_code=delivery_code,
                            net_value=net_value,
                            qty=qty,
                        )
                        if unique_key_ids:
                            deleted_rows = delete_sales_lines_by_ids(cur, unique_key_ids)
                            stats.rows_replaced += deleted_rows
                            print(
                                "[import] sales_lines: resolved unique-key collision in favor of incoming row "
                                f"(source_file={sales_file.name}, document_no={document_no}, "
                                f"item_code={item_code}, customer_code={customer_code}, deleted_old_rows={deleted_rows})",
                                flush=True,
                            )
                        execute_step(
                            cur,
                            "insert imported_sales_lines row",
                            """
                            INSERT INTO imported_sales_lines(
                              source_file, order_date, order_year, order_month, document_no, document_type,
                              item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
                              discount_pct_1, discount_pct_2, discount_pct_total,
                              customer_code, customer_name, delivery_code, delivery_description, account_code,
                              account_description, branch_code, branch_description, ordered_at, sent_at, note_1
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                                discount_pct_1,
                                discount_pct_2,
                                discount_pct_total,
                                customer_code,
                                customer_name,
                                delivery_code,
                                delivery_description,
                                account_code,
                                account_description,
                                branch_code,
                                branch_description,
                                ordered_at,
                                sent_at,
                                note_1,
                            ),
                        )
                        stats.rows_upserted += cur.rowcount
                    if stats.rows_in % PROGRESS_EVERY_ROWS == 0:
                        print(
                            f"[import] sales_lines: rows_in={stats.rows_in}, "
                            f"rows_upserted={stats.rows_upserted}, "
                            f"rows_replaced={stats.rows_replaced}, "
                            f"rows_skipped_duplicate={stats.rows_skipped_duplicate}, "
                            f"rows_skipped_ambiguous={stats.rows_skipped_ambiguous}, "
                            f"rows_rejected={stats.rows_rejected}",
                            flush=True,
                        )

            print(
                f"[import] sales_lines: finished {sales_file.name} "
                f"(rows_in={stats.rows_in}, rows_upserted={stats.rows_upserted}, "
                f"rows_replaced={stats.rows_replaced}, rows_skipped_duplicate={stats.rows_skipped_duplicate}, "
                f"rows_skipped_ambiguous={stats.rows_skipped_ambiguous}, rows_rejected={stats.rows_rejected})",
                flush=True,
            )

        stats.rebuild_started_at = utc_now_iso()
        rebuild_customers_from_sales(cur)
        print("[import] customers: rebuilt from sales files", flush=True)
        rebuild_sales_aggregates(cur)
        stats.rebuild_finished_at = utc_now_iso()

        finish_import(cur, run_id, stats)
        print(
            f"[import] sales_lines: completed rows_in={stats.rows_in}, rows_upserted={stats.rows_upserted}, "
            f"rows_replaced={stats.rows_replaced}, rows_skipped_duplicate={stats.rows_skipped_duplicate}, "
            f"rows_skipped_ambiguous={stats.rows_skipped_ambiguous}, rows_rejected={stats.rows_rejected}",
            flush=True,
        )
        return stats
    except Exception as exc:
        finish_import(cur, run_id, stats, status="failed", error_text=str(exc))
        print(f"[import] sales_lines: failed ({exc})", flush=True)
        raise


def import_customer_ledgers(cur, ledger_file: Path) -> ImportStats:
    source_files_json, source_checksum = describe_source_files([ledger_file])
    stats = ImportStats(
        dataset="customer_ledgers",
        file_name=ledger_file.name,
        import_mode="snapshot_replace",
        source_files_json=source_files_json,
        source_checksum=source_checksum,
        trigger_source=resolve_trigger_source(),
        metadata_json=build_ledger_snapshot_metadata_json(),
    )
    print(f"[import] customer_ledgers: starting ({ledger_file.name})", flush=True)
    run_id = begin_import(cur, stats)
    try:
        snapshots = {}
        ledger_rows = []
        execute_step(cur, "truncate imported_customer_ledgers", "DELETE FROM imported_customer_ledgers")
        execute_step(cur, "truncate imported_customer_ledger_lines", "DELETE FROM imported_customer_ledger_lines")
        with ledger_file.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                stats.source_row_count += 1
                stats.rows_in += 1
                customer_code = str(
                    get_row_value(
                        row,
                        "Συναλλασσόμενος",
                        "Ξ£Ο…Ξ½Ξ±Ξ»Ξ»Ξ±ΟƒΟƒΟΞΌΞµΞ½ΞΏΟ‚",
                        "Κωδικός",
                        "ΞΟ‰Ξ΄ΞΉΞΊΟΟ‚",
                    )
                ).strip()
                customer_name = str(
                    get_row_value(
                        row,
                        "Συν/νος",
                        "Ξ£Ο…Ξ½/Ξ½ΞΏΟ‚",
                        "Επωνυμία",
                        "Ξ•Ο€Ο‰Ξ½Ο…ΞΌΞ―Ξ±",
                    )
                ).strip()
                if not customer_code or not customer_name:
                    stats.rows_rejected += 1
                    continue

                opening_balance = parse_decimal(
                    get_row_value(row, "Εκ μεταφοράς", "Ξ•ΞΊ ΞΌΞµΟ„Ξ±Ο†ΞΏΟΞ¬Ο‚")
                )
                document_date = parse_date(
                    get_row_value(row, "Ημ/νία", "Ξ—ΞΌ/Ξ½Ξ―Ξ±")
                ) if str(get_row_value(row, "Ημ/νία", "Ξ—ΞΌ/Ξ½Ξ―Ξ±")).strip() else None
                document_no = str(
                    get_row_value(
                        row,
                        "Παραστατικό",
                        "Παραστατικό - Δικαιολογητικό",
                        "Ξ Ξ±ΟΞ±ΟƒΟ„Ξ±Ο„ΞΉΞΊΟ",
                    )
                ).strip()
                reason = str(
                    get_row_value(
                        row,
                        "Αιτιολογία",
                        "Αιτιολογία - Δικαιολογητικό",
                        "Ξ‘ΞΉΟ„ΞΉΞΏΞ»ΞΏΞ³Ξ―Ξ±",
                    )
                ).strip()
                debit = parse_decimal(
                    get_row_value(
                        row,
                        "Χρέωση",
                        "Χρέωση - Αξίες",
                        "Ξ§ΟΞ­Ο‰ΟƒΞ·",
                    )
                )
                credit = parse_decimal(
                    get_row_value(
                        row,
                        "Πίστωση",
                        "Πίστωση - Αξίες",
                        "Ξ Ξ―ΟƒΟ„Ο‰ΟƒΞ·",
                    )
                )
                progressive_debit = parse_decimal(
                    get_row_value(
                        row,
                        "Προοδ. Χρέωση",
                        "Προοδ. Χρέωση - Σύνολα",
                        "Ξ ΟΞΏΞΏΞ΄. Ξ§ΟΞ­Ο‰ΟƒΞ·",
                    )
                )
                progressive_credit = parse_decimal(
                    get_row_value(
                        row,
                        "Προοδ. Πίστωση",
                        "Προοδ. Πίστωση - Σύνολα",
                        "Ξ ΟΞΏΞΏΞ΄. Ξ Ξ―ΟƒΟ„Ο‰ΟƒΞ·",
                    )
                )
                ledger_balance = parse_decimal(
                    get_row_value(
                        row,
                        "Υπόλοιπο",
                        "Υπόλοιπο - Σύνολα",
                        "Ξ¥Ο€ΟΞ»ΞΏΞΉΟ€ΞΏ",
                        "Λογιστικό υπόλοιπο",
                        "Ξ›ΞΏΞ³ΞΉΟƒΟ„ΞΉΞΊΟ Ο…Ο€ΟΞ»ΞΏΞΉΟ€ΞΏ",
                    )
                )
                commercial_balance = parse_decimal(
                    get_row_value(row, "Εμπορικό Υπόλοιπο", "Ξ•ΞΌΟ€ΞΏΟΞΉΞΊΟ Ο…Ο€ΟΞ»ΞΏΞΉΟ€ΞΏ")
                )
                pending_instruments = parse_decimal(
                    get_row_value(row, "Εκκρεμή αξιόγραφα", "Ξ•ΞΊΞΊΟΞµΞΌΞ® Ξ±ΞΎΞΉΟΞ³ΟΞ±Ο†Ξ±")
                )
                email = str(
                    get_row_value(row, "Ηλεκτρονική διεύθυνση", "Ξ—Ξ»ΞµΞΊΟ„ΟΞΏΞ½ΞΉΞΊΞ® Ξ΄ΞΉΞµΟΞΈΟ…Ξ½ΟƒΞ·")
                ).strip() or None
                is_inactive = (
                    1 if str(get_row_value(row, "Ανενεργός", "Ξ‘Ξ½ΞµΞ½ΞµΟΞ³ΟΟ‚")).strip() in {"1", "true", "True"} else 0
                )
                salesperson_code = str(get_row_value(row, "Πωλητής", "Ξ Ο‰Ξ»Ξ·Ο„Ξ®Ο‚")).strip() or None

                has_ledger_content = any(
                    [
                        document_date,
                        document_no,
                        reason,
                        debit,
                        credit,
                        progressive_debit,
                        progressive_credit,
                        ledger_balance,
                    ]
                )
                if not has_ledger_content:
                    stats.rows_rejected += 1
                    continue

                if not commercial_balance:
                    commercial_balance = ledger_balance

                snapshot = snapshots.get(customer_code)
                if not snapshot:
                    snapshot = {
                        "customer_code": customer_code,
                        "customer_name": customer_name,
                        "opening_balance": opening_balance or ledger_balance,
                        "debit": progressive_debit,
                        "credit": progressive_credit,
                        "ledger_balance": ledger_balance,
                        "pending_instruments": pending_instruments,
                        "commercial_balance": commercial_balance,
                        "email": email,
                        "is_inactive": is_inactive,
                        "salesperson_code": salesperson_code,
                    }
                    snapshots[customer_code] = snapshot

                snapshot["customer_name"] = customer_name or snapshot["customer_name"]
                snapshot["debit"] = progressive_debit
                snapshot["credit"] = progressive_credit
                snapshot["ledger_balance"] = ledger_balance
                snapshot["pending_instruments"] = pending_instruments
                snapshot["commercial_balance"] = commercial_balance
                if not snapshot.get("email"):
                    snapshot["email"] = email
                if not snapshot.get("salesperson_code"):
                    snapshot["salesperson_code"] = salesperson_code

                ledger_rows.append(
                    (
                        customer_code,
                        customer_name,
                        document_date,
                        document_no,
                        reason,
                        debit,
                        credit,
                        progressive_debit,
                        progressive_credit,
                        ledger_balance,
                        ledger_file.name,
                    )
                )

        for ledger_row in ledger_rows:
            execute_step(
                cur,
                "insert imported_customer_ledger_lines row",
                """
                INSERT INTO imported_customer_ledger_lines(
                  customer_code,
                  customer_name,
                  document_date,
                  document_no,
                  reason,
                  debit,
                  credit,
                  running_debit,
                  running_credit,
                  ledger_balance,
                  source_file
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                ledger_row,
            )

        for snapshot in snapshots.values():
            execute_step(
                cur,
                "insert imported_customer_ledgers row",
                """
                INSERT INTO imported_customer_ledgers(
                  customer_code,
                  customer_name,
                  opening_balance,
                  debit,
                  credit,
                  ledger_balance,
                  pending_instruments,
                  commercial_balance,
                  email,
                  is_inactive,
                  salesperson_code,
                  source_file
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    snapshot["customer_code"],
                    snapshot["customer_name"],
                    snapshot["opening_balance"],
                    snapshot["debit"],
                    snapshot["credit"],
                    snapshot["ledger_balance"],
                    snapshot["pending_instruments"],
                    snapshot["commercial_balance"],
                    snapshot["email"],
                    snapshot["is_inactive"],
                    snapshot["salesperson_code"],
                    ledger_file.name,
                ),
            )
            stats.rows_upserted += cur.rowcount

        sync_mirrored_imported_customers(cur)

        finish_import(cur, run_id, stats)
        print(
            f"[import] customer_ledgers: completed rows_in={stats.rows_in}, "
            f"rows_upserted={stats.rows_upserted}, rows_rejected={stats.rows_rejected}",
            flush=True,
        )
        return stats
    except Exception as exc:
        finish_import(cur, run_id, stats, status="failed", error_text=str(exc))
        print(f"[import] customer_ledgers: failed ({exc})", flush=True)
        raise

def main() -> None:
    init_schema()
    conn = get_conn()
    cur = conn.cursor()
    configure_session(cur)
    print(f"[import] session lock wait timeout set to {LOCK_WAIT_TIMEOUT_SECONDS}s", flush=True)
    import_mode = resolve_import_mode()
    replace_sales_year = resolve_replace_sales_year(import_mode)
    print(f"[import] mode: {import_mode}", flush=True)
    if replace_sales_year is not None:
        print(f"[import] replace sales year: {replace_sales_year}", flush=True)
    ledger_file = resolve_ledger_file()
    if ledger_file and not ledger_file.exists():
        raise FileNotFoundError(f"Ledger snapshot file not found: {ledger_file}")

    explicit_sales_config = has_explicit_sales_config()
    sales_files = resolve_sales_files() if (explicit_sales_config or not ledger_file) else []

    for sales_file in sales_files:
        if not sales_file.exists():
            raise FileNotFoundError(f"Sales file not found: {sales_file}")

    if sales_files:
        print(f"[import] using sales files: {', '.join(str(p) for p in sales_files)}", flush=True)
    if ledger_file:
        print(f"[import] using ledger snapshot: {ledger_file}", flush=True)
    if not sales_files and not ledger_file:
        raise RuntimeError(
            "No import input configured. Set ENTERSOFT_SALES_FILES, ENTERSOFT_DAILY_INFO_FILE, or ENTERSOFT_LEDGER_FILE."
        )

    try:
        if sales_files:
            sales_stats = import_sales_lines(cur, sales_files, import_mode, replace_sales_year)
        else:
            sales_stats = None
        if ledger_file:
            ledger_stats = import_customer_ledgers(cur, ledger_file)
        else:
            ledger_stats = None
        conn.commit()
        if sales_stats:
            print(
                "Imported sales_lines="
                f"{sales_stats.rows_upserted} "
                f"(duplicates_skipped={sales_stats.rows_skipped_duplicate}, rejected={sales_stats.rows_rejected})"
            )
        if ledger_stats:
            print(
                "Imported customer_ledgers="
                f"{ledger_stats.rows_upserted} "
                f"(rejected={ledger_stats.rows_rejected})"
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

