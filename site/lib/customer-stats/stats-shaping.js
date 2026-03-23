import { asInteger, asMoney, availableBranchRow, productSalesRow, productStatRow } from "./shared.js";

export function createMonthlyBuckets() {
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    revenue: 0,
    pieces: 0,
  }));
}

export function mergeMonthlyRows(rows) {
  const buckets = createMonthlyBuckets();
  for (const row of rows) {
    const monthIndex = asInteger(row.month) - 1;
    if (monthIndex < 0 || monthIndex >= 12) continue;
    buckets[monthIndex] = {
      month: monthIndex + 1,
      revenue: asMoney(row.revenue),
      pieces: asInteger(row.pieces),
    };
  }
  return buckets;
}

export async function loadMonthlyYearlySeries(db, query, customerCode, years) {
  const series = [];
  for (const yearEntry of years) {
    const yearParams = Array.isArray(yearEntry) ? yearEntry : [yearEntry];
    const rows = await db.all(query, [customerCode, ...yearParams]);
    series.push({
      year: yearParams[0],
      months: mergeMonthlyRows(rows),
    });
  }
  return series;
}

export function asRoundedUpPercent(value) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.ceil(numericValue);
}

export function buildDetailedOrder(order, lines, overrides = {}) {
  return {
    order_id: order.order_id,
    document_type: overrides.document_type ?? order.document_type,
    created_at: order.created_at,
    ordered_at: order.ordered_at || order.created_at,
    sent_at: order.sent_at || null,
    notes: overrides.notes ?? order.notes ?? "",
    total_lines: asInteger(order.total_lines),
    total_pieces: asInteger(order.total_pieces),
    total_net_value: asMoney(order.total_net_value),
    average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
    lines: lines.map((line) => ({
      code: line.code,
      description: line.description,
      qty: asInteger(line.qty),
      unit_price: asMoney(line.unit_price),
      discount_pct: asRoundedUpPercent(line.discount_pct),
      line_net_value: asMoney(line.line_net_value),
    })),
  };
}

export function buildSummaryOrder(order) {
  return {
    order_id: order.order_id,
    ...(order.document_type !== undefined ? { document_type: order.document_type || "" } : {}),
    created_at: order.created_at,
    ordered_at: order.ordered_at || order.created_at,
    sent_at: order.sent_at || null,
    total_lines: asInteger(order.total_lines),
    total_pieces: asInteger(order.total_pieces),
    total_net_value: asMoney(order.total_net_value),
    average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
  };
}

export function buildReceivables(importedLedger, importedLedgerLines) {
  return {
    currency: "EUR",
    open_balance: asMoney(importedLedger?.ledger_balance),
    overdue_balance: 0,
    progressive_credit: asMoney(importedLedger?.credit),
    total_credit: asMoney(importedLedger?.credit),
    items: importedLedgerLines.map((row) => ({
      document_date: row.document_date || null,
      document_no: row.document_no || "",
      reason: row.reason || "",
      debit: asMoney(row.debit),
      credit: asMoney(row.credit),
      ledger_balance: asMoney(row.ledger_balance),
    })),
  };
}

export function toCustomerStatsPayload(result) {
  return {
    customer: result.customer,
    summary: result.summary,
    range_summary: result.rangeSummary,
    monthly_sales: result.monthlySales,
    product_sales: {
      metric: result.productSales.metric,
      items: result.productSales.items.map(productSalesRow),
    },
    receivables: result.receivables,
    top_products_by_qty: result.topProductsByQty.map(productStatRow),
    top_products_by_value: result.topProductsByValue.map(productStatRow),
    available_branches: result.availableBranches.map(availableBranchRow),
    recent_orders: result.recentOrders,
    open_orders: result.openOrders,
    pre_approval_orders: result.preApprovalOrders,
    detailed_orders: result.detailedOrders,
    detailed_open_orders: result.detailedOpenOrders,
    detailed_pre_approval_orders: result.detailedPreApprovalOrders,
  };
}
