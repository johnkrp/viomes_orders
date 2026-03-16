import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FACTUAL_RULES_PATH = path.resolve(__dirname, "../../backend/factual_rules.csv");
const DOCUMENT_TYPE_RULES_PATH = path.resolve(__dirname, "../../document_type_rules.json");

function parseTsvLine(line) {
  return String(line || "")
    .split("\t")
    .map((value) => value.trim().replace(/^"|"$/g, ""));
}

function loadFactualRules() {
  const raw = fs.readFileSync(FACTUAL_RULES_PATH, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, ""))
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    return [];
  }

  const headers = parseTsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseTsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function loadAnalyticsRules() {
  return JSON.parse(fs.readFileSync(DOCUMENT_TYPE_RULES_PATH, "utf8"));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "el"));
}

const FACTUAL_RULES = loadFactualRules();
const ANALYTICS_RULES = loadAnalyticsRules();

const EXECUTED_ORDER_DOCUMENT_TYPES = uniqueSorted(
  ANALYTICS_RULES.filter(
    (rule) =>
      Boolean(rule?.count_in_order_totals) &&
      (Number(rule?.revenue_multiplier || 0) > 0 || Number(rule?.pieces_multiplier || 0) > 0),
  ).map((rule) => String(rule.document_type || "").trim()),
);

const OPEN_EXECUTION_DOCUMENT_TYPES = uniqueSorted(
  FACTUAL_RULES.filter(
    (row) =>
      String(row["Ανενεργό"] || "").trim() !== "1" &&
      String(row["Κίνηση κλεισίματος εκκρεμοτήτων αποθήκης"] || "").trim() === "STOCK-RESERVE(ORDER)" &&
      String(row["Από "] || "").trim(),
  ).map((row) => String(row["Από "] || "").trim()),
);

const PRE_EXECUTION_DOCUMENT_TYPES = uniqueSorted(
  FACTUAL_RULES.filter((row) => {
    const closing = String(row["Κίνηση κλεισίματος εκκρεμοτήτων αποθήκης"] || "").trim();
    return (
      String(row["Ανενεργό"] || "").trim() !== "1" &&
      ["CUSTOMER-ORDER", "CUSTOMER-ORDER-TO-CONF-OR-RESV", "CUSTOMER-ORDER-LS"].includes(closing) &&
      String(row["Από "] || "").trim()
    );
  }).map((row) => String(row["Από "] || "").trim()),
);

export const FACTUAL_LIFECYCLE_RULES = Object.freeze({
  executedOrderDocumentTypes: EXECUTED_ORDER_DOCUMENT_TYPES,
  openExecutionDocumentTypes: OPEN_EXECUTION_DOCUMENT_TYPES,
  preExecutionDocumentTypes: PRE_EXECUTION_DOCUMENT_TYPES,
  nonExecutedDocumentTypes: uniqueSorted([
    ...PRE_EXECUTION_DOCUMENT_TYPES,
    ...OPEN_EXECUTION_DOCUMENT_TYPES,
  ]),
});

export function buildDocumentTypeSqlList(documentTypes) {
  return documentTypes.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");
}
