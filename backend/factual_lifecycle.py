import csv
import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
FACTUAL_RULES_PATH = BASE_DIR / "factual_rules.csv"
DOCUMENT_TYPE_RULES_PATH = BASE_DIR.parent / "document_type_rules.json"


def _unique_sorted(values):
    return sorted({value for value in values if value})


def _load_factual_rules():
    with FACTUAL_RULES_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def _load_analytics_rules():
    return json.loads(DOCUMENT_TYPE_RULES_PATH.read_text(encoding="utf-8"))


FACTUAL_RULES = _load_factual_rules()
ANALYTICS_RULES = _load_analytics_rules()

EXECUTED_ORDER_DOCUMENT_TYPES = _unique_sorted(
    str(rule.get("document_type") or "").strip()
    for rule in ANALYTICS_RULES
    if bool(rule.get("count_in_order_totals"))
    and (
        float(rule.get("revenue_multiplier") or 0) > 0
        or float(rule.get("pieces_multiplier") or 0) > 0
    )
)

OPEN_EXECUTION_DOCUMENT_TYPES = _unique_sorted(
    str(row.get("Από ") or "").strip()
    for row in FACTUAL_RULES
    if str(row.get("Ανενεργό") or "").strip() != "1"
    and str(row.get("Κίνηση κλεισίματος εκκρεμοτήτων αποθήκης") or "").strip() == "STOCK-RESERVE(ORDER)"
    and str(row.get("Από ") or "").strip()
)

PRE_EXECUTION_DOCUMENT_TYPES = _unique_sorted(
    str(row.get("Από ") or "").strip()
    for row in FACTUAL_RULES
    if str(row.get("Ανενεργό") or "").strip() != "1"
    and str(row.get("Κίνηση κλεισίματος εκκρεμοτήτων αποθήκης") or "").strip()
    in {"CUSTOMER-ORDER", "CUSTOMER-ORDER-TO-CONF-OR-RESV", "CUSTOMER-ORDER-LS"}
    and str(row.get("Από ") or "").strip()
)

NON_EXECUTED_DOCUMENT_TYPES = _unique_sorted(
    [*PRE_EXECUTION_DOCUMENT_TYPES, *OPEN_EXECUTION_DOCUMENT_TYPES]
)


def build_document_type_sql_list(document_types) -> str:
    escaped = []
    for document_type in document_types:
        value = str(document_type).replace("'", "''")
        escaped.append(f"'{value}'")
    return ", ".join(escaped)
