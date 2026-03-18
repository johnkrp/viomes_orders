function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function resolveApiBase() {
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

const API_BASE = resolveApiBase();
const MONTH_LABELS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαϊ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const PRODUCT_SALES_PAGE_SIZE = 10;
const RECEIVABLES_PAGE_SIZE = 5;
const RECENT_ORDERS_PAGE_SIZE = 10;
const OPEN_ORDERS_PAGE_SIZE = 10;
const PRE_APPROVAL_ORDERS_PAGE_SIZE = 10;
const OPEN_ORDERS_TIME_RANGE_DAYS = 30;
const PRE_APPROVAL_TIME_RANGE_DAYS = 10;
const SEARCH_LOADING_MIN_VISIBLE_MS = 250;
const STATS_LOADING_MIN_VISIBLE_MS = 300;
const DEFAULT_SALES_TIME_RANGE = "3m";
const ADMIN_STATE_KEY = "viomes.admin.state.v1";
const ORDER_FORM_IMPORT_KEY = "viomes.orderForm.import.v1";
const ORDER_FORM_RANKING_KEY = "viomes.orderForm.ranking.v1";
const IMPORT_DATASET_LABELS = {
  sales_lines: "γραμμές πωλήσεων",
  customer_ledgers: "καρτέλες πελατών",
  imported_sales_lines: "γραμμές πωλήσεων",
  imported_customer_ledgers: "καρτέλες πελατών",
};

let currentDetailedOrders = [];
let currentDetailedOpenOrders = [];
let currentDetailedPreApprovalOrders = [];
let currentOpenOrders = [];
let currentPreApprovalOrders = [];
let currentProductSales = [];
let currentTopProductsByQty = [];
let currentTopProductsByValue = [];
let currentSearchResults = [];
let selectedOrderId = null;
let currentReceivables = [];
let currentProductSalesPage = 1;
let currentReceivablesPage = 1;
let currentRecentOrdersPage = 1;
let currentOpenOrdersPage = 1;
let currentPreApprovalOrdersPage = 1;
let recentOrdersSort = { key: "created_at", direction: "desc" };
let productSalesSort = { key: "primary_metric", direction: "desc" };
let openOrdersSort = { key: "created_at", direction: "desc" };
let preApprovalOrdersSort = { key: "created_at", direction: "desc" };
let currentProductSalesFilters = { code: "", description: "" };
let currentCustomerCode = null;
let currentBranchCode = "";
let currentAvailableBranches = [];
let currentSalesTimeRange = DEFAULT_SALES_TIME_RANGE;
let currentCustomerSearchFilters = {
  customer_name: "",
  customer_code: "",
  branch_code: "",
  branch_description: "",
};
let currentSearchRequestId = 0;
let currentStatsRequestId = 0;
let searchLoadingStateId = 0;
let statsLoadingStateId = 0;
let searchLoadingStartedAt = 0;
let statsLoadingStartedAt = 0;
let lastRenderedStatsPayload = null;
const restoredAdminState = loadAdminState();

const els = {
  adminStatus: document.getElementById("adminStatus"),
  loginPanel: document.getElementById("loginPanel"),
  loginForm: document.getElementById("loginForm"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  dashboardPanel: document.getElementById("dashboardPanel"),
  sessionInfo: document.getElementById("sessionInfo"),
  customerSearchPanel: document.getElementById("customerSearchPanel"),
  searchPanelContent: document.getElementById("searchPanelContent"),
  expandSearchPanelBtn: document.getElementById("expandSearchPanelBtn"),
  customerSearchForm: document.getElementById("customerSearchForm"),
  customerNameQuery: document.getElementById("customerNameQuery"),
  customerCodeQuery: document.getElementById("customerCodeQuery"),
  branchCodeQuery: document.getElementById("branchCodeQuery"),
  branchDescriptionQuery: document.getElementById("branchDescriptionQuery"),
  searchCustomersBtn: document.getElementById("searchCustomersBtn"),
  clearStatsBtn: document.getElementById("clearStatsBtn"),
  searchLoadingNotice: document.getElementById("searchLoadingNotice"),
  searchResultsPanel: document.getElementById("searchResultsPanel"),
  searchResultsBody: document.getElementById("searchResultsBody"),
  branchSelectorPanel: document.getElementById("branchSelectorPanel"),
  branchSelectorSearch: document.getElementById("branchSelectorSearch"),
  branchSelector: document.getElementById("branchSelector"),
  emptyState: document.getElementById("emptyState"),
  statsPanel: document.getElementById("statsPanel"),
  statsLoadingNotice: document.getElementById("statsLoadingNotice"),
  receivablesPanel: document.getElementById("receivablesPanel"),
  customerNameHeading: document.getElementById("customerNameHeading"),
  customerMeta: document.getElementById("customerMeta"),
  totalOrdersValue: document.getElementById("totalOrdersValue"),
  totalPiecesValue: document.getElementById("totalPiecesValue"),
  totalRevenueValue: document.getElementById("totalRevenueValue"),
  activeDocumentsValue: document.getElementById("activeDocumentsValue"),
  averageOrderValue: document.getElementById("averageOrderValue"),
  daysSinceLastOrderValue: document.getElementById("daysSinceLastOrderValue"),
  averageDaysBetweenOrdersValue: document.getElementById("averageDaysBetweenOrdersValue"),
  acceptedOrdersValue: document.getElementById("acceptedOrdersValue"),
  inProgressOrdersValue: document.getElementById("inProgressOrdersValue"),
  invoicedOrdersValue: document.getElementById("invoicedOrdersValue"),
  lastOrderDateValue: document.getElementById("lastOrderDateValue"),
  monthlySalesBody: document.getElementById("monthlySalesBody"),
  monthlyYearOneHeading: document.getElementById("monthlyYearOneHeading"),
  monthlyYearTwoHeading: document.getElementById("monthlyYearTwoHeading"),
  monthlyYearThreeHeading: document.getElementById("monthlyYearThreeHeading"),
  monthlySalesFoot: document.getElementById("monthlySalesFoot"),
  receivablesOpenValue: document.getElementById("receivablesOpenValue"),
  receivablesPagination: document.getElementById("receivablesPagination"),
  receivablesPrevBtn: document.getElementById("receivablesPrevBtn"),
  receivablesNextBtn: document.getElementById("receivablesNextBtn"),
  receivablesPageInfo: document.getElementById("receivablesPageInfo"),
  receivablesBody: document.getElementById("receivablesBody"),
  salesTimeRange: document.getElementById("salesTimeRange"),
  productSalesMetric: document.getElementById("productSalesMetric"),
  productSalesMetricHeading: document.getElementById("productSalesMetricHeading"),
  productSalesSecondaryMetricHeading: document.getElementById("productSalesSecondaryMetricHeading"),
  productSalesCodeFilter: document.getElementById("productSalesCodeFilter"),
  productSalesDescriptionFilter: document.getElementById("productSalesDescriptionFilter"),
  productSalesBody: document.getElementById("productSalesBody"),
  productSalesPagination: document.getElementById("productSalesPagination"),
  productSalesPrevBtn: document.getElementById("productSalesPrevBtn"),
  productSalesNextBtn: document.getElementById("productSalesNextBtn"),
  productSalesPageInfo: document.getElementById("productSalesPageInfo"),
  topProductsQtyBody: document.getElementById("topProductsQtyBody"),
  topProductsValueBody: document.getElementById("topProductsValueBody"),
  openRankedOrderFormBtn: document.getElementById("openRankedOrderFormBtn"),
  recentOrdersBody: document.getElementById("recentOrdersBody"),
  recentOrdersPagination: document.getElementById("recentOrdersPagination"),
  recentOrdersPrevBtn: document.getElementById("recentOrdersPrevBtn"),
  recentOrdersNextBtn: document.getElementById("recentOrdersNextBtn"),
  recentOrdersPageInfo: document.getElementById("recentOrdersPageInfo"),
  openOrdersBody: document.getElementById("openOrdersBody"),
  openOrdersPagination: document.getElementById("openOrdersPagination"),
  openOrdersPrevBtn: document.getElementById("openOrdersPrevBtn"),
  openOrdersNextBtn: document.getElementById("openOrdersNextBtn"),
  openOrdersPageInfo: document.getElementById("openOrdersPageInfo"),
  preApprovalOrdersBody: document.getElementById("preApprovalOrdersBody"),
  preApprovalOrdersPagination: document.getElementById("preApprovalOrdersPagination"),
  preApprovalOrdersPrevBtn: document.getElementById("preApprovalOrdersPrevBtn"),
  preApprovalOrdersNextBtn: document.getElementById("preApprovalOrdersNextBtn"),
  preApprovalOrdersPageInfo: document.getElementById("preApprovalOrdersPageInfo"),
  detailedOrdersList: document.getElementById("detailedOrdersList"),
};

function loadAdminState() {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function clearAdminState() {
  try {
    window.sessionStorage.removeItem(ADMIN_STATE_KEY);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function fillSearchFields(filters = {}) {
  if (els.customerNameQuery) els.customerNameQuery.value = filters.customer_name || "";
  if (els.customerCodeQuery) els.customerCodeQuery.value = filters.customer_code || "";
  if (els.branchCodeQuery) els.branchCodeQuery.value = filters.branch_code || "";
  if (els.branchDescriptionQuery) els.branchDescriptionQuery.value = filters.branch_description || "";
}

function saveAdminState() {
  try {
    const state = {
      authenticatedLikely: !els.dashboardPanel?.hidden,
      username: els.username?.value || "",
      searchPanelCollapsed: Boolean(els.searchPanelContent?.hidden),
      searchFields: getCustomerSearchFilters(),
      currentCustomerSearchFilters,
      currentSearchResults,
      currentCustomerCode,
      currentBranchCode,
      currentAvailableBranches,
      currentSalesTimeRange,
      currentProductSalesPage,
      currentReceivablesPage,
      currentRecentOrdersPage,
      currentOpenOrdersPage,
      currentPreApprovalOrdersPage,
      selectedOrderId,
      branchSelectorSearch: els.branchSelectorSearch?.value || "",
      productSalesMetric: els.productSalesMetric?.value || "revenue",
      lastRenderedStatsPayload,
    };
    window.sessionStorage.setItem(ADMIN_STATE_KEY, JSON.stringify(state));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function restoreAdminStateView(state) {
  if (!state) return;

  fillSearchFields(state.searchFields || state.currentCustomerSearchFilters || {});
  setCurrentCustomerSearchFilters(state.currentCustomerSearchFilters || state.searchFields || {});
  currentSalesTimeRange = normalizeSalesTimeRange(state.currentSalesTimeRange || DEFAULT_SALES_TIME_RANGE);
  syncSalesTimeRangeControls(currentSalesTimeRange);
  setSearchPanelCollapsed(Boolean(state.searchPanelCollapsed));

  if (Array.isArray(state.currentSearchResults) && state.currentSearchResults.length) {
    renderSearchResults(state.currentSearchResults, state.currentCustomerSearchFilters || state.searchFields || {});
  }

  if (state.lastRenderedStatsPayload) {
    renderStats(state.lastRenderedStatsPayload);
    currentProductSalesPage = Math.max(1, Number(state.currentProductSalesPage) || 1);
    currentReceivablesPage = Math.max(1, Number(state.currentReceivablesPage) || 1);
    currentRecentOrdersPage = Math.max(1, Number(state.currentRecentOrdersPage) || 1);
    currentOpenOrdersPage = Math.max(1, Number(state.currentOpenOrdersPage) || 1);
    currentPreApprovalOrdersPage = Math.max(1, Number(state.currentPreApprovalOrdersPage) || 1);
    selectedOrderId = state.selectedOrderId || null;
    if (els.productSalesMetric) {
      els.productSalesMetric.value = state.productSalesMetric === "pieces" ? "pieces" : "revenue";
    }
    if (els.branchSelectorSearch) {
      els.branchSelectorSearch.value = state.branchSelectorSearch || "";
    }
    renderProductSales();
    renderReceivablesTable();
    renderPreApprovalOrdersTable();
    renderRecentOrdersTable();
    renderSelectedOrderDetails();
  }
}

function getSalesTimeRangeControls() {
  return Array.from(document.querySelectorAll(".sales-time-range-control"));
}

function normalizeSalesTimeRange(value) {
  const normalized = String(value || DEFAULT_SALES_TIME_RANGE).trim().toLowerCase();
  const allowedValues = new Set(["1m", "3m", "6m", "12m", "this_year", "last_year", "all"]);
  return allowedValues.has(normalized) ? normalized : DEFAULT_SALES_TIME_RANGE;
}

function syncSalesTimeRangeControls(value) {
  const normalizedValue = normalizeSalesTimeRange(value);
  getSalesTimeRangeControls().forEach((control) => {
    if (control) control.value = normalizedValue;
  });
}

function getSelectedSalesTimeRange() {
  const firstControl = getSalesTimeRangeControls()[0];
  return normalizeSalesTimeRange(firstControl?.value || currentSalesTimeRange || DEFAULT_SALES_TIME_RANGE);
}

function normalizeSalesTimeRangeControlsText() {
  const labelsByValue = {
    "1m": "Τελευταίος 1 μήνας",
    "3m": "Τελευταίοι 3 μήνες",
    "6m": "Τελευταίοι 6 μήνες",
    "12m": "Τελευταίοι 12 μήνες",
    this_year: "Τρέχον έτος",
    last_year: "Προηγούμενο έτος",
    all: "2024 και μετά",
  };

  getSalesTimeRangeControls().forEach((control) => {
    const labelText = control.closest("label")?.querySelector("span");
    if (labelText) labelText.textContent = "Περίοδος";

    Array.from(control.options).forEach((option) => {
      const normalizedValue = String(option.value || "").trim().toLowerCase();
      if (labelsByValue[normalizedValue]) option.textContent = labelsByValue[normalizedValue];
    });
  });
}

normalizeSalesTimeRangeControlsText();

function setStatus(text, type = "info") {
  const el = els.adminStatus;
  if (!el) return;

  if (!text) {
    el.className = "toast admin-toast";
    el.innerHTML = "";
    return;
  }

  el.className = "toast admin-toast show";
  if (type === "error") el.classList.add("is-error");
  else if (type === "ok") el.classList.add("is-ok");
  else el.classList.add("is-info");

  const icon = type === "error" ? "!" : type === "ok" ? "OK" : "i";
  el.innerHTML = `
    <div class="icon">${icon}</div>
    <div class="text">${escapeHtml(text)}</div>
  `;
}

function renderLoadingNotice(element, isLoading, message) {
  if (!element) return;
  element.hidden = !isLoading;
  if (!isLoading) {
    element.innerHTML = "";
    return;
  }
  element.innerHTML = `
    <div class="admin-loading-spinner" aria-hidden="true"></div>
    <div class="admin-loading-text">${escapeHtml(message)}</div>
  `;
}

function setSessionInfo(text) {
  if (els.sessionInfo) {
    els.sessionInfo.textContent = text;
  }
}

function formatImportDatasetLabel(dataset) {
  const normalized = String(dataset || "").trim().toLowerCase();
  if (!normalized) return "άγνωστο";
  return IMPORT_DATASET_LABELS[normalized] || normalized;
}

function buildImportMessage(latestRun, username) {
  const base = `Συνδεδεμένος χρήστης: ${username}. API: ${API_BASE || "same-origin"}`;
  if (!latestRun) return `${base}. Τελευταία εισαγωγή δεδομένων: μη διαθέσιμη`;

  const dataset = formatImportDatasetLabel(latestRun.dataset);
  const finishedAt = formatDate(latestRun.finished_at || latestRun.started_at);
  return `${base}. Τελευταία εισαγωγή δεδομένων: ${dataset}, στις ${finishedAt}`;
}

async function loadLatestImportMessage(me) {
  if (!me?.authenticated) {
    setSessionInfo("Δεν υπάρχει ενεργή συνεδρία διαχειριστή.");
    return;
  }

  setSessionInfo(`Συνδεδεμένος χρήστης: ${me.username}. Φόρτωση τελευταίας εισαγωγής δεδομένων...`);

  try {
    const payload = await apiFetch("/api/admin/import-health", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    setSessionInfo(buildImportMessage(payload?.latest_import_run || null, me.username));
  } catch (_error) {
    setSessionInfo(buildImportMessage(null, me.username));
  }
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function applySearchLoadingState(isLoading, message = "Φόρτωση...") {
  const busy = Boolean(isLoading);
  els.customerSearchPanel?.setAttribute("aria-busy", String(busy));
  els.searchResultsPanel?.classList.toggle("is-loading", busy);
  renderLoadingNotice(els.searchLoadingNotice, busy, message);

  if (els.searchCustomersBtn) {
    els.searchCustomersBtn.disabled = busy;
    els.searchCustomersBtn.textContent = busy ? "Αναζήτηση..." : "Αναζήτηση";
  }
  if (els.clearStatsBtn) els.clearStatsBtn.disabled = busy;
  [els.customerNameQuery, els.customerCodeQuery, els.branchCodeQuery, els.branchDescriptionQuery].forEach(
    (input) => {
      if (input) input.disabled = busy;
    },
  );
}

async function setSearchLoading(isLoading, message = "Φόρτωση...") {
  const stateId = ++searchLoadingStateId;
  const busy = Boolean(isLoading);

  if (busy) {
    searchLoadingStartedAt = Date.now();
    applySearchLoadingState(true, message);
    return;
  }

  const elapsed = searchLoadingStartedAt ? Date.now() - searchLoadingStartedAt : SEARCH_LOADING_MIN_VISIBLE_MS;
  const remaining = Math.max(SEARCH_LOADING_MIN_VISIBLE_MS - elapsed, 0);
  if (remaining > 0) {
    await sleep(remaining);
  }
  if (stateId !== searchLoadingStateId) return;
  applySearchLoadingState(false, message);
}

function applyStatsLoadingState(isLoading, message = "Φόρτωση στοιχείων πελάτη...") {
  const busy = Boolean(isLoading);
  els.statsPanel?.setAttribute("aria-busy", String(busy));
  els.statsPanel?.classList.toggle("is-loading", busy);
  renderLoadingNotice(els.statsLoadingNotice, busy, message);

  if (busy) {
    els.emptyState.hidden = true;
    els.statsPanel.hidden = false;
  }

  if (els.branchSelector) {
    els.branchSelector.disabled = busy || currentAvailableBranches.length <= 1;
  }
  if (els.branchSelectorSearch) {
    els.branchSelectorSearch.disabled = busy || currentAvailableBranches.length <= 1;
  }

  els.searchResultsBody?.querySelectorAll("[data-customer-code]").forEach((button) => {
    button.disabled = busy;
  });
}

async function setStatsLoading(isLoading, message = "Φόρτωση στοιχείων πελάτη...") {
  const stateId = ++statsLoadingStateId;
  const busy = Boolean(isLoading);

  if (busy) {
    statsLoadingStartedAt = Date.now();
    applyStatsLoadingState(true, message);
    return;
  }

  const elapsed = statsLoadingStartedAt ? Date.now() - statsLoadingStartedAt : STATS_LOADING_MIN_VISIBLE_MS;
  const remaining = Math.max(STATS_LOADING_MIN_VISIBLE_MS - elapsed, 0);
  if (remaining > 0) {
    await sleep(remaining);
  }
  if (stateId !== statsLoadingStateId) return;
  applyStatsLoadingState(false, message);
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.detail || payload?.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return payload;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("el-GR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("el-GR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoney(value) {
  return new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("el-GR").format(Number(value || 0));
}

function formatPercentRoundedUp(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  return `${Math.ceil(numericValue)}%`;
}

function formatDays(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${formatNumber(value)} ημ.`;
}

function numberStateClass(value) {
  return Number(value || 0) < 0 ? " admin-number-negative" : "";
}

function findDetailedOrder(orderId) {
  const normalizedId = String(orderId);
  return (
    currentDetailedOrders.find((order) => String(order.order_id) === normalizedId) ||
    currentDetailedOpenOrders.find((order) => String(order.order_id) === normalizedId) ||
    currentDetailedPreApprovalOrders.find((order) => String(order.order_id) === normalizedId) ||
    null
  );
}

function formatDisplayOrderId(orderId) {
  const raw = String(orderId || "").trim();
  if (!raw) return "-";
  const parts = raw.split("::").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

function compareSortableValues(a, b, { direction = "asc", numeric = false, date = false } = {}) {
  const multiplier = direction === "desc" ? -1 : 1;
  if (date) {
    const left = Date.parse(String(a || "")) || 0;
    const right = Date.parse(String(b || "")) || 0;
    return (left - right) * multiplier;
  }
  if (numeric) {
    const left = Number(a || 0);
    const right = Number(b || 0);
    return (left - right) * multiplier;
  }
  return String(a || "").localeCompare(String(b || ""), "el") * multiplier;
}

function updateSortIndicators(tableId, sortState) {
  document.querySelectorAll(`[data-table-sort="${tableId}"]`).forEach((button) => {
    const sortKey = button.getAttribute("data-sort-key");
    const indicator = button.querySelector(".admin-sort-indicator");
    if (!indicator) return;
    if (sortKey === sortState.key) {
      indicator.textContent = sortState.direction === "asc" ? "↑" : "↓";
      return;
    }
    indicator.textContent = "↕";
  });
}

function setAuthenticatedUI(me) {
  const authenticated = Boolean(me?.authenticated);
  els.loginPanel.hidden = authenticated;
  els.dashboardPanel.hidden = !authenticated;
  els.logoutBtn.hidden = !authenticated;

  if (!authenticated) {
    setSessionInfo("Δεν υπάρχει ενεργή συνεδρία διαχειριστή.");
    return;
  }

  setSessionInfo(`Συνδεδεμένος χρήστης: ${me.username}. Φόρτωση τελευταίας εισαγωγής δεδομένων...`);
}

function resetProductSales() {
  currentProductSales = [];
  currentProductSalesPage = 1;
  if (els.productSalesMetric) els.productSalesMetric.value = "revenue";
  if (els.productSalesMetricHeading) els.productSalesMetricHeading.textContent = "Τζίρος";
  if (els.productSalesSecondaryMetricHeading) els.productSalesSecondaryMetricHeading.textContent = "Τεμάχια";
  if (els.productSalesPagination) els.productSalesPagination.hidden = true;
  if (els.productSalesPageInfo) els.productSalesPageInfo.textContent = "Σελίδα 1 από 1";
  if (els.productSalesPrevBtn) els.productSalesPrevBtn.disabled = true;
  if (els.productSalesNextBtn) els.productSalesNextBtn.disabled = true;
  updateSortIndicators("product-sales", productSalesSort);
  if (els.productSalesBody) {
    els.productSalesBody.innerHTML = `
      <tr>
        <td colspan="6" class="admin-table-empty">Δεν έχουν φορτωθεί ακόμη οι πωλήσεις ειδών.</td>
      </tr>
    `;
  }
}

function resetSearchResults() {
  currentSearchResults = [];
  if (els.searchResultsPanel) els.searchResultsPanel.hidden = true;
  els.searchResultsPanel?.classList.remove("is-loading");
  renderLoadingNotice(els.searchLoadingNotice, false, "");
  if (els.searchResultsBody) {
    els.searchResultsBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη αποτελέσματα.</td>
      </tr>
    `;
  }
}

function resetSearchSuggestions() {
  return;
}

function setSearchPanelCollapsed(collapsed) {
  if (els.customerSearchPanel) {
    els.customerSearchPanel.classList.toggle("is-collapsed", Boolean(collapsed));
  }
  if (els.searchPanelContent) {
    els.searchPanelContent.hidden = Boolean(collapsed);
  }
  if (els.expandSearchPanelBtn) {
    els.expandSearchPanelBtn.hidden = !collapsed;
  }
}

function focusPrimarySearchField() {
  els.customerNameQuery?.focus();
}

function resetBranchSelector() {
  currentCustomerCode = null;
  currentBranchCode = "";
  currentAvailableBranches = [];
  if (els.branchSelectorPanel) els.branchSelectorPanel.hidden = true;
  if (els.branchSelectorSearch) {
    els.branchSelectorSearch.value = "";
    els.branchSelectorSearch.disabled = true;
  }
  if (els.branchSelector) {
    els.branchSelector.innerHTML = `<option value="">Όλα τα υποκαταστήματα</option>`;
    els.branchSelector.value = "";
  }
}

function getBranchOptionLabel(branch) {
  const code = branch?.branch_code || "";
  const description = branch?.branch_description || "";
  return [code, description].filter(Boolean).join(" | ") || "Χωρίς στοιχεία υποκαταστήματος";
}

function renderFilteredBranchOptions(branches, selectedBranchCode = "") {
  const items = Array.isArray(branches) ? branches : [];
  if (!els.branchSelector) return;

  els.branchSelector.innerHTML = [
    `<option value="">Όλα τα υποκαταστήματα</option>`,
    ...items.map((branch) => {
      const code = branch.branch_code || "";
      return `<option value="${escapeHtml(code)}">${escapeHtml(getBranchOptionLabel(branch))}</option>`;
    }),
  ].join("");

  const desiredValue = selectedBranchCode || "";
  const hasDesiredOption = desiredValue === "" || items.some((branch) => (branch.branch_code || "") === desiredValue);
  els.branchSelector.value = hasDesiredOption ? desiredValue : "";
}

function filterBranches(term, selectedBranchCode = currentBranchCode) {
  const normalizedTerm = String(term || "").trim().toLocaleLowerCase("el-GR");
  if (!normalizedTerm) {
    renderFilteredBranchOptions(currentAvailableBranches, selectedBranchCode);
    return currentAvailableBranches;
  }

  const filtered = currentAvailableBranches.filter((branch) => {
    const code = String(branch.branch_code || "").toLocaleLowerCase("el-GR");
    const description = String(branch.branch_description || "").toLocaleLowerCase("el-GR");
    return code.includes(normalizedTerm) || description.includes(normalizedTerm);
  });

  renderFilteredBranchOptions(filtered, selectedBranchCode);
  return filtered;
}

function getCustomerSearchFilters() {
  return {
    customer_name: (els.customerNameQuery?.value || "").trim(),
    customer_code: (els.customerCodeQuery?.value || "").trim(),
    branch_code: (els.branchCodeQuery?.value || "").trim(),
    branch_description: (els.branchDescriptionQuery?.value || "").trim(),
  };
}

function hasCustomerSearchFilters(filters) {
  return Object.values(filters).some((value) => Boolean(value));
}

function buildCustomerSearchParams(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function fillSearchFieldsFromItem(item) {
  if (els.customerNameQuery) els.customerNameQuery.value = item?.name || "";
  if (els.customerCodeQuery) els.customerCodeQuery.value = item?.code || "";
  if (els.branchCodeQuery) els.branchCodeQuery.value = item?.branch_code || "";
  if (els.branchDescriptionQuery) els.branchDescriptionQuery.value = item?.branch_description || "";
}

function setCurrentCustomerSearchFilters(filters = {}) {
  currentCustomerSearchFilters = {
    customer_name: String(filters.customer_name || "").trim(),
    customer_code: String(filters.customer_code || "").trim(),
    branch_code: String(filters.branch_code || "").trim(),
    branch_description: String(filters.branch_description || "").trim(),
  };
}

async function performCustomerSearch(filters, options = {}) {
  const {
    limit = 20,
    renderTable = true,
    silent = false,
  } = options;

  if (!hasCustomerSearchFilters(filters)) {
    if (renderTable) resetSearchResults();
    return { items: [], total: 0, filters };
  }

  const params = buildCustomerSearchParams(filters);
  params.set("limit", String(limit));
  const payload = await apiFetch(`/api/admin/customers/search?${params.toString()}`, { method: "GET" });

  if (renderTable) renderSearchResults(payload.items, payload.filters);
  if (!silent) {
    setStatus(`Βρέθηκαν ${payload.total} αποτέλεσμα(τα).`, "ok");
  }
  return payload;
}

function resetMonthlySales() {
  const currentYear = new Date().getUTCFullYear();
  if (els.monthlyYearOneHeading) els.monthlyYearOneHeading.textContent = String(currentYear - 2);
  if (els.monthlyYearTwoHeading) els.monthlyYearTwoHeading.textContent = String(currentYear - 1);
  if (els.monthlyYearThreeHeading) els.monthlyYearThreeHeading.textContent = String(currentYear);
  if (els.monthlySalesBody) {
    els.monthlySalesBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν έχουν φορτωθεί ακόμη οι μηνιαίες πωλήσεις.</td>
      </tr>
    `;
  }
  if (els.monthlySalesFoot) {
    els.monthlySalesFoot.innerHTML = `
      <tr>
        <td>Σύνολο</td>
        <td class="admin-table-number">-</td>
        <td class="admin-table-number">-</td>
        <td class="admin-table-number">-</td>
        <td class="admin-table-number admin-monthly-total-cell">-</td>
      </tr>
    `;
  }
}

function resetReceivables() {
  if (els.receivablesPanel) els.receivablesPanel.hidden = false;
  if (els.receivablesOpenValue) els.receivablesOpenValue.textContent = "-";
  if (els.receivablesBody) {
    els.receivablesBody.innerHTML = `
      <tr>
        <td colspan="6" class="admin-table-empty">\u0394\u03b5\u03bd \u03ad\u03c7\u03b5\u03b9 \u03c6\u03bf\u03c1\u03c4\u03c9\u03b8\u03b5\u03af \u03b1\u03ba\u03cc\u03bc\u03b7 snapshot \u03c5\u03c0\u03bf\u03bb\u03bf\u03af\u03c0\u03c9\u03bd.</td>
      </tr>
    `;
  }
}

function resetStats() {
  void setStatsLoading(false);
  lastRenderedStatsPayload = null;
  resetBranchSelector();
  currentSalesTimeRange = getSelectedSalesTimeRange();
  els.customerNameHeading.textContent = "Πελάτης";
  els.customerMeta.textContent = "-";
  if (els.totalOrdersValue) els.totalOrdersValue.textContent = "0";
  els.totalPiecesValue.textContent = "0";
  els.totalRevenueValue.textContent = "-";
  if (els.activeDocumentsValue) els.activeDocumentsValue.textContent = "0";
  els.averageOrderValue.textContent = "-";
  if (els.daysSinceLastOrderValue) els.daysSinceLastOrderValue.textContent = "-";
  els.averageDaysBetweenOrdersValue.textContent = "-";
  els.acceptedOrdersValue.textContent = "-";
  els.inProgressOrdersValue.textContent = "-";
  els.invoicedOrdersValue.textContent = "-";
  if (els.lastOrderDateValue) els.lastOrderDateValue.textContent = "-";
  resetMonthlySales();
  resetReceivables();
  resetProductSales();
  resetProductTableFilters();
  currentTopProductsByQty = [];
  currentTopProductsByValue = [];
  if (els.topProductsQtyBody) {
    els.topProductsQtyBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  if (els.topProductsValueBody) {
    els.topProductsValueBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  const recentOrdersHeadRow = document.querySelector(".admin-recent-orders-table thead tr");
  if (recentOrdersHeadRow) {
    recentOrdersHeadRow.innerHTML = `
      <th><button type="button" class="admin-sort-btn" data-table-sort="recent" data-sort-key="order_id">ID <span class="admin-sort-indicator">↕</span></button></th>
      <th><button type="button" class="admin-sort-btn" data-table-sort="recent" data-sort-key="ordered_at">Ημερομηνία παραγγελίας <span class="admin-sort-indicator">↕</span></button></th>
      <th><button type="button" class="admin-sort-btn" data-table-sort="recent" data-sort-key="created_at">Ημερομηνία τιμολογίου <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="total_lines">Γραμμές <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="total_pieces">Τεμάχια <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="total_net_value">Αξία <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="average_discount_pct">Μέση έκπτωση <span class="admin-sort-indicator">↕</span></button></th>
      <th>Ενέργεια</th>
    `;
  }
  els.recentOrdersBody.innerHTML = `
    <tr>
      <td colspan="8" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  currentRecentOrdersPage = 1;
  currentOpenOrdersPage = 1;
  currentPreApprovalOrdersPage = 1;
  if (els.recentOrdersPagination) els.recentOrdersPagination.hidden = true;
  if (els.recentOrdersPageInfo) els.recentOrdersPageInfo.textContent = "Σελίδα 1 από 1";
  if (els.openOrdersBody) {
    els.openOrdersBody.innerHTML = `
      <tr>
        <td colspan="7" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  if (els.openOrdersPagination) els.openOrdersPagination.hidden = true;
  if (els.openOrdersPageInfo) els.openOrdersPageInfo.textContent = "Σελίδα 1 από 1";
  if (els.preApprovalOrdersBody) {
    els.preApprovalOrdersBody.innerHTML = `
      <tr>
        <td colspan="7" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  if (els.preApprovalOrdersPagination) els.preApprovalOrdersPagination.hidden = true;
  if (els.preApprovalOrdersPageInfo) els.preApprovalOrdersPageInfo.textContent = "Σελίδα 1 από 1";
  if (els.openRankedOrderFormBtn) els.openRankedOrderFormBtn.disabled = true;
  currentDetailedOrders = [];
  currentDetailedOpenOrders = [];
  currentDetailedPreApprovalOrders = [];
  currentOpenOrders = [];
  currentPreApprovalOrders = [];
  recentOrdersSort = { key: "created_at", direction: "desc" };
  productSalesSort = { key: "primary_metric", direction: "desc" };
  openOrdersSort = { key: "created_at", direction: "desc" };
  preApprovalOrdersSort = { key: "created_at", direction: "desc" };
  updateSortIndicators("recent", recentOrdersSort);
  updateSortIndicators("product-sales", productSalesSort);
  updateSortIndicators("open", openOrdersSort);
  updateSortIndicators("pre-approval", preApprovalOrdersSort);
  selectedOrderId = null;
  els.detailedOrdersList.innerHTML = `
    <article class="admin-order-card admin-order-empty">
      Επιλέξτε παραγγελία για να δείτε την αναλυτική ανάλυση.
    </article>
  `;
  els.emptyState.hidden = false;
  els.statsPanel.hidden = true;
}

function renderBranchSelector(customerCode, branches = [], selectedBranchCode = "") {
  currentCustomerCode = customerCode || null;
  currentBranchCode = selectedBranchCode || "";
  const isStatsLoading = els.statsPanel?.getAttribute("aria-busy") === "true";

  if (!els.branchSelectorPanel || !els.branchSelector) return;

  const items = Array.isArray(branches) ? branches : [];
  currentAvailableBranches = items;
  if (!customerCode || items.length <= 1) {
    els.branchSelectorPanel.hidden = true;
    if (els.branchSelectorSearch) {
      els.branchSelectorSearch.value = "";
      els.branchSelectorSearch.disabled = true;
    }
    renderFilteredBranchOptions([], "");
    return;
  }

  els.branchSelectorPanel.hidden = false;
  if (els.branchSelectorSearch) {
    els.branchSelectorSearch.disabled = isStatsLoading ? true : false;
    els.branchSelectorSearch.value = "";
  }
  renderFilteredBranchOptions(items, selectedBranchCode);
  els.branchSelector.disabled = isStatsLoading;
}

function formatAggregationLevelLabel(level) {
  if (level === "branch") return "Υποκατάστημα";
  if (level === "customer") return "Πελάτης";
  return level || "";
}

function renderSearchResults(items, filters = {}) {
  currentSearchResults = Array.isArray(items) ? items : [];
  if (els.searchResultsPanel) els.searchResultsPanel.hidden = false;
  if (!els.searchResultsBody) return;
  const isStatsLoading = els.statsPanel?.getAttribute("aria-busy") === "true";

  const activeFilters = Object.values(filters || {}).filter(Boolean).join(" | ");

  els.searchResultsBody.innerHTML = currentSearchResults.length
    ? currentSearchResults
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.branch_code || "-")}</td>
              <td>${escapeHtml(item.branch_description || "-")}</td>
              <td>
                <button
                  type="button"
                  class="btn ghost admin-result-select"
                  data-customer-code="${escapeHtml(item.code)}"
                  ${isStatsLoading ? "disabled" : ""}
                >
                  Επιλογή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν πελάτες${activeFilters ? ` για "${escapeHtml(activeFilters)}"` : ""}.</td>
        </tr>
      `;
}

function renderSelectedOrderDetails() {
  const selectedOrder = findDetailedOrder(selectedOrderId);
  if (!selectedOrder) {
    els.detailedOrdersList.innerHTML = `
      <article class="admin-order-card admin-order-empty">
        Επιλέξτε παραγγελία για να δείτε την αναλυτική ανάλυση.
      </article>
    `;
    return;
  }

  const linesHtml = Array.isArray(selectedOrder.lines) && selectedOrder.lines.length
    ? selectedOrder.lines
        .map((line) => {
          return `
            <tr>
              <td>${escapeHtml(line.code)}</td>
              <td>${escapeHtml(line.description)}</td>
              <td>${escapeHtml(formatNumber(line.qty))}</td>
              <td>${escapeHtml(formatMoney(line.unit_price))}</td>
              <td>${escapeHtml(formatPercentRoundedUp(line.discount_pct))}</td>
              <td>${escapeHtml(formatMoney(line.line_net_value))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="6" class="admin-table-empty">Η παραγγελία δεν έχει γραμμές ειδών.</td>
        </tr>
      `;

  els.detailedOrdersList.innerHTML = `
    <article class="admin-order-card admin-order-card-active">
      <div class="admin-order-head">
        <div>
          <h3>Παραγγελία #${escapeHtml(formatDisplayOrderId(selectedOrder.order_id))}</h3>
          <p>Παραγγελία: ${escapeHtml(formatDate(selectedOrder.ordered_at || selectedOrder.created_at))}</p>
        </div>
        <div class="admin-order-kpis">
          <div class="admin-order-kpi-meta">
            <span>${escapeHtml(formatNumber(selectedOrder.total_lines))} γραμμές</span>
            <span>${escapeHtml(formatNumber(selectedOrder.total_pieces))} τεμ.</span>
          </div>
          <strong>${escapeHtml(formatMoney(selectedOrder.total_net_value))}</strong>
          <a
            href="index.html"
            class="btn ghost admin-order-open-link"
            data-open-order-form="${escapeHtml(selectedOrder.order_id)}"
          >
            Άνοιγμα στη φόρμα παραγγελίας
          </a>
        </div>
      </div>
      <div class="admin-order-note">${escapeHtml(selectedOrder.notes || "Χωρίς σημειώσεις")}</div>
      <div class="admin-order-meta">
        <span>Τιμολόγηση: ${escapeHtml(formatDate(selectedOrder.created_at))}</span>
        <span>Μέση έκπτωση: ${escapeHtml(formatPercentRoundedUp(selectedOrder.average_discount_pct))}</span>
      </div>
      <div class="admin-table-wrap admin-order-table-wrap">
        <table class="admin-table admin-order-table">
          <thead>
            <tr>
              <th>Κωδικός</th>
              <th>Περιγραφή</th>
              <th>Τεμάχια</th>
              <th>Τιμή μονάδας</th>
              <th>Έκπτωση</th>
              <th>Καθαρή αξία</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>
      </div>
    </article>
  `;
}

function openRankedOrderForm() {
  const customer = lastRenderedStatsPayload?.customer || {};
  const rankedCodes = getSortedProductSales()
    .map((item) => String(item?.code || "").trim())
    .filter(Boolean);

  if (!currentCustomerCode || !rankedCodes.length) {
    setStatus("Δεν υπάρχουν αρκετά στοιχεία για κατάταξη ειδών πελάτη.", "error");
    return;
  }

  const draft = {
    customerName: customer.name || "",
    customerEmail: customer.email || "",
    customerCode: currentCustomerCode,
    branchCode: currentBranchCode || "",
    rankedCodes,
    salesTimeRange: currentSalesTimeRange,
  };

  try {
    window.sessionStorage.setItem(ORDER_FORM_RANKING_KEY, JSON.stringify(draft));
  } catch (_error) {
    setStatus("Δεν ήταν δυνατή η αποθήκευση της κατάταξης για τη φόρμα παραγγελίας.", "error");
    return;
  }

  window.location.href = "index.html";
}

function getSortedProductSales() {
  const metric = els.productSalesMetric?.value === "pieces" ? "pieces" : "revenue";
  return [...currentProductSales].sort((a, b) => {
    if (metric === "pieces") {
      return Number(b.pieces || 0) - Number(a.pieces || 0) || Number(b.revenue || 0) - Number(a.revenue || 0);
    }
    return Number(b.revenue || 0) - Number(a.revenue || 0) || Number(b.pieces || 0) - Number(a.pieces || 0);
  });
}

function getSortedProductSalesForTable() {
  const metric = els.productSalesMetric?.value === "pieces" ? "pieces" : "revenue";
  const primaryMetricField = metric === "pieces" ? "pieces" : "revenue";
  const secondaryMetricField = metric === "pieces" ? "revenue" : "pieces";
  const sortState = productSalesSort;
  return [...currentProductSales].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;

    if (key === "code" || key === "description") {
      compare = compareSortableValues(a?.[key], b?.[key], {
        direction: sortState.direction,
      });
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

function normalizeFilterValue(value) {
  return String(value ?? "").trim().toLocaleLowerCase("el-GR");
}

function matchesProductTableFilters(item, filters = {}) {
  const codeFilter = normalizeFilterValue(filters.code);
  const descriptionFilter = normalizeFilterValue(filters.description);
  const code = normalizeFilterValue(item?.code);
  const description = normalizeFilterValue(item?.description);

  if (codeFilter && !code.includes(codeFilter)) return false;
  if (descriptionFilter && !description.includes(descriptionFilter)) return false;
  return true;
}

function filterProductItems(items, filters = {}) {
  return (Array.isArray(items) ? items : []).filter((item) => matchesProductTableFilters(item, filters));
}

function syncProductTableFilterInputs() {
  if (els.productSalesCodeFilter) els.productSalesCodeFilter.value = currentProductSalesFilters.code;
  if (els.productSalesDescriptionFilter) els.productSalesDescriptionFilter.value = currentProductSalesFilters.description;
}

function resetProductTableFilters() {
  currentProductSalesFilters = { code: "", description: "" };
  syncProductTableFilterInputs();
}

function renderMonthlySales(monthlySales) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const yearlySeries = Array.isArray(monthlySales?.yearly_series) && monthlySales.yearly_series.length
    ? monthlySales.yearly_series
    : [
        { year: currentYear - 2, months: [] },
        { year: currentYear - 1, months: monthlySales?.previous_year || [] },
        { year: currentYear, months: monthlySales?.current_year || [] },
      ];
  const displaySeries = [...yearlySeries]
    .sort((a, b) => Number(a.year || 0) - Number(b.year || 0))
    .slice(-3);
  const rows = [];
  const yearlyTotals = displaySeries.map(() => 0);

  for (let month = 1; month <= 12; month += 1) {
    const revenues = displaySeries.map((entry, index) => {
      const row = (Array.isArray(entry.months) ? entry.months : []).find(
        (candidate) => Number(candidate.month) === month,
      ) || {};
      const revenue = Number(row.revenue || 0);
      yearlyTotals[index] += revenue;
      return revenue;
    });
    const totalRevenue = revenues.reduce((sum, value) => sum + value, 0);
    const revenueCells = revenues
      .map(
        (revenue) =>
          `<td class="admin-table-number${numberStateClass(revenue)}">${escapeHtml(formatMoney(revenue))}</td>`,
      )
      .join("");

    rows.push(`
      <tr>
        <td>${MONTH_LABELS[month - 1]}</td>
        ${revenueCells}
        <td class="admin-table-number admin-monthly-total-cell${numberStateClass(totalRevenue)}">${escapeHtml(formatMoney(totalRevenue))}</td>
      </tr>
    `);
  }

  if (els.monthlyYearOneHeading) els.monthlyYearOneHeading.textContent = String(displaySeries[0]?.year || currentYear - 2);
  if (els.monthlyYearTwoHeading) els.monthlyYearTwoHeading.textContent = String(displaySeries[1]?.year || currentYear - 1);
  if (els.monthlyYearThreeHeading) els.monthlyYearThreeHeading.textContent = String(displaySeries[2]?.year || currentYear);
  els.monthlySalesBody.innerHTML = rows.join("");
  if (els.monthlySalesFoot) {
    const totalCells = yearlyTotals
      .map(
        (value) =>
          `<td class="admin-table-number${numberStateClass(value)}">${escapeHtml(formatMoney(value))}</td>`,
      )
      .join("");
    const grandTotal = yearlyTotals.reduce((sum, value) => sum + value, 0);
    els.monthlySalesFoot.innerHTML = `
      <tr>
        <td>Total</td>
        ${totalCells}
        <td class="admin-table-number admin-monthly-total-cell${numberStateClass(grandTotal)}">${escapeHtml(formatMoney(grandTotal))}</td>
      </tr>
    `;
  }
}

function renderReceivablesTable() {
  const receivablesHeadRow = document.querySelector("#receivablesPanel thead tr");
  if (receivablesHeadRow) {
    receivablesHeadRow.innerHTML = `
      <th>Ημερομηνία</th>
      <th>Παραστατικό</th>
      <th>Αιτιολογία</th>
      <th class="admin-table-number">Χρέωση</th>
      <th class="admin-table-number">Πίστωση</th>
    `;
  }
  const totalPages = Math.max(1, Math.ceil(currentReceivables.length / RECEIVABLES_PAGE_SIZE));
  currentReceivablesPage = Math.min(currentReceivablesPage, totalPages);
  const start = (currentReceivablesPage - 1) * RECEIVABLES_PAGE_SIZE;
  const pageItems = currentReceivables.slice(start, start + RECEIVABLES_PAGE_SIZE);

  els.receivablesBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(formatDate(item.document_date))}</td>
              <td>${escapeHtml(item.document_no)}</td>
              <td>${escapeHtml(item.reason || "-")}</td>
              <td>${escapeHtml(formatMoney(item.debit))}</td>
              <td>${escapeHtml(formatMoney(item.credit))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03bf\u03c5\u03bd \u03ba\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2 \u03ba\u03b1\u03c1\u03c4\u03ad\u03bb\u03b1\u03c2 \u03b3\u03b9\u03b1 \u03b1\u03c5\u03c4\u03cc\u03bd \u03c4\u03bf\u03bd \u03c0\u03b5\u03bb\u03ac\u03c4\u03b7.</td>
        </tr>
      `;

  if (els.receivablesPagination) {
    els.receivablesPagination.hidden = !currentReceivables.length;
  }
  if (els.receivablesPageInfo) {
    els.receivablesPageInfo.textContent = currentReceivables.length
      ? `\u03a3\u03b5\u03bb\u03af\u03b4\u03b1 ${currentReceivablesPage} \u03b1\u03c0\u03cc ${totalPages}`
      : "\u03a3\u03b5\u03bb\u03af\u03b4\u03b1 1 \u03b1\u03c0\u03cc 1";
  }
  if (els.receivablesPrevBtn) {
    els.receivablesPrevBtn.disabled = currentReceivablesPage <= 1;
  }
  if (els.receivablesNextBtn) {
    els.receivablesNextBtn.disabled = currentReceivablesPage >= totalPages;
  }
}

function renderReceivables(receivables) {
  currentReceivables = Array.isArray(receivables?.items) ? receivables.items : [];
  currentReceivablesPage = 1;
  els.receivablesOpenValue.textContent = formatMoney(receivables?.open_balance);
  renderReceivablesTable();
}
function renderProductSales() {
  const metric = els.productSalesMetric?.value === "pieces" ? "pieces" : "revenue";
  const secondaryMetric = metric === "pieces" ? "revenue" : "pieces";
  const sortedItems = filterProductItems(getSortedProductSalesForTable(), currentProductSalesFilters);

  if (els.productSalesMetricHeading) {
    els.productSalesMetricHeading.textContent = metric === "pieces" ? "Τεμάχια" : "Τζίρος";
  }
  if (els.productSalesSecondaryMetricHeading) {
    els.productSalesSecondaryMetricHeading.textContent = secondaryMetric === "pieces" ? "Τεμάχια" : "Τζίρος";
  }

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PRODUCT_SALES_PAGE_SIZE));
  currentProductSalesPage = Math.min(currentProductSalesPage, totalPages);
  const start = (currentProductSalesPage - 1) * PRODUCT_SALES_PAGE_SIZE;
  const pageItems = sortedItems.slice(start, start + PRODUCT_SALES_PAGE_SIZE);

  els.productSalesBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const metricValue = metric === "pieces" ? formatNumber(item.pieces) : formatMoney(item.revenue);
          const secondaryMetricValue =
            secondaryMetric === "pieces" ? formatNumber(item.pieces) : formatMoney(item.revenue);
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(metricValue)}</td>
              <td class="admin-table-number">${escapeHtml(secondaryMetricValue)}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.orders))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.avg_unit_price))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="6" class="admin-table-empty">Δεν υπάρχουν διαθέσιμες πωλήσεις ειδών για την τρέχουσα επιλογή.</td>
        </tr>
      `;

  if (els.productSalesPagination) {
    els.productSalesPagination.hidden = !sortedItems.length;
  }
  if (els.productSalesPageInfo) {
    els.productSalesPageInfo.textContent = sortedItems.length
      ? `Σελίδα ${currentProductSalesPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (els.productSalesPrevBtn) {
    els.productSalesPrevBtn.disabled = currentProductSalesPage <= 1;
  }
  if (els.productSalesNextBtn) {
    els.productSalesNextBtn.disabled = currentProductSalesPage >= totalPages;
  }
  updateSortIndicators("product-sales", productSalesSort);
}

function renderTopProductsQty() {
  if (!els.topProductsQtyBody) return;
  const filteredItems = currentTopProductsByQty;
  els.topProductsQtyBody.innerHTML = filteredItems.length
    ? filteredItems
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.qty))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.orders))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.revenue))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν κορυφαία είδη ανά τεμάχια.</td>
        </tr>
      `;
}

function renderTopProductsValue() {
  if (!els.topProductsValueBody) return;
  const filteredItems = currentTopProductsByValue;
  els.topProductsValueBody.innerHTML = filteredItems.length
    ? filteredItems
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.revenue))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.qty))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.avg_unit_price))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν κορυφαία είδη ανά τζίρο.</td>
        </tr>
      `;
}

function getRecentOrdersForTable() {
  const sortState = recentOrdersSort;
  return [...currentDetailedOrders].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;

    if (key === "ordered_at" || key === "created_at") {
      compare = compareSortableValues(a?.[key], b?.[key], {
        direction: sortState.direction,
        date: true,
      });
    } else if (key === "order_id") {
      compare = compareSortableValues(a?.order_id, b?.order_id, {
        direction: sortState.direction,
      });
    } else {
      compare = compareSortableValues(a?.[key], b?.[key], {
        direction: sortState.direction,
        numeric: true,
      });
    }

    if (compare !== 0) return compare;
    return compareSortableValues(a?.created_at, b?.created_at, { direction: "desc", date: true });
  });
}

function renderRecentOrdersTable() {
  const recentOrders = getRecentOrdersForTable();
  const totalPages = Math.max(1, Math.ceil(recentOrders.length / RECENT_ORDERS_PAGE_SIZE));
  currentRecentOrdersPage = Math.min(currentRecentOrdersPage, totalPages);
  const start = (currentRecentOrdersPage - 1) * RECENT_ORDERS_PAGE_SIZE;
  const pageItems = recentOrders.slice(start, start + RECENT_ORDERS_PAGE_SIZE);

  els.recentOrdersBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const isActive = String(selectedOrderId || "") === String(item.order_id || "");
          return `
            <tr>
              <td>${escapeHtml(formatDisplayOrderId(item.order_id))}</td>
              <td>${escapeHtml(formatDate(item.ordered_at || item.created_at))}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_lines))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td class="admin-table-number">${escapeHtml(formatPercentRoundedUp(item.average_discount_pct))}</td>
              <td class="admin-table-action">
                <button
                  type="button"
                  class="btn ghost admin-order-select${isActive ? " is-active" : ""}"
                  data-order-id="${escapeHtml(item.order_id)}"
                >
                  Προβολή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="8" class="admin-table-empty">Δεν βρέθηκαν πρόσφατες εκτελεσμένες παραγγελίες.</td>
        </tr>
      `;

  if (els.recentOrdersPagination) {
    els.recentOrdersPagination.hidden = !recentOrders.length;
  }
  if (els.recentOrdersPageInfo) {
    els.recentOrdersPageInfo.textContent = recentOrders.length
      ? `Σελίδα ${currentRecentOrdersPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (els.recentOrdersPrevBtn) {
    els.recentOrdersPrevBtn.disabled = currentRecentOrdersPage <= 1;
  }
  if (els.recentOrdersNextBtn) {
    els.recentOrdersNextBtn.disabled = currentRecentOrdersPage >= totalPages;
  }
  updateSortIndicators("recent", recentOrdersSort);
}

function getOpenOrdersForTable() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OPEN_ORDERS_TIME_RANGE_DAYS * 86400000);
  const filtered = currentOpenOrders.filter((order) => {
    const date = parseIsoDate(order?.created_at);
    return date ? date >= cutoff : false;
  });
  const sortState = openOrdersSort;
  return [...filtered].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;
    if (key === "created_at") {
      compare = compareSortableValues(a?.created_at, b?.created_at, {
        direction: sortState.direction,
        date: true,
      });
    } else if (["total_lines", "total_pieces", "total_net_value", "average_discount_pct"].includes(key)) {
      compare = compareSortableValues(a?.[key], b?.[key], {
        direction: sortState.direction,
        numeric: true,
      });
    } else {
      compare = compareSortableValues(a?.order_id, b?.order_id, {
        direction: sortState.direction,
      });
    }
    if (compare !== 0) return compare;
    return String(b?.order_id || "").localeCompare(String(a?.order_id || ""));
  });
}

function getPreApprovalOrdersForTable() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - PRE_APPROVAL_TIME_RANGE_DAYS * 86400000);
  const filtered = currentPreApprovalOrders.filter((order) => {
    const date = parseIsoDate(order?.created_at);
    return date ? date >= cutoff : false;
  });
  const sortState = preApprovalOrdersSort;
  return [...filtered].sort((a, b) => {
    const key = sortState.key;
    let compare = 0;
    if (key === "created_at") {
      compare = compareSortableValues(a?.created_at, b?.created_at, {
        direction: sortState.direction,
        date: true,
      });
    } else if (["total_lines", "total_pieces", "total_net_value", "average_discount_pct"].includes(key)) {
      compare = compareSortableValues(a?.[key], b?.[key], {
        direction: sortState.direction,
        numeric: true,
      });
    } else {
      compare = compareSortableValues(a?.order_id, b?.order_id, {
        direction: sortState.direction,
      });
    }
    if (compare !== 0) return compare;
    return String(b?.order_id || "").localeCompare(String(a?.order_id || ""));
  });
}

function renderPreApprovalOrdersTable() {
  const preApprovalOrders = getPreApprovalOrdersForTable();
  const totalPages = Math.max(1, Math.ceil(preApprovalOrders.length / PRE_APPROVAL_ORDERS_PAGE_SIZE));
  currentPreApprovalOrdersPage = Math.min(currentPreApprovalOrdersPage, totalPages);
  const start = (currentPreApprovalOrdersPage - 1) * PRE_APPROVAL_ORDERS_PAGE_SIZE;
  const pageItems = preApprovalOrders.slice(start, start + PRE_APPROVAL_ORDERS_PAGE_SIZE);

  els.preApprovalOrdersBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const isActive = String(selectedOrderId || "") === String(item.order_id || "");
          return `
            <tr>
              <td>${escapeHtml(formatDisplayOrderId(item.order_id))}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_lines))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td class="admin-table-number">${escapeHtml(formatPercentRoundedUp(item.average_discount_pct))}</td>
              <td class="admin-table-action">
                <button
                  type="button"
                  class="btn ghost admin-order-select${isActive ? " is-active" : ""}"
                  data-order-id="${escapeHtml(item.order_id)}"
                >
                  Προβολή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="7" class="admin-table-empty">Δεν βρέθηκαν παραγγελίες προς έγκριση.</td>
        </tr>
      `;
  updateSortIndicators("pre-approval", preApprovalOrdersSort);

  if (els.preApprovalOrdersPagination) {
    els.preApprovalOrdersPagination.hidden = !preApprovalOrders.length;
  }
  if (els.preApprovalOrdersPageInfo) {
    els.preApprovalOrdersPageInfo.textContent = preApprovalOrders.length
      ? `Σελίδα ${currentPreApprovalOrdersPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (els.preApprovalOrdersPrevBtn) {
    els.preApprovalOrdersPrevBtn.disabled = currentPreApprovalOrdersPage <= 1;
  }
  if (els.preApprovalOrdersNextBtn) {
    els.preApprovalOrdersNextBtn.disabled = currentPreApprovalOrdersPage >= totalPages;
  }
}

function renderOpenOrdersTable() {
  const openOrders = getOpenOrdersForTable();
  const totalPages = Math.max(1, Math.ceil(openOrders.length / OPEN_ORDERS_PAGE_SIZE));
  currentOpenOrdersPage = Math.min(currentOpenOrdersPage, totalPages);
  const start = (currentOpenOrdersPage - 1) * OPEN_ORDERS_PAGE_SIZE;
  const pageItems = openOrders.slice(start, start + OPEN_ORDERS_PAGE_SIZE);

  els.openOrdersBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const isActive = String(selectedOrderId || "") === String(item.order_id || "");
          return `
            <tr>
              <td>${escapeHtml(formatDisplayOrderId(item.order_id))}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_lines))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td class="admin-table-number">${escapeHtml(formatPercentRoundedUp(item.average_discount_pct))}</td>
              <td class="admin-table-action">
                <button
                  type="button"
                  class="btn ghost admin-order-select${isActive ? " is-active" : ""}"
                  data-order-id="${escapeHtml(item.order_id)}"
                >
                  Προβολή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="7" class="admin-table-empty">Δεν βρέθηκαν παραγγελίες προς εκτέλεση.</td>
        </tr>
      `;
  updateSortIndicators("open", openOrdersSort);

  if (els.openOrdersPagination) {
    els.openOrdersPagination.hidden = !openOrders.length;
  }
  if (els.openOrdersPageInfo) {
    els.openOrdersPageInfo.textContent = openOrders.length
      ? `Σελίδα ${currentOpenOrdersPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (els.openOrdersPrevBtn) {
    els.openOrdersPrevBtn.disabled = currentOpenOrdersPage <= 1;
  }
  if (els.openOrdersNextBtn) {
    els.openOrdersNextBtn.disabled = currentOpenOrdersPage >= totalPages;
  }
}

function renderStats(data) {
  const customer = data?.customer || {};
  const summary = data?.summary || {};
  const monthlySales = data?.monthly_sales || {};
  const productSales = data?.product_sales || {};
  const receivables = data?.receivables || {};
  const availableBranches = Array.isArray(data?.available_branches) ? data.available_branches : [];
  const topProductsByQty = Array.isArray(data?.top_products_by_qty) ? data.top_products_by_qty : [];
  const topProductsByValue = Array.isArray(data?.top_products_by_value) ? data.top_products_by_value : [];
  const openOrders = Array.isArray(data?.open_orders) ? data.open_orders : [];
  const preApprovalOrders = Array.isArray(data?.pre_approval_orders) ? data.pre_approval_orders : [];
  const detailedOrders = Array.isArray(data?.detailed_orders) ? data.detailed_orders : [];
  const detailedOpenOrders = Array.isArray(data?.detailed_open_orders) ? data.detailed_open_orders : [];
  const detailedPreApprovalOrders = Array.isArray(data?.detailed_pre_approval_orders)
    ? data.detailed_pre_approval_orders
    : [];
  const isBranchView = customer.aggregation_level === "branch";
  lastRenderedStatsPayload = data;

  currentDetailedOrders = detailedOrders;
  currentDetailedOpenOrders = detailedOpenOrders;
  currentDetailedPreApprovalOrders = detailedPreApprovalOrders;
  currentOpenOrders = openOrders;
  currentPreApprovalOrders = preApprovalOrders;
  currentProductSales = Array.isArray(productSales.items) ? productSales.items : [];
  currentTopProductsByQty = topProductsByQty;
  currentTopProductsByValue = topProductsByValue;
  if (els.openRankedOrderFormBtn) {
    els.openRankedOrderFormBtn.disabled = currentProductSales.length === 0;
  }
  selectedOrderId = null;
  currentProductSalesPage = 1;
  currentRecentOrdersPage = 1;
  currentOpenOrdersPage = 1;
  currentPreApprovalOrdersPage = 1;
  resetProductTableFilters();

  const metaParts = [customer.code, customer.email];
  if (customer.branch_code) {
    metaParts.push(`Υποκατάστημα: ${customer.branch_code}`);
  }
  if (customer.branch_description) {
    metaParts.push(customer.branch_description);
  }
  if (customer.aggregation_level) {
    metaParts.push(`Επίπεδο: ${formatAggregationLevelLabel(customer.aggregation_level)}`);
  }
  if (customer.chain_name) {
    metaParts.push(`Αλυσίδα: ${customer.chain_name}`);
  }

  els.customerNameHeading.textContent = customer.name || "Άγνωστος πελάτης";
  els.customerMeta.textContent = metaParts.filter(Boolean).join(" | ") || "-";
  if (els.totalOrdersValue) {
    els.totalOrdersValue.textContent = formatNumber(summary.total_orders ?? 0);
  }
  els.totalPiecesValue.textContent = formatNumber(summary.total_pieces ?? 0);
  els.totalRevenueValue.textContent = formatMoney(summary.total_revenue);
  els.averageOrderValue.textContent = formatMoney(summary.average_order_value);
  if (els.daysSinceLastOrderValue) {
    els.daysSinceLastOrderValue.textContent = formatDays(summary.days_since_last_order);
  }
  els.averageDaysBetweenOrdersValue.textContent = formatDays(summary.average_days_between_orders);
  const preApprovalOrdersForTable = getPreApprovalOrdersForTable();
  const openOrdersForTable = getOpenOrdersForTable();
  const recentExecutedOrdersForTable = getRecentOrdersForTable();
  const preApprovalCount = preApprovalOrdersForTable.length;
  const openCount = openOrdersForTable.length;
  const recentExecutedCount = recentExecutedOrdersForTable.length;
  const activeDocumentIds = new Set(
    [...preApprovalOrdersForTable, ...openOrdersForTable]
      .map((order) => String(order?.order_id || ""))
      .filter(Boolean),
  );
  if (els.activeDocumentsValue) {
    els.activeDocumentsValue.textContent = formatNumber(activeDocumentIds.size);
  }
  els.acceptedOrdersValue.textContent = formatNumber(preApprovalCount);
  els.inProgressOrdersValue.textContent = formatNumber(openCount);
  els.invoicedOrdersValue.textContent = formatNumber(recentExecutedCount);
  if (els.lastOrderDateValue) {
    els.lastOrderDateValue.textContent = formatDate(summary.last_order_date);
  }
  renderBranchSelector(customer.code, availableBranches, customer.branch_code || "");

  renderMonthlySales(monthlySales);
  if (els.receivablesPanel) {
    els.receivablesPanel.hidden = isBranchView;
  }
  renderReceivables(receivables);
  els.productSalesMetric.value = productSales.metric === "pieces" ? "pieces" : "revenue";
  renderProductSales();
  renderTopProductsQty();
  renderTopProductsValue();
  renderPreApprovalOrdersTable();
  renderOpenOrdersTable();
  renderRecentOrdersTable();
  renderSelectedOrderDetails();
  els.emptyState.hidden = true;
  els.statsPanel.hidden = false;
  setSearchPanelCollapsed(true);
}

async function refreshSession(options = {}) {
  try {
    const me = await apiFetch("/api/admin/me", { method: "GET" });
    setAuthenticatedUI(me);
    if (me.authenticated) {
      void loadLatestImportMessage(me);
    }

    if (!me.authenticated && !options.silent) {
      setStatus("Συνδεθείτε για να δείτε την ανάλυση πελατών.", "info");
    }

    return me;
  } catch (error) {
    setAuthenticatedUI({ authenticated: false });
    if (!options.silent) {
      setStatus(`Η σύνδεση με το backend απέτυχε: ${error.message}`, "error");
    }
    return { authenticated: false };
  }
}

async function handleLogin(event) {
  event.preventDefault();
  setStatus("");

  const username = (els.username.value || "").trim();
  const password = els.password.value || "";
  if (!username || !password) {
    setStatus("Συμπληρώστε όνομα χρήστη και κωδικό.", "error");
    return;
  }

  els.loginBtn.disabled = true;

  try {
    const result = await apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    setAuthenticatedUI(result);
    void loadLatestImportMessage(result);
    resetSearchSuggestions();
    resetSearchResults();
    resetStats();
    setSearchPanelCollapsed(false);
    els.password.value = "";
    focusPrimarySearchField();
    setStatus("Η σύνδεση ολοκληρώθηκε επιτυχώς.", "ok");
  } catch (error) {
    setStatus(`Η σύνδεση απέτυχε: ${error.message}`, "error");
  } finally {
    els.loginBtn.disabled = false;
  }
}

async function handleLogout() {
  els.logoutBtn.disabled = true;

  try {
    await apiFetch("/api/admin/logout", { method: "POST" });
    setAuthenticatedUI({ authenticated: false });
    resetSearchSuggestions();
    resetSearchResults();
    resetStats();
    setSearchPanelCollapsed(false);
    els.username.focus();
    setStatus("Η αποσύνδεση ολοκληρώθηκε επιτυχώς.", "ok");
    clearAdminState();
  } catch (error) {
    setStatus(`Η αποσύνδεση απέτυχε: ${error.message}`, "error");
  } finally {
    els.logoutBtn.disabled = false;
  }
}

async function fetchCustomerStats(customerCode, branchCode = "", scopeFilters = currentCustomerSearchFilters) {
  setStatus("");

  if (!customerCode) {
    setStatus("Συμπληρώστε κωδικό πελάτη.", "error");
    els.customerCodeQuery.focus();
    return;
  }

  const requestId = ++currentStatsRequestId;
  const loadingMessage = branchCode
    ? `Φόρτωση στοιχείων για το υποκατάστημα ${branchCode}...`
    : "Φόρτωση στοιχείων πελάτη...";
  setStatsLoading(true, loadingMessage);
  setStatus(loadingMessage, "info");

  try {
    const params = new URLSearchParams();
    if (branchCode) params.set("branch_code", branchCode);
    const normalizedScopeFilters = {
      branch_code: String(scopeFilters?.branch_code || "").trim(),
      branch_description: String(scopeFilters?.branch_description || "").trim(),
    };
    if (normalizedScopeFilters.branch_code) {
      params.set("filter_branch_code", normalizedScopeFilters.branch_code);
    }
    if (normalizedScopeFilters.branch_description) {
      params.set("filter_branch_description", normalizedScopeFilters.branch_description);
    }
    const normalizedSalesTimeRange = getSelectedSalesTimeRange();
    currentSalesTimeRange = normalizedSalesTimeRange || DEFAULT_SALES_TIME_RANGE;
    syncSalesTimeRangeControls(currentSalesTimeRange);
    params.set("sales_time_range", currentSalesTimeRange);
    const payload = await apiFetch(
      `/api/admin/customers/${encodeURIComponent(customerCode)}/stats${params.toString() ? `?${params.toString()}` : ""}`,
      { method: "GET" },
    );
    if (requestId !== currentStatsRequestId) return;
    renderStats(payload);
    setCurrentCustomerSearchFilters({
      ...currentCustomerSearchFilters,
      ...scopeFilters,
      customer_code: payload?.customer?.code || customerCode,
    });
    currentCustomerCode = payload?.customer?.code || customerCode;
    currentBranchCode = payload?.customer?.branch_code || branchCode || "";
    resetSearchSuggestions();
    setStatus(
      `Φορτώθηκαν τα στοιχεία για τον πελάτη ${customerCode}${currentBranchCode ? ` / υποκατάστημα ${currentBranchCode}` : ""}.`,
      "ok",
    );
  } catch (error) {
    if (requestId !== currentStatsRequestId) return;
    resetStats();
    setStatus(`Η φόρτωση στοιχείων απέτυχε: ${error.message}`, "error");
  } finally {
    if (requestId === currentStatsRequestId) {
      await setStatsLoading(false);
    }
  }
}

async function searchCustomers(event) {
  event.preventDefault();
  setStatus("");

  const filters = getCustomerSearchFilters();
  if (!hasCustomerSearchFilters(filters)) {
    setStatus("Συμπληρώστε τουλάχιστον ένα πεδίο αναζήτησης.", "error");
    els.customerNameQuery.focus();
    return;
  }

  const requestId = ++currentSearchRequestId;
  setSearchLoading(true, "Αναζήτηση πελατών...");
  setStatus("Αναζήτηση πελατών...", "info");
  try {
    setCurrentCustomerSearchFilters(filters);
    resetSearchSuggestions();
    await performCustomerSearch(filters, {
      limit: 20,
      renderTable: true,
      renderSuggestions: false,
      silent: false,
    });
    if (requestId !== currentSearchRequestId) return;
  } catch (error) {
    if (requestId !== currentSearchRequestId) return;
    resetSearchResults();
    setStatus(`Η αναζήτηση πελατών απέτυχε: ${error.message}`, "error");
  } finally {
    if (requestId === currentSearchRequestId) {
      await setSearchLoading(false);
    }
  }
}

function clearCustomerStats() {
  if (els.customerNameQuery) els.customerNameQuery.value = "";
  if (els.customerCodeQuery) els.customerCodeQuery.value = "";
  if (els.branchCodeQuery) els.branchCodeQuery.value = "";
  if (els.branchDescriptionQuery) els.branchDescriptionQuery.value = "";
  currentSalesTimeRange = DEFAULT_SALES_TIME_RANGE;
  syncSalesTimeRangeControls(DEFAULT_SALES_TIME_RANGE);
  setCurrentCustomerSearchFilters({});
  resetSearchSuggestions();
  resetSearchResults();
  resetStats();
  setSearchPanelCollapsed(false);
  setStatus("");
  focusPrimarySearchField();
}

function handleBranchSelectionChange() {
  if (!currentCustomerCode) return;
  const branchCode = els.branchSelector?.value || "";
  if (els.branchSelectorSearch) {
    const selectedBranch = currentAvailableBranches.find((branch) => (branch.branch_code || "") === branchCode);
    els.branchSelectorSearch.value = branchCode ? getBranchOptionLabel(selectedBranch) : "";
  }
  fetchCustomerStats(currentCustomerCode, branchCode, currentCustomerSearchFilters);
}

function handleBranchSearchInput() {
  if (!currentAvailableBranches.length) return;
  filterBranches(els.branchSelectorSearch?.value || "");
}

function handleBranchSearchKeydown(event) {
  if (!currentAvailableBranches.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    els.branchSelector?.focus();
    if (els.branchSelector) {
      const nextIndex = Math.min(els.branchSelector.selectedIndex + 1, els.branchSelector.options.length - 1);
      els.branchSelector.selectedIndex = Math.max(nextIndex, 0);
    }
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const filtered = filterBranches(els.branchSelectorSearch?.value || "", "");
    const firstBranch = filtered[0];
    const branchCode = firstBranch?.branch_code || "";
    if (els.branchSelector) {
      els.branchSelector.value = branchCode;
    }
    fetchCustomerStats(currentCustomerCode, branchCode, currentCustomerSearchFilters);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    if (els.branchSelectorSearch) {
      els.branchSelectorSearch.value = "";
    }
    filterBranches("", currentBranchCode);
  }
}

function expandSearchPanel() {
  setSearchPanelCollapsed(false);
  focusPrimarySearchField();
}

function buildOrderFormDraftFromSelectedOrder(order) {
  const customerName = String(order?.customer_name || els.customerNameHeading?.textContent || "").trim();
  return {
    customerName,
    customerEmail: String(order?.customer_email || "").trim(),
    notes: String(order?.notes || "").trim(),
    sourceOrderId: String(order?.order_id || "").trim(),
    lines: Array.isArray(order?.lines)
      ? order.lines
          .filter((line) => line?.code && Number(line?.qty || 0) > 0)
          .map((line) => ({
            code: String(line.code).trim(),
            qty: Number(line.qty || 0),
            description: String(line.description || "").trim(),
          }))
      : [],
  };
}

function openSelectedOrderInOrderForm(orderId) {
  const order = findDetailedOrder(orderId);
  if (!order) {
    setStatus("Η επιλεγμένη παραγγελία δεν βρέθηκε.", "error");
    return;
  }

  const draft = buildOrderFormDraftFromSelectedOrder(order);
  if (!draft.lines.length) {
    setStatus("Η επιλεγμένη παραγγελία δεν έχει γραμμές ειδών για φόρτωση.", "error");
    return;
  }

  try {
    window.sessionStorage.setItem(ORDER_FORM_IMPORT_KEY, JSON.stringify(draft));
    window.location.href = "index.html";
  } catch (_error) {
    setStatus("Δεν ήταν δυνατή η μεταφορά της παραγγελίας στη φόρμα.", "error");
  }
}

els.loginForm?.addEventListener("submit", handleLogin);
els.logoutBtn?.addEventListener("click", handleLogout);
els.customerSearchForm?.addEventListener("submit", searchCustomers);
els.clearStatsBtn?.addEventListener("click", clearCustomerStats);
els.expandSearchPanelBtn?.addEventListener("click", expandSearchPanel);
els.branchSelector?.addEventListener("change", handleBranchSelectionChange);
els.branchSelectorSearch?.addEventListener("input", handleBranchSearchInput);
els.branchSelectorSearch?.addEventListener("keydown", handleBranchSearchKeydown);
els.searchResultsBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-customer-code]");
  if (!button) return;

  fetchCustomerStats(button.getAttribute("data-customer-code"), "", currentCustomerSearchFilters);
});
els.detailedOrdersList?.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-open-order-form]");
  if (!trigger) return;
  event.preventDefault();
  openSelectedOrderInOrderForm(trigger.getAttribute("data-open-order-form"));
});
els.productSalesMetric?.addEventListener("change", () => {
  currentProductSalesPage = 1;
  renderProductSales();
});
els.productSalesCodeFilter?.addEventListener("input", () => {
  currentProductSalesFilters.code = els.productSalesCodeFilter.value || "";
  currentProductSalesPage = 1;
  renderProductSales();
});
els.productSalesDescriptionFilter?.addEventListener("input", () => {
  currentProductSalesFilters.description = els.productSalesDescriptionFilter.value || "";
  currentProductSalesPage = 1;
  renderProductSales();
});
getSalesTimeRangeControls().forEach((control) => {
  control.addEventListener("change", () => {
    currentSalesTimeRange = normalizeSalesTimeRange(control.value || DEFAULT_SALES_TIME_RANGE);
    syncSalesTimeRangeControls(currentSalesTimeRange);
    if (!currentCustomerCode) return;
    fetchCustomerStats(currentCustomerCode, currentBranchCode, currentCustomerSearchFilters);
  });
});
els.receivablesPrevBtn?.addEventListener("click", () => {
  if (currentReceivablesPage <= 1) return;
  currentReceivablesPage -= 1;
  renderReceivablesTable();
});
els.receivablesNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(currentReceivables.length / RECEIVABLES_PAGE_SIZE));
  if (currentReceivablesPage >= totalPages) return;
  currentReceivablesPage += 1;
  renderReceivablesTable();
});
els.productSalesPrevBtn?.addEventListener("click", () => {
  if (currentProductSalesPage <= 1) return;
  currentProductSalesPage -= 1;
  renderProductSales();
});
els.productSalesNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(
    1,
    Math.ceil(
      filterProductItems(getSortedProductSalesForTable(), currentProductSalesFilters).length / PRODUCT_SALES_PAGE_SIZE,
    ),
  );
  if (currentProductSalesPage >= totalPages) return;
  currentProductSalesPage += 1;
  renderProductSales();
});
els.recentOrdersPrevBtn?.addEventListener("click", () => {
  if (currentRecentOrdersPage <= 1) return;
  currentRecentOrdersPage -= 1;
  renderRecentOrdersTable();
});
els.openOrdersPrevBtn?.addEventListener("click", () => {
  if (currentOpenOrdersPage <= 1) return;
  currentOpenOrdersPage -= 1;
  renderOpenOrdersTable();
});
els.preApprovalOrdersPrevBtn?.addEventListener("click", () => {
  if (currentPreApprovalOrdersPage <= 1) return;
  currentPreApprovalOrdersPage -= 1;
  renderPreApprovalOrdersTable();
});
els.openOrdersNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(getOpenOrdersForTable().length / OPEN_ORDERS_PAGE_SIZE));
  if (currentOpenOrdersPage >= totalPages) return;
  currentOpenOrdersPage += 1;
  renderOpenOrdersTable();
});
els.preApprovalOrdersNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(
    1,
    Math.ceil(getPreApprovalOrdersForTable().length / PRE_APPROVAL_ORDERS_PAGE_SIZE),
  );
  if (currentPreApprovalOrdersPage >= totalPages) return;
  currentPreApprovalOrdersPage += 1;
  renderPreApprovalOrdersTable();
});
els.recentOrdersNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(getRecentOrdersForTable().length / RECENT_ORDERS_PAGE_SIZE));
  if (currentRecentOrdersPage >= totalPages) return;
  currentRecentOrdersPage += 1;
  renderRecentOrdersTable();
});
els.recentOrdersBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;

  selectedOrderId = button.getAttribute("data-order-id");
  renderSelectedOrderDetails();
  renderRecentOrdersTable();
});
els.openOrdersBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;

  selectedOrderId = button.getAttribute("data-order-id");
  renderSelectedOrderDetails();
  renderOpenOrdersTable();
});
els.preApprovalOrdersBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;

  selectedOrderId = button.getAttribute("data-order-id");
  renderSelectedOrderDetails();
  renderPreApprovalOrdersTable();
});
document.addEventListener("click", (event) => {
  const button = event.target.closest(".admin-sort-btn[data-table-sort]");
  if (!button) return;

  const tableId = String(button.getAttribute("data-table-sort") || "").trim();
  const key = String(button.getAttribute("data-sort-key") || "").trim();
  if (!tableId || !key) return;

  if (tableId === "open") {
    if (openOrdersSort.key === key) {
      openOrdersSort.direction = openOrdersSort.direction === "asc" ? "desc" : "asc";
    } else {
      openOrdersSort = { key, direction: "desc" };
    }
    currentOpenOrdersPage = 1;
    renderOpenOrdersTable();
    return;
  }

  if (tableId === "pre-approval") {
    if (preApprovalOrdersSort.key === key) {
      preApprovalOrdersSort.direction = preApprovalOrdersSort.direction === "asc" ? "desc" : "asc";
    } else {
      preApprovalOrdersSort = { key, direction: "desc" };
    }
    currentPreApprovalOrdersPage = 1;
    renderPreApprovalOrdersTable();
    return;
  }

  if (tableId === "recent") {
    if (recentOrdersSort.key === key) {
      recentOrdersSort.direction = recentOrdersSort.direction === "asc" ? "desc" : "asc";
    } else {
      recentOrdersSort = { key, direction: "desc" };
    }
    currentRecentOrdersPage = 1;
    renderRecentOrdersTable();
    return;
  }

  if (tableId === "product-sales") {
    if (productSalesSort.key === key) {
      productSalesSort.direction = productSalesSort.direction === "asc" ? "desc" : "asc";
    } else {
      productSalesSort = { key, direction: "desc" };
    }
    currentProductSalesPage = 1;
    renderProductSales();
  }
});
els.openRankedOrderFormBtn?.addEventListener("click", openRankedOrderForm);
window.addEventListener("focus", () => {
  if (!els.dashboardPanel?.hidden) {
    void refreshSession({ silent: true });
  }
});

window.addEventListener("pagehide", saveAdminState);
window.addEventListener("beforeunload", saveAdminState);

resetStats();
resetSearchResults();
resetSearchSuggestions();
setSearchPanelCollapsed(false);
if (restoredAdminState?.authenticatedLikely) {
  if (els.username && restoredAdminState.username) els.username.value = restoredAdminState.username;
  setAuthenticatedUI({ authenticated: true, username: restoredAdminState.username || "admin" });
  restoreAdminStateView(restoredAdminState);
}
refreshSession({ silent: false }).then((me) => {
  if (me.authenticated) {
    restoreAdminStateView(restoredAdminState);
    if (restoredAdminState?.currentCustomerCode) {
      void fetchCustomerStats(
        restoredAdminState.currentCustomerCode,
        restoredAdminState.currentBranchCode || "",
        restoredAdminState.currentCustomerSearchFilters || restoredAdminState.searchFields || {},
      );
    }
    focusPrimarySearchField();
  } else {
    els.username.focus();
  }
  saveAdminState();
});




