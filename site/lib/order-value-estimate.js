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

// Rounded to WHOLE PERCENT before grouping. Two decimals is not coarse enough: the
// computed percentage carries rounding noise from net_value/qty/price, so one real 35%
// rate arrives as 34.97 / 34.99 / 35.00 / 35.04. Grouping at 2dp splits it into rival
// buckets and lets a smaller, older rate win the mode — for THE MART that produced 32%
// (a rate that stopped in May 2026) instead of the current 35%.
const CUSTOMER_MODAL_DISCOUNT_SQL = `
  SELECT ROUND(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}, 0) AS discount_pct,
         COUNT(*) AS line_count
  FROM imported_sales_lines
  WHERE customer_code = ?
    AND document_type IN (${EXECUTED_PLACEHOLDERS})
    AND unit_price > 0
  GROUP BY ROUND(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}, 0)
  ORDER BY line_count DESC, discount_pct DESC
  LIMIT 1
`;

/**
 * The ordering customer's own commercial discount rate — the single value they are most
 * often actually invoiced at.
 *
 * Needed because the any-customer price fallback would otherwise import the DONOR
 * customer's commercial terms along with the unit price. That is not a rounding error:
 * a 0%-discount account (e.g. DEDEMAN) donating a price to a 35%-discount account
 * (e.g. THE MART) overstates the line by more than half.
 *
 * The MODE, not the mean. Discount at Viomes is a per-customer rate rather than a
 * per-product-family one: across 179 customers with 50+ invoiced lines in 2026, 42% use
 * exactly one discount value and the modal rate covers 90% of lines on average. The
 * spread that does exist is mostly 0% promo/free lines, which drag a mean below the real
 * rate. Tested over 107,947 real lines, the mode predicted a line's discount with 0.662pp
 * mean absolute error against the mean's 0.884pp, and was closer on 68,316 lines versus
 * 16,771. For THE MART the mode gives 35% — matching their ES1 TradeDiscount exactly —
 * where the mean gave 33.56%. Checked against 9 customers, the whole-percent mode agrees
 * with the ES1 master TradeDiscount everywhere the master is current, and beats it for
 * ΑΝΑΝΙΑΔΗΣ, whose master (37%) is stale against the 40% actually invoiced.
 *
 * This still reads only what was actually charged; it does not reconstruct the pricelist
 * engine. Ties break toward the higher discount, which understates rather than overstates
 * order value — the safer direction for an approver's sanity check.
 */
async function findCustomerModalDiscount(db, customerCode) {
  if (!customerCode) return null;
  const row = await db.get(CUSTOMER_MODAL_DISCOUNT_SQL, [
    customerCode,
    ...EXECUTED_TYPES,
  ]);
  const value = Number(row?.discount_pct);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Estimates order value from the most recent ACTUAL invoiced price/discount for
 * each customer+item pair (falls back to any customer's last invoiced price for
 * that item if this customer has never bought it). Items with no invoice history
 * anywhere come back with source "no_history" and are excluded from the total.
 */
export async function estimateOrderValue(db, { customerCode, items }) {
  const lines = [];
  let customerModalDiscount;

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
    let discountPct = row ? Number(row.discount_pct) || 0 : 0;

    // On the fallback path the price came from another customer's invoice, so its
    // discount reflects THEIR terms. Substitute this customer's own average discount
    // when we have one; keep the donor's only if this customer has no history at all.
    if (source === "last_invoice_any_customer") {
      if (customerModalDiscount === undefined) {
        customerModalDiscount = await findCustomerModalDiscount(db, customerCode);
      }
      if (customerModalDiscount !== null && customerModalDiscount !== undefined) {
        discountPct = customerModalDiscount;
      }
    }

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
  const fallbackLines = lines.filter(
    (line) => line.source === "last_invoice_any_customer",
  ).length;
  const totalNetValue = Number(
    lines.reduce((sum, line) => sum + line.lineNetValue, 0).toFixed(2),
  );

  return {
    lines,
    totalNetValue,
    pricedLines,
    fallbackLines,
    totalLines: lines.length,
    isPartial: pricedLines < lines.length,
    hasFallback: fallbackLines > 0,
  };
}
