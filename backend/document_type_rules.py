import json
from pathlib import Path


RULES_PATH = Path(__file__).resolve().parents[1] / "document_type_rules.json"
DOCUMENT_TYPE_RULES = json.loads(RULES_PATH.read_text(encoding="utf-8"))


def _bool_as_int(value) -> int:
    return 1 if value else 0


def _build_case(property_name: str, alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    parts = []
    for rule in DOCUMENT_TYPE_RULES:
        document_type = rule["document_type"].replace("'", "''")
        parts.append(f"WHEN '{document_type}' THEN {int(rule[property_name])}")
    clauses = "\n      ".join(parts)
    return (
        f"CASE COALESCE({prefix}document_type, '')\n"
        f"      {clauses}\n"
        f"      ELSE 0\n"
        f"    END"
    )


def _build_boolean_case(property_name: str, alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    parts = []
    for rule in DOCUMENT_TYPE_RULES:
        document_type = rule["document_type"].replace("'", "''")
        parts.append(f"WHEN '{document_type}' THEN {_bool_as_int(rule[property_name])}")
    clauses = "\n      ".join(parts)
    return (
        f"CASE COALESCE({prefix}document_type, '')\n"
        f"      {clauses}\n"
        f"      ELSE 0\n"
        f"    END"
    )


def build_revenue_multiplier_case(alias: str = "") -> str:
    return _build_case("revenue_multiplier", alias)


def build_pieces_multiplier_case(alias: str = "") -> str:
    return _build_case("pieces_multiplier", alias)


def build_count_in_order_totals_case(alias: str = "") -> str:
    return _build_boolean_case("count_in_order_totals", alias)


def build_include_in_customer_activity_case(alias: str = "") -> str:
    return _build_boolean_case("include_in_customer_activity", alias)


def build_effective_revenue_expression(alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    return f"({prefix}net_value * ({build_revenue_multiplier_case(alias)}))"


def build_effective_pieces_expression(alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    return f"({prefix}qty_base * ({build_pieces_multiplier_case(alias)}))"


def build_analytics_line_filter(alias: str = "") -> str:
    revenue_case = build_revenue_multiplier_case(alias)
    pieces_case = build_pieces_multiplier_case(alias)
    order_case = build_count_in_order_totals_case(alias)
    return f"(({revenue_case}) <> 0 OR ({pieces_case}) <> 0 OR ({order_case}) = 1)"


def build_customer_activity_filter(alias: str = "") -> str:
    return f"({build_include_in_customer_activity_case(alias)}) = 1"
