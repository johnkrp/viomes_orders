import { asInteger } from "./shared.js";
import {
  buildAnalyticsLineFilter,
  buildCountInOrderTotalsCase,
  buildCustomerActivityFilter,
  buildEffectivePiecesExpression,
  buildEffectiveRevenueExpression,
} from "../document-type-rules.js";

export async function hasImportedData(db) {
  try {
    const row = await db.get(`SELECT COUNT(*) AS n FROM imported_sales_lines`);
    return asInteger(row?.n) > 0;
  } catch {
    return false;
  }
}

export async function loadImportedLedgerSnapshot(db, customerCode) {
  try {
    return await db.get(
      `
        SELECT
          customer_code,
          customer_name,
          commercial_balance,
          ledger_balance,
          credit,
          pending_instruments,
          email,
          is_inactive,
          salesperson_code
        FROM imported_customer_ledgers
        WHERE customer_code = ?
      `,
      [customerCode],
    );
  } catch {
    return null;
  }
}

export async function loadImportedLedgerLines(db, customerCode) {
  try {
    return await db.all(
      `
        SELECT
          document_date,
          document_no,
          reason,
          debit,
          credit,
          running_debit,
          running_credit,
          ledger_balance
        FROM imported_customer_ledger_lines
        WHERE customer_code = ?
        ORDER BY COALESCE(document_date, '') DESC, id DESC
      `,
      [customerCode],
    );
  } catch {
    return [];
  }
}

export function buildImportedBranchClause(branchCode, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  if (!String(branchCode || "").trim()) {
    return { clause: "", params: [] };
  }
  return {
    clause: ` AND ${prefix}branch_code = ?`,
    params: [String(branchCode).trim()],
  };
}

export function buildImportedBranchScopeClause(scope = {}, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const branchCode = String(scope?.branchCode || "").trim();
  const branchDescription = String(scope?.branchDescription || "").trim();
  const parts = [];
  const params = [];

  if (branchCode) {
    parts.push(`${prefix}branch_code LIKE ?`);
    params.push(`%${branchCode}%`);
  }

  if (branchDescription) {
    parts.push(`${prefix}branch_description LIKE ?`);
    params.push(`%${branchDescription}%`);
  }

  if (!parts.length) {
    return { clause: "", params: [] };
  }

  return {
    clause: ` AND ${parts.join(" AND ")}`,
    params,
  };
}

export async function loadImportedCustomerBranches(db, customerCode, scope = {}) {
  const branchScope = buildImportedBranchScopeClause(scope);
  return db.all(
    `
      SELECT
        branch_code,
        COALESCE(NULLIF(MAX(branch_description), ''), '') AS branch_description,
        SUM(orders) AS orders,
        SUM(revenue) AS revenue,
        MAX(last_order_date) AS last_order_date
      FROM imported_customer_branches
      WHERE customer_code = ?
        ${branchScope.clause}
        AND (branch_code <> '' OR branch_description <> '')
      GROUP BY branch_code
      ORDER BY branch_description ASC, branch_code ASC
    `,
    [customerCode, ...branchScope.params],
  );
}

export function shouldUseImportedProjections(selectedBranchCode, branchScopeCode, branchScopeDescription) {
  return !selectedBranchCode && !branchScopeCode && !branchScopeDescription;
}

export function buildImportedAnalyticsExpressions(alias = "") {
  return {
    analyticsFilter: buildAnalyticsLineFilter(alias),
    customerActivityFilter: buildCustomerActivityFilter(alias),
    effectiveRevenue: buildEffectiveRevenueExpression(alias),
    effectivePieces: buildEffectivePiecesExpression(alias),
    countInOrderTotals: buildCountInOrderTotalsCase(alias),
  };
}

export function buildImportedOrderIdExpression(sqlDialect) {
  return sqlDialect === "mysql"
    ? "CONCAT(customer_code, '::', order_date, '::', document_no)"
    : "customer_code || '::' || order_date || '::' || document_no";
}

export function buildImportedOrderRefExpression(sqlDialect) {
  if (sqlDialect === "mysql") {
    return "NULLIF(TRIM(SUBSTRING_INDEX(note_1, ':', -1)), '')";
  }

  return `NULLIF(TRIM(
    CASE
      WHEN INSTR(note_1, ':') > 0 THEN SUBSTR(note_1, INSTR(note_1, ':') + 1)
      ELSE note_1
    END
  ), '')`;
}
