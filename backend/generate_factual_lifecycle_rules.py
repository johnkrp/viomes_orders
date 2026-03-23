import csv
import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
FACTUAL_RULES_PATH = BASE_DIR / "factual_rules.csv"
DOCUMENT_TYPE_RULES_PATH = BASE_DIR.parent / "document_type_rules.json"
OUTPUT_PATH = BASE_DIR.parent / "factual_lifecycle_rules.json"


def unique_sorted(values):
    return sorted({value for value in values if value})


def load_factual_rules(path=FACTUAL_RULES_PATH):
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, delimiter="\t"))


def load_analytics_rules(path=DOCUMENT_TYPE_RULES_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def derive_factual_lifecycle_rules(factual_rules=None, analytics_rules=None):
    factual_rows = factual_rules if factual_rules is not None else load_factual_rules()
    analytics_rows = analytics_rules if analytics_rules is not None else load_analytics_rules()

    executed = unique_sorted(
        str(rule.get("document_type") or "").strip()
        for rule in analytics_rows
        if bool(rule.get("count_in_order_totals"))
        and (
            float(rule.get("revenue_multiplier") or 0) > 0
            or float(rule.get("pieces_multiplier") or 0) > 0
        )
    )

    open_execution = unique_sorted(
        str(row.get("Από ") or "").strip()
        for row in factual_rows
        if str(row.get("Ανενεργό") or "").strip() != "1"
        and str(row.get("Κίνηση κλεισίματος εκκρεμοτήτων αποθήκης") or "").strip() == "STOCK-RESERVE(ORDER)"
        and str(row.get("Από ") or "").strip()
    )

    pre_execution_raw = unique_sorted(
        str(row.get("Από ") or "").strip()
        for row in factual_rows
        if str(row.get("Ανενεργό") or "").strip() != "1"
        and str(row.get("Κίνηση κλεισίματος εκκρεμοτήτων αποθήκης") or "").strip()
        in {"CUSTOMER-ORDER", "CUSTOMER-ORDER-TO-CONF-OR-RESV", "CUSTOMER-ORDER-LS"}
        and str(row.get("Από ") or "").strip()
    )

    pre_execution = unique_sorted(
        document_type for document_type in pre_execution_raw if document_type not in open_execution
    )

    return {
        "executedOrderDocumentTypes": executed,
        "openExecutionDocumentTypes": open_execution,
        "preExecutionDocumentTypes": pre_execution,
        "nonExecutedDocumentTypes": unique_sorted([*pre_execution, *open_execution]),
    }


def write_factual_lifecycle_rules(output_path=OUTPUT_PATH):
    payload = derive_factual_lifecycle_rules()
    path = Path(output_path)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def main():
    write_factual_lifecycle_rules()


if __name__ == "__main__":
    main()
