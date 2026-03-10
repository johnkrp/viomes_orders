import fs from "node:fs";

const RULES_URL = new URL("../../document_type_rules.json", import.meta.url);
const rawRules = JSON.parse(fs.readFileSync(RULES_URL, "utf8"));
const knownDocumentTypes = rawRules.map((rule) => String(rule.document_type));

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

function buildCase(propertyName, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const whenClauses = rawRules
    .map(
      (rule) =>
        `WHEN '${escapeSqlString(rule.document_type)}' THEN ${Number(rule[propertyName] || 0)}`,
    )
    .join("\n    ");

  return `
    CASE COALESCE(${prefix}document_type, '')
      ${whenClauses}
      ELSE 0
    END
  `.trim();
}

function buildBooleanCase(propertyName, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const whenClauses = rawRules
    .map(
      (rule) =>
        `WHEN '${escapeSqlString(rule.document_type)}' THEN ${rule[propertyName] ? 1 : 0}`,
    )
    .join("\n    ");

  return `
    CASE COALESCE(${prefix}document_type, '')
      ${whenClauses}
      ELSE 0
    END
  `.trim();
}

export const DOCUMENT_TYPE_RULES = Object.freeze(rawRules.map((rule) => Object.freeze(rule)));
export const KNOWN_DOCUMENT_TYPES = Object.freeze([...knownDocumentTypes]);

export function buildKnownDocumentTypesSqlList() {
  return knownDocumentTypes.map((value) => `'${escapeSqlString(value)}'`).join(", ");
}

export function buildRevenueMultiplierCase(alias = "") {
  return buildCase("revenue_multiplier", alias);
}

export function buildPiecesMultiplierCase(alias = "") {
  return buildCase("pieces_multiplier", alias);
}

export function buildCountInOrderTotalsCase(alias = "") {
  return buildBooleanCase("count_in_order_totals", alias);
}

export function buildIncludeInCustomerActivityCase(alias = "") {
  return buildBooleanCase("include_in_customer_activity", alias);
}

export function buildEffectiveRevenueExpression(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}net_value * (${buildRevenueMultiplierCase(alias)}))`;
}

export function buildEffectivePiecesExpression(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}qty_base * (${buildPiecesMultiplierCase(alias)}))`;
}

export function buildAnalyticsLineFilter(alias = "") {
  const revenueExpr = buildRevenueMultiplierCase(alias);
  const piecesExpr = buildPiecesMultiplierCase(alias);
  const orderExpr = buildCountInOrderTotalsCase(alias);
  return `((${revenueExpr}) <> 0 OR (${piecesExpr}) <> 0 OR (${orderExpr}) = 1)`;
}

export function buildCustomerActivityFilter(alias = "") {
  return `(${buildIncludeInCustomerActivityCase(alias)}) = 1`;
}
