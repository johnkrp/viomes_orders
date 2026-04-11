import {
  OPEN_ORDERS_TIME_RANGE_DAYS,
  PRE_APPROVAL_ORDERS_TIME_RANGE_DAYS,
} from "./admin-constants.js";
import { compareSortableValues, parseIsoDate } from "./admin-utils.js";

export function getSortedProductSales(context) {
  const metric = context.elements.productSalesMetric?.value === "pieces" ? "pieces" : "revenue";
  return [...context.state.currentProductSales].sort((a, b) => {
    if (metric === "pieces") {
      return Number(b.pieces || 0) - Number(a.pieces || 0) || Number(b.revenue || 0) - Number(a.revenue || 0);
    }
    return Number(b.revenue || 0) - Number(a.revenue || 0) || Number(b.pieces || 0) - Number(a.pieces || 0);
  });
}

export function getSortedProductSalesForTable(context) {
  const metric = context.elements.productSalesMetric?.value === "pieces" ? "pieces" : "revenue";
  const primaryMetricField = metric === "pieces" ? "pieces" : "revenue";
  const secondaryMetricField = metric === "pieces" ? "revenue" : "pieces";
  const sortState = context.state.productSalesSort;

  return [...context.state.currentProductSales].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;

    if (key === "code" || key === "description") {
      compare = compareSortableValues(a?.[key], b?.[key], { direction: sortState.direction });
    } else if (key === "primary_metric") {
      compare = compareSortableValues(a?.[primaryMetricField], b?.[primaryMetricField], {
        direction: sortState.direction,
        numeric: true,
      });
    } else if (key === "secondary_metric") {
      compare = compareSortableValues(a?.[secondaryMetricField], b?.[secondaryMetricField], {
        direction: sortState.direction,
        numeric: true,
      });
    } else {
      compare = compareSortableValues(a?.[key], b?.[key], {
        direction: sortState.direction,
        numeric: true,
      });
    }

    if (compare !== 0) return compare;
    return compareSortableValues(a?.code, b?.code, { direction: "asc" });
  });
}

export function normalizeFilterValue(value) {
  return String(value ?? "").trim().toLocaleLowerCase("el-GR");
}

export function matchesProductTableFilters(item, filters = {}) {
  const codeFilter = normalizeFilterValue(filters.code);
  const descriptionFilter = normalizeFilterValue(filters.description);
  const code = normalizeFilterValue(item?.code);
  const description = normalizeFilterValue(item?.description);

  if (codeFilter && !code.includes(codeFilter)) return false;
  if (descriptionFilter && !description.includes(descriptionFilter)) return false;
  return true;
}

export function filterProductItems(items, filters = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => matchesProductTableFilters(item, filters));
}

export function getRecentOrdersForTable(context) {
  const sortState = context.state.recentOrdersSort;
  const sourceOrders = Array.isArray(context.state.lastRenderedStatsPayload?.recent_orders)
    ? context.state.lastRenderedStatsPayload.recent_orders
    : context.state.currentDetailedOrders;

  return [...sourceOrders].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;

    if (key === "ordered_at" || key === "created_at") {
      compare = compareSortableValues(a?.[key], b?.[key], { direction: sortState.direction, date: true });
    } else if (key === "order_id") {
      compare = compareSortableValues(a?.order_id, b?.order_id, { direction: sortState.direction });
    } else {
      compare = compareSortableValues(a?.[key], b?.[key], { direction: sortState.direction, numeric: true });
    }

    if (compare !== 0) return compare;
    return compareSortableValues(a?.created_at, b?.created_at, { direction: "desc", date: true });
  });
}

export function getOpenOrdersForTable(context) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OPEN_ORDERS_TIME_RANGE_DAYS * 86400000);
  const filtered = context.state.currentOpenOrders.filter((order) => {
    const date = parseIsoDate(order?.created_at);
    return date ? date >= cutoff : false;
  });
  const sortState = context.state.openOrdersSort;

  return [...filtered].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;
    if (key === "created_at") {
      compare = compareSortableValues(a?.created_at, b?.created_at, {
        direction: sortState.direction,
        date: true,
      });
    } else if (["total_lines", "total_pieces", "total_net_value", "average_discount_pct"].includes(key)) {
      compare = compareSortableValues(a?.[key], b?.[key], { direction: sortState.direction, numeric: true });
    } else {
      compare = compareSortableValues(a?.order_id, b?.order_id, { direction: sortState.direction });
    }

    if (compare !== 0) return compare;
    return String(b?.order_id || "").localeCompare(String(a?.order_id || ""));
  });
}

export function getPreApprovalOrdersForTable(context) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - PRE_APPROVAL_ORDERS_TIME_RANGE_DAYS * 86400000);
  const filtered = context.state.currentPreApprovalOrders.filter((order) => {
    const date = parseIsoDate(order?.created_at);
    return date ? date >= cutoff : false;
  });
  const sortState = context.state.preApprovalOrdersSort;

  return [...filtered].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;
    if (key === "created_at") {
      compare = compareSortableValues(a?.created_at, b?.created_at, {
        direction: sortState.direction,
        date: true,
      });
    } else if (["total_lines", "total_pieces", "total_net_value", "average_discount_pct"].includes(key)) {
      compare = compareSortableValues(a?.[key], b?.[key], { direction: sortState.direction, numeric: true });
    } else {
      compare = compareSortableValues(a?.order_id, b?.order_id, { direction: sortState.direction });
    }

    if (compare !== 0) return compare;
    return String(b?.order_id || "").localeCompare(String(a?.order_id || ""));
  });
}
