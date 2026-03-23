export function resolveApiBase() {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  const queryBase = (params.get("api") || "").trim();
  if (queryBase) return queryBase.replace(/\/+$/, "");

  const localBase = window.localStorage.getItem("viomes.apiBase");
  if (localBase) return localBase.replace(/\/+$/, "");

  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (isLocal && window.location.port && window.location.port !== "3001") {
    return `http://${host}:3001`;
  }

  return "";
}

export const API_BASE = resolveApiBase();
export const MONTH_LABELS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαϊ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
export const PRODUCT_SALES_PAGE_SIZE = 10;
export const RECEIVABLES_PAGE_SIZE = 5;
export const RECENT_ORDERS_PAGE_SIZE = 10;
export const OPEN_ORDERS_PAGE_SIZE = 10;
export const PRE_APPROVAL_ORDERS_PAGE_SIZE = 10;
export const OPEN_ORDERS_TIME_RANGE_DAYS = 30;
export const PRE_APPROVAL_ORDERS_TIME_RANGE_DAYS = 10;
export const SEARCH_LOADING_MIN_VISIBLE_MS = 250;
export const STATS_LOADING_MIN_VISIBLE_MS = 300;
export const DEFAULT_SALES_TIME_RANGE = "3m";
export const ADMIN_STATE_KEY = "viomes.admin.state.v1";
export const ORDER_FORM_IMPORT_KEY = "viomes.orderForm.import.v1";
export const ORDER_FORM_RANKING_KEY = "viomes.orderForm.ranking.v1";
export const IMPORT_DATASET_LABELS = {
  sales_lines: "γραμμές πωλήσεων",
  customer_ledgers: "καρτέλες πελατών",
  imported_sales_lines: "γραμμές πωλήσεων",
  imported_customer_ledgers: "καρτέλες πελατών",
};
