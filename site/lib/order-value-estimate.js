import { FACTUAL_LIFECYCLE_RULES } from "./factual-lifecycle.js";
import { IMPORTED_DISCOUNT_PERCENT_EXPRESSION } from "./imported-sales.js";

// Estimated order value, NOT the authoritative ES1 price. ES1's commercial-policy
// engine is compiled and only resolves the real price live in the app (quantity
// breaks, per-customer overrides, pricelist categories) — see CLAUDE.md's pricing
// rule in the sibling viomes_db repo. This estimate exists so an approver can sanity-
// check order size before it reaches ES1, not to predict the final invoice value.
const EXECUTED_TYPES = FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes;
const EXECUTED_PLACEHOLDERS = EXECUTED_TYPES.map(() => "?").join(", ");

const LAST_INVOICED_LINE_SQL = `
  SELECT unit_price, ${IMPORTED_DISCOUNT_PERCENT_EXPRESSION} AS discount_pct
  FROM imported_sales_lines
  WHERE item_code = ?
    AND document_type IN (${EXECUTED_PLACEHOLDERS})
    AND unit_price > 0
    __CUSTOMER_FILTER__
  ORDER BY order_date DESC, document_no DESC
  LIMIT 1
`;

async function findLastInvoicedLine(db, { customerCode, itemCode }) {
  const sql = LAST_INVOICED_LINE_SQL.replace(
    "__CUSTOMER_FILTER__",
    customerCode ? "AND customer_code = ?" : "",
  );
  const params = customerCode
    ? [itemCode, ...EXECUTED_TYPES, customerCode]
    : [itemCode, ...EXECUTED_TYPES];
  return db.get(sql, params);
}

/**
 * Estimates order value from the most recent ACTUAL invoiced price/discount for
 * each customer+item pair (falls back to any customer's last invoiced price for
 * that item if this customer has never bought it). Items with no invoice history
 * anywhere come back with source "no_history" and are excluded from the total.
 */
export async function estimateOrderValue(db, { customerCode, items }) {
  const lines = [];

  for (const item of items) {
    let row = null;
    let source = "no_history";

    if (customerCode) {
      row = await findLastInvoicedLine(db, { customerCode, itemCode: item.code });
      if (row) source = "last_invoice_customer";
    }

    if (!row) {
      row = await findLastInvoicedLine(db, { customerCode: null, itemCode: item.code });
      if (row) source = "last_invoice_any_customer";
    }

    const unitPrice = row ? Number(row.unit_price) || 0 : 0;
    const discountPct = row ? Number(row.discount_pct) || 0 : 0;
    const lineNetValue = row
      ? Number((unitPrice * (1 - discountPct / 100) * item.qty).toFixed(2))
      : 0;

    lines.push({
      code: item.code,
      qty: item.qty,
      unitPrice,
      discountPct,
      lineNetValue,
      source,
    });
  }

  const pricedLines = lines.filter((line) => line.source !== "no_history").length;
  const totalNetValue = Number(
    lines.reduce((sum, line) => sum + line.lineNetValue, 0).toFixed(2),
  );

  return {
    lines,
    totalNetValue,
    pricedLines,
    totalLines: lines.length,
    isPartial: pricedLines < lines.length,
  };
}
