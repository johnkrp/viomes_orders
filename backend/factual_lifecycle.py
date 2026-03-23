import json
from pathlib import Path


FACTUAL_LIFECYCLE_RULES_PATH = Path(__file__).resolve().parent.parent / "factual_lifecycle_rules.json"
FACTUAL_LIFECYCLE_RULES = json.loads(FACTUAL_LIFECYCLE_RULES_PATH.read_text(encoding="utf-8"))

EXECUTED_ORDER_DOCUMENT_TYPES = list(FACTUAL_LIFECYCLE_RULES["executedOrderDocumentTypes"])
OPEN_EXECUTION_DOCUMENT_TYPES = list(FACTUAL_LIFECYCLE_RULES["openExecutionDocumentTypes"])
PRE_EXECUTION_DOCUMENT_TYPES = list(FACTUAL_LIFECYCLE_RULES["preExecutionDocumentTypes"])
NON_EXECUTED_DOCUMENT_TYPES = list(FACTUAL_LIFECYCLE_RULES["nonExecutedDocumentTypes"])


def build_document_type_sql_list(document_types) -> str:
    escaped = []
    for document_type in document_types:
        value = str(document_type).replace("'", "''")
        escaped.append(f"'{value}'")
    return ", ".join(escaped)
