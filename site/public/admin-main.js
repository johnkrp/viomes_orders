import {
  API_BASE,
  DEFAULT_SALES_TIME_RANGE,
  IMPORT_DATASET_LABELS,
  OPEN_ORDERS_PAGE_SIZE,
  PRE_APPROVAL_ORDERS_PAGE_SIZE,
  PRODUCT_SALES_PAGE_SIZE,
  RECEIVABLES_PAGE_SIZE,
  RECENT_ORDERS_PAGE_SIZE,
  SEARCH_LOADING_MIN_VISIBLE_MS,
  STATS_LOADING_MIN_VISIBLE_MS,
} from "./admin-constants.js";
import { createAdminElements, assertAdminDomContract } from "./admin-dom.js";
import {
  clearAdminState as clearAdminStateModule,
  fillSearchFields as fillSearchFieldsModule,
  loadAdminState as loadAdminStateModule,
  saveAdminState as saveAdminStateModule,
} from "./admin-state.js";
import {
  apiFetch as apiFetchModule,
  loadLatestImportMessage as loadLatestImportMessageModule,
  refreshSession as refreshSessionModule,
} from "./admin-api.js";
import {
  clearCustomerStats as clearCustomerStatsModule,
  expandSearchPanel as expandSearchPanelModule,
  fetchAllRangeStats as fetchAllRangeStatsModule,
  fetchCustomerStats as fetchCustomerStatsModule,
  fetchRangeSummary as fetchRangeSummaryModule,
  handleBranchSearchInput as handleBranchSearchInputModule,
  handleBranchSearchKeydown as handleBranchSearchKeydownModule,
  handleBranchSelectionChange as handleBranchSelectionChangeModule,
  handleLogin as handleLoginModule,
  handleLogout as handleLogoutModule,
  searchCustomers as searchCustomersModule,
} from "./admin-actions.js";
import {
  openRankedOrderForm as openRankedOrderFormModule,
  openSelectedOrderInOrderForm as openSelectedOrderInOrderFormModule,
} from "./admin-handoff.js";
import {
  filterProductItems as filterProductItemsModule,
  getOpenOrdersForTable as getOpenOrdersForTableModule,
  getPreApprovalOrdersForTable as getPreApprovalOrdersForTableModule,
  getRecentOrdersForTable as getRecentOrdersForTableModule,
  getSortedProductSales as getSortedProductSalesModule,
  getSortedProductSalesForTable as getSortedProductSalesForTableModule,
} from "./admin-tables.js";
import {
  getBranchOptionLabel as getBranchOptionLabelModule,
  renderBranchSelector as renderBranchSelectorModule,
  renderFilteredBranchOptions as renderFilteredBranchOptionsModule,
  renderMonthlySales as renderMonthlySalesModule,
  renderOpenOrdersTable as renderOpenOrdersTableModule,
  renderPreApprovalOrdersTable as renderPreApprovalOrdersTableModule,
  renderProductSales as renderProductSalesModule,
  renderRecentOrdersTable as renderRecentOrdersTableModule,
  renderReceivables as renderReceivablesModule,
  renderReceivablesTable as renderReceivablesTableModule,
  renderSearchResults as renderSearchResultsModule,
  renderSelectedOrderDetails as renderSelectedOrderDetailsModule,
  renderStats as renderStatsModule,
  renderTopProductsQty as renderTopProductsQtyModule,
  renderTopProductsValue as renderTopProductsValueModule,
  resetBranchSelector as resetBranchSelectorModule,
  resetProductSales as resetProductSalesModule,
  resetSearchResults as resetSearchResultsModule,
  resetSearchSuggestions as resetSearchSuggestionsModule,
  resetStats as resetStatsModule,
} from "./admin-render.js";
import {
  escapeHtml,
  formatDate,
  normalizeSalesTimeRange,
  parseIsoDate,
  sleep,
} from "./admin-utils.js";

const elements = createAdminElements();
assertAdminDomContract(elements);

const state = {
  currentDetailedOrders: [],
  currentDetailedOpenOrders: [],
  currentDetailedPreApprovalOrders: [],
  currentOpenOrders: [],
  currentPreApprovalOrders: [],
  currentProductSales: [],
  currentTopProductsByQty: [],
  currentTopProductsByValue: [],
  currentSearchResults: [],
  allRangeDetailedOrders: [],
  allRangeStatsKey: "",
  rangeSummaryCache: new Map(),
  rangeSummaryPending: new Set(),
  currentAllRangeRequestId: 0,
  selectedOrderId: null,
  currentReceivables: [],
  currentProductSalesPage: 1,
  currentReceivablesPage: 1,
  currentRecentOrdersPage: 1,
  currentOpenOrdersPage: 1,
  currentPreApprovalOrdersPage: 1,
  recentOrdersSort: { key: "created_at", direction: "desc" },
  productSalesSort: { key: "primary_metric", direction: "desc" },
  openOrdersSort: { key: "created_at", direction: "desc" },
  preApprovalOrdersSort: { key: "created_at", direction: "desc" },
  currentProductSalesFilters: { code: "", description: "" },
  currentCustomerCode: null,
  currentBranchCode: "",
  currentAvailableBranches: [],
  currentSalesTimeRange: DEFAULT_SALES_TIME_RANGE,
  currentCustomerSearchFilters: {
    customer_name: "",
    customer_code: "",
    branch_code: "",
    branch_description: "",
  },
  currentSearchRequestId: 0,
  currentStatsRequestId: 0,
  searchLoadingStateId: 0,
  statsLoadingStateId: 0,
  searchLoadingStartedAt: 0,
  statsLoadingStartedAt: 0,
  lastRenderedStatsPayload: null,
};

const restoredAdminState = loadAdminStateModule();

function createCounterProxy(key) {
  return {
    get value() {
      return state[key];
    },
    set value(nextValue) {
      state[key] = Number(nextValue || 0);
    },
  };
}

const counters = {
  currentSearchRequestId: createCounterProxy("currentSearchRequestId"),
  currentStatsRequestId: createCounterProxy("currentStatsRequestId"),
  currentAllRangeRequestId: createCounterProxy("currentAllRangeRequestId"),
};

function getSalesTimeRangeControls() {
  return Array.from(document.querySelectorAll(".sales-time-range-control"));
}

function getAllTimeRangeControls() {
  return Array.from(document.querySelectorAll(".sales-time-range-control, .card-time-range-control"));
}

function buildRangeSummaryKey(statsKey, range) {
  return `${statsKey}::${normalizeSalesTimeRange(range)}`;
}

function cacheRangeSummary(statsKey, range, summary) {
  if (!statsKey || !range || !summary) return;
  state.rangeSummaryCache.set(buildRangeSummaryKey(statsKey, range), {
    total_orders: Number(summary.total_orders ?? 0),
    total_pieces: Number(summary.total_pieces ?? 0),
    total_revenue: Number(summary.total_revenue ?? 0),
  });
}

function getCachedRangeSummary(statsKey, range) {
  if (!statsKey || !range) return null;
  return state.rangeSummaryCache.get(buildRangeSummaryKey(statsKey, range)) || null;
}

function syncSalesTimeRangeControls(value) {
  const normalizedValue = normalizeSalesTimeRange(value);
  getSalesTimeRangeControls().forEach((control) => {
    control.value = normalizedValue;
  });
}

function getSelectedSalesTimeRange() {
  const firstControl = getSalesTimeRangeControls()[0];
  return normalizeSalesTimeRange(firstControl?.value || state.currentSalesTimeRange || DEFAULT_SALES_TIME_RANGE);
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

  getAllTimeRangeControls().forEach((control) => {
    const labelText = control.closest("label")?.querySelector("span");
    if (labelText) labelText.textContent = "Περίοδος";

    Array.from(control.options).forEach((option) => {
      const normalizedValue = String(option.value || "").trim().toLowerCase();
      if (labelsByValue[normalizedValue]) option.textContent = labelsByValue[normalizedValue];
    });
  });
}

function setStatus(text, type = "info") {
  if (!elements.adminStatus) return;

  if (!text) {
    elements.adminStatus.className = "toast admin-toast";
    elements.adminStatus.innerHTML = "";
    return;
  }

  elements.adminStatus.className = "toast admin-toast show";
  if (type === "error") elements.adminStatus.classList.add("is-error");
  else if (type === "ok") elements.adminStatus.classList.add("is-ok");
  else elements.adminStatus.classList.add("is-info");

  const icon = type === "error" ? "!" : type === "ok" ? "OK" : "i";
  elements.adminStatus.innerHTML = `
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
  if (elements.sessionInfo) {
    elements.sessionInfo.textContent = text;
  }
}

function applySearchLoadingState(isLoading, message = "Φόρτωση...") {
  const busy = Boolean(isLoading);
  elements.customerSearchPanel?.setAttribute("aria-busy", String(busy));
  elements.searchResultsPanel?.classList.toggle("is-loading", busy);
  renderLoadingNotice(elements.searchLoadingNotice, busy, message);

  if (elements.searchCustomersBtn) {
    elements.searchCustomersBtn.disabled = busy;
    elements.searchCustomersBtn.textContent = busy ? "Αναζήτηση..." : "Αναζήτηση";
  }
  if (elements.clearStatsBtn) elements.clearStatsBtn.disabled = busy;

  [elements.customerNameQuery, elements.customerCodeQuery, elements.branchCodeQuery, elements.branchDescriptionQuery]
    .forEach((input) => {
      if (input) input.disabled = busy;
    });
}

async function setSearchLoading(isLoading, message = "Φόρτωση...") {
  const stateId = ++state.searchLoadingStateId;
  const busy = Boolean(isLoading);

  if (busy) {
    state.searchLoadingStartedAt = Date.now();
    applySearchLoadingState(true, message);
    return;
  }

  const elapsed = state.searchLoadingStartedAt
    ? Date.now() - state.searchLoadingStartedAt
    : SEARCH_LOADING_MIN_VISIBLE_MS;
  const remaining = Math.max(SEARCH_LOADING_MIN_VISIBLE_MS - elapsed, 0);
  if (remaining > 0) {
    await sleep(remaining);
  }
  if (stateId !== state.searchLoadingStateId) return;
  applySearchLoadingState(false, message);
}

function applyStatsLoadingState(isLoading, message = "Φόρτωση στοιχείων πελάτη...") {
  const busy = Boolean(isLoading);
  elements.statsPanel?.setAttribute("aria-busy", String(busy));
  elements.statsPanel?.classList.toggle("is-loading", busy);
  renderLoadingNotice(elements.statsLoadingNotice, busy, message);

  if (busy) {
    elements.emptyState.hidden = true;
    elements.statsPanel.hidden = false;
  }

  if (elements.branchSelector) {
    elements.branchSelector.disabled = busy || state.currentAvailableBranches.length <= 1;
  }
  if (elements.branchSelectorSearch) {
    elements.branchSelectorSearch.disabled = busy || state.currentAvailableBranches.length <= 1;
  }

  elements.searchResultsBody?.querySelectorAll("[data-customer-code]").forEach((button) => {
    button.disabled = busy;
  });
}

async function setStatsLoading(isLoading, message = "Φόρτωση στοιχείων πελάτη...") {
  const stateId = ++state.statsLoadingStateId;
  const busy = Boolean(isLoading);

  if (busy) {
    state.statsLoadingStartedAt = Date.now();
    applyStatsLoadingState(true, message);
    return;
  }

  const elapsed = state.statsLoadingStartedAt
    ? Date.now() - state.statsLoadingStartedAt
    : STATS_LOADING_MIN_VISIBLE_MS;
  const remaining = Math.max(STATS_LOADING_MIN_VISIBLE_MS - elapsed, 0);
  if (remaining > 0) {
    await sleep(remaining);
  }
  if (stateId !== state.statsLoadingStateId) return;
  applyStatsLoadingState(false, message);
}

function getCardTimeRangeValue(target) {
  const control = document.querySelector(`.card-time-range-control[data-range-target="${target}"]`);
  return normalizeSalesTimeRange(control?.value || DEFAULT_SALES_TIME_RANGE);
}

function filterOrdersByRange(orders, range, now = new Date()) {
  const normalized = normalizeSalesTimeRange(range);
  if (normalized === "all") {
    return Array.isArray(orders) ? [...orders] : [];
  }

  if (normalized === "this_year" || normalized === "last_year") {
    const year = normalized === "this_year" ? now.getFullYear() : now.getFullYear() - 1;
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    return (Array.isArray(orders) ? orders : []).filter((order) => {
      const date = parseIsoDate(order?.ordered_at || order?.created_at);
      return date ? date >= start && date <= end : false;
    });
  }

  const daysByRange = { "1m": 30, "3m": 90, "6m": 180, "12m": 365 };
  const days = daysByRange[normalized] || 90;
  const cutoff = new Date(now.getTime() - days * 86400000);
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    const date = parseIsoDate(order?.ordered_at || order?.created_at);
    return date ? date >= cutoff : false;
  });
}

function findDetailedOrder(orderId) {
  const normalizedId = String(orderId);
  return (
    state.currentDetailedOrders.find((order) => String(order.order_id) === normalizedId) ||
    state.currentDetailedOpenOrders.find((order) => String(order.order_id) === normalizedId) ||
    state.currentDetailedPreApprovalOrders.find((order) => String(order.order_id) === normalizedId) ||
    null
  );
}

function formatDisplayOrderId(orderId) {
  const raw = String(orderId || "").trim();
  if (!raw) return "-";
  const parts = raw.split("::").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
}

function setAuthenticatedUI(me) {
  const authenticated = Boolean(me?.authenticated);
  elements.loginPanel.hidden = authenticated;
  elements.dashboardPanel.hidden = !authenticated;
  elements.logoutBtn.hidden = !authenticated;

  if (!authenticated) {
    setSessionInfo("Δεν υπάρχει ενεργή συνεδρία διαχειριστή.");
    return;
  }

  setSessionInfo(`Συνδεδεμένος χρήστης: ${me.username}. Φόρτωση τελευταίας εισαγωγής δεδομένων...`);
}

function setSearchPanelCollapsed(collapsed) {
  if (elements.customerSearchPanel) {
    elements.customerSearchPanel.classList.toggle("is-collapsed", Boolean(collapsed));
  }
  if (elements.searchPanelContent) {
    elements.searchPanelContent.hidden = Boolean(collapsed);
  }
  if (elements.expandSearchPanelBtn) {
    elements.expandSearchPanelBtn.hidden = !collapsed;
  }
}

function focusPrimarySearchField() {
  elements.customerNameQuery?.focus();
}

function filterBranches(term, selectedBranchCode = state.currentBranchCode) {
  const normalizedTerm = String(term || "").trim().toLocaleLowerCase("el-GR");
  if (!normalizedTerm) {
    renderFilteredBranchOptions(state.currentAvailableBranches, selectedBranchCode);
    return state.currentAvailableBranches;
  }

  const filtered = state.currentAvailableBranches.filter((branch) => {
    const code = String(branch.branch_code || "").toLocaleLowerCase("el-GR");
    const description = String(branch.branch_description || "").toLocaleLowerCase("el-GR");
    return code.includes(normalizedTerm) || description.includes(normalizedTerm);
  });

  renderFilteredBranchOptions(filtered, selectedBranchCode);
  return filtered;
}

function getCustomerSearchFilters() {
  return {
    customer_name: (elements.customerNameQuery?.value || "").trim(),
    customer_code: (elements.customerCodeQuery?.value || "").trim(),
    branch_code: (elements.branchCodeQuery?.value || "").trim(),
    branch_description: (elements.branchDescriptionQuery?.value || "").trim(),
  };
}

function hasCustomerSearchFilters(filters) {
  return Object.values(filters || {}).some((value) => Boolean(value));
}

function buildCustomerSearchParams(filters) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function setCurrentCustomerSearchFilters(filters = {}) {
  state.currentCustomerSearchFilters = {
    customer_name: String(filters.customer_name || "").trim(),
    customer_code: String(filters.customer_code || "").trim(),
    branch_code: String(filters.branch_code || "").trim(),
    branch_description: String(filters.branch_description || "").trim(),
  };
}

async function performCustomerSearch(filters, options = {}) {
  const { limit = 20, renderTable = true, silent = false } = options;

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

function formatAggregationLevelLabel(level) {
  if (level === "branch") return "Υποκατάστημα";
  if (level === "customer") return "Πελάτης";
  return level || "";
}

function syncProductTableFilterInputs() {
  if (elements.productSalesCodeFilter) elements.productSalesCodeFilter.value = state.currentProductSalesFilters.code;
  if (elements.productSalesDescriptionFilter) {
    elements.productSalesDescriptionFilter.value = state.currentProductSalesFilters.description;
  }
}

function resetProductTableFilters() {
  state.currentProductSalesFilters = { code: "", description: "" };
  syncProductTableFilterInputs();
}

function restoreAdminStateView(snapshot) {
  if (!snapshot) return;

  fillSearchFields(snapshot.searchFields || snapshot.currentCustomerSearchFilters || {});
  setCurrentCustomerSearchFilters(snapshot.currentCustomerSearchFilters || snapshot.searchFields || {});
  state.currentSalesTimeRange = normalizeSalesTimeRange(snapshot.currentSalesTimeRange || DEFAULT_SALES_TIME_RANGE);
  syncSalesTimeRangeControls(state.currentSalesTimeRange);
  setSearchPanelCollapsed(Boolean(snapshot.searchPanelCollapsed));

  if (Array.isArray(snapshot.currentSearchResults) && snapshot.currentSearchResults.length) {
    renderSearchResults(snapshot.currentSearchResults, snapshot.currentCustomerSearchFilters || snapshot.searchFields || {});
  }

  if (!snapshot.lastRenderedStatsPayload) return;

  renderStats(snapshot.lastRenderedStatsPayload);
  state.currentProductSalesPage = Math.max(1, Number(snapshot.currentProductSalesPage) || 1);
  state.currentReceivablesPage = Math.max(1, Number(snapshot.currentReceivablesPage) || 1);
  state.currentRecentOrdersPage = Math.max(1, Number(snapshot.currentRecentOrdersPage) || 1);
  state.currentOpenOrdersPage = Math.max(1, Number(snapshot.currentOpenOrdersPage) || 1);
  state.currentPreApprovalOrdersPage = Math.max(1, Number(snapshot.currentPreApprovalOrdersPage) || 1);
  state.selectedOrderId = snapshot.selectedOrderId || null;

  if (elements.productSalesMetric) {
    elements.productSalesMetric.value = snapshot.productSalesMetric === "pieces" ? "pieces" : "revenue";
  }
  if (elements.branchSelectorSearch) {
    elements.branchSelectorSearch.value = snapshot.branchSelectorSearch || "";
  }

  renderProductSales();
  renderReceivablesTable();
  renderOpenOrdersTable();
  renderPreApprovalOrdersTable();
  renderRecentOrdersTable();
  renderSelectedOrderDetails();
}

function clearAdminState() {
  clearAdminStateModule();
}

function fillSearchFields(filters = {}) {
  fillSearchFieldsModule(elements, filters);
}

function saveAdminState() {
  saveAdminStateModule(elements, {
    ...state,
    getCustomerSearchFilters,
  });
}

async function apiFetch(path, options = {}) {
  return apiFetchModule(API_BASE, path, options);
}

async function loadLatestImportMessage(me) {
  return loadLatestImportMessageModule(moduleContext, me);
}

async function refreshSession(options = {}) {
  return refreshSessionModule(moduleContext, options);
}

function resetProductSales() {
  return resetProductSalesModule(moduleContext);
}

function resetSearchResults() {
  return resetSearchResultsModule(moduleContext);
}

function resetSearchSuggestions() {
  return resetSearchSuggestionsModule();
}

function resetBranchSelector() {
  return resetBranchSelectorModule(moduleContext);
}

function getBranchOptionLabel(branch) {
  return getBranchOptionLabelModule(branch);
}

function renderFilteredBranchOptions(branches, selectedBranchCode = "") {
  return renderFilteredBranchOptionsModule(moduleContext, branches, selectedBranchCode);
}

function renderBranchSelector(customerCode, branches = [], selectedBranchCode = "") {
  return renderBranchSelectorModule(moduleContext, customerCode, branches, selectedBranchCode);
}

function renderSearchResults(items, filters = {}) {
  return renderSearchResultsModule(moduleContext, items, filters);
}

function renderSelectedOrderDetails() {
  return renderSelectedOrderDetailsModule(moduleContext);
}

function renderMonthlySales(monthlySales) {
  return renderMonthlySalesModule(moduleContext, monthlySales);
}

function renderReceivablesTable() {
  return renderReceivablesTableModule(moduleContext);
}

function renderReceivables(receivables) {
  return renderReceivablesModule(moduleContext, receivables);
}

function renderProductSales() {
  return renderProductSalesModule(moduleContext);
}

function renderTopProductsQty() {
  return renderTopProductsQtyModule(moduleContext);
}

function renderTopProductsValue() {
  return renderTopProductsValueModule(moduleContext);
}

function renderRecentOrdersTable() {
  return renderRecentOrdersTableModule(moduleContext);
}

function renderPreApprovalOrdersTable() {
  return renderPreApprovalOrdersTableModule(moduleContext);
}

function renderOpenOrdersTable() {
  return renderOpenOrdersTableModule(moduleContext);
}

function resetStats() {
  return resetStatsModule(moduleContext);
}

function renderStats(data) {
  return renderStatsModule(moduleContext, data);
}

function getSortedProductSales() {
  return getSortedProductSalesModule(moduleContext);
}

function getSortedProductSalesForTable() {
  return getSortedProductSalesForTableModule(moduleContext);
}

function filterProductItems(items, filters = {}) {
  return filterProductItemsModule(items, filters);
}

function getRecentOrdersForTable() {
  return getRecentOrdersForTableModule(moduleContext);
}

function getOpenOrdersForTable() {
  return getOpenOrdersForTableModule(moduleContext);
}

function getPreApprovalOrdersForTable() {
  return getPreApprovalOrdersForTableModule(moduleContext);
}

async function handleLogin(event) {
  return handleLoginModule(moduleContext, event);
}

async function handleLogout() {
  return handleLogoutModule(moduleContext);
}

async function fetchCustomerStats(customerCode, branchCode = "", scopeFilters = state.currentCustomerSearchFilters) {
  return fetchCustomerStatsModule(moduleContext, customerCode, branchCode, scopeFilters);
}

async function fetchAllRangeStats(customerCode, branchCode = "", scopeFilters = state.currentCustomerSearchFilters) {
  return fetchAllRangeStatsModule(moduleContext, customerCode, branchCode, scopeFilters);
}

async function fetchRangeSummary(
  range,
  customerCode = state.currentCustomerCode,
  branchCode = state.currentBranchCode,
  scopeFilters = state.currentCustomerSearchFilters,
) {
  return fetchRangeSummaryModule(moduleContext, range, customerCode, branchCode, scopeFilters);
}

async function searchCustomers(event) {
  return searchCustomersModule(moduleContext, event);
}

function clearCustomerStats() {
  return clearCustomerStatsModule(moduleContext);
}

function handleBranchSelectionChange() {
  return handleBranchSelectionChangeModule(moduleContext);
}

function handleBranchSearchInput() {
  return handleBranchSearchInputModule(moduleContext);
}

function handleBranchSearchKeydown(event) {
  return handleBranchSearchKeydownModule(moduleContext, event);
}

function expandSearchPanel() {
  return expandSearchPanelModule(moduleContext);
}

function openSelectedOrderInOrderForm(orderId) {
  return openSelectedOrderInOrderFormModule(moduleContext, orderId);
}

function openRankedOrderForm() {
  return openRankedOrderFormModule(moduleContext);
}

const moduleContext = {
  apiBase: API_BASE,
  counters,
  elements,
  formatDate,
  getBranchOptionLabel,
  importDatasetLabels: IMPORT_DATASET_LABELS,
  state,
  apiFetch,
  buildRangeSummaryKey,
  cacheRangeSummary,
  clearAdminState,
  fetchAllRangeStats,
  fetchRangeSummary,
  filterBranches,
  filterOrdersByRange,
  findDetailedOrder,
  focusPrimarySearchField,
  formatAggregationLevelLabel,
  formatDisplayOrderId,
  getCachedRangeSummary,
  getCardTimeRangeValue,
  getCustomerSearchFilters,
  getOpenOrdersForTable,
  getPreApprovalOrdersForTable,
  getRecentOrdersForTable,
  getSelectedSalesTimeRange,
  getSortedProductSales,
  getSortedProductSalesForTable,
  hasCustomerSearchFilters,
  loadLatestImportMessage,
  normalizeSalesTimeRange,
  performCustomerSearch,
  renderLoadingNotice,
  renderSearchResults,
  renderStats,
  resetProductTableFilters,
  resetSearchResults,
  resetSearchSuggestions,
  resetStats,
  setAuthenticatedUI,
  setCurrentCustomerSearchFilters,
  setSearchLoading,
  setSearchPanelCollapsed,
  setSessionInfo,
  setStatsLoading,
  setStatus,
  syncSalesTimeRangeControls,
};

normalizeSalesTimeRangeControlsText();

elements.loginForm?.addEventListener("submit", handleLogin);
elements.logoutBtn?.addEventListener("click", handleLogout);
elements.customerSearchForm?.addEventListener("submit", searchCustomers);
elements.clearStatsBtn?.addEventListener("click", clearCustomerStats);
elements.expandSearchPanelBtn?.addEventListener("click", expandSearchPanel);
elements.branchSelector?.addEventListener("change", handleBranchSelectionChange);
elements.branchSelectorSearch?.addEventListener("input", handleBranchSearchInput);
elements.branchSelectorSearch?.addEventListener("keydown", handleBranchSearchKeydown);

elements.searchResultsBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-customer-code]");
  if (!button) return;
  void fetchCustomerStats(button.getAttribute("data-customer-code"), "", state.currentCustomerSearchFilters);
});

elements.detailedOrdersList?.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-open-order-form]");
  if (!trigger) return;
  event.preventDefault();
  openSelectedOrderInOrderForm(trigger.getAttribute("data-open-order-form"));
});

elements.productSalesMetric?.addEventListener("change", () => {
  state.currentProductSalesPage = 1;
  renderProductSales();
});

elements.productSalesCodeFilter?.addEventListener("input", () => {
  state.currentProductSalesFilters.code = elements.productSalesCodeFilter.value || "";
  state.currentProductSalesPage = 1;
  renderProductSales();
});

elements.productSalesDescriptionFilter?.addEventListener("input", () => {
  state.currentProductSalesFilters.description = elements.productSalesDescriptionFilter.value || "";
  state.currentProductSalesPage = 1;
  renderProductSales();
});

getSalesTimeRangeControls().forEach((control) => {
  control.addEventListener("change", () => {
    state.currentSalesTimeRange = normalizeSalesTimeRange(control.value || DEFAULT_SALES_TIME_RANGE);
    syncSalesTimeRangeControls(state.currentSalesTimeRange);
    if (!state.currentCustomerCode) return;
    void fetchCustomerStats(state.currentCustomerCode, state.currentBranchCode, state.currentCustomerSearchFilters);
  });
});

document.querySelectorAll(".card-time-range-control").forEach((control) => {
  control.addEventListener("change", () => {
    if (!state.lastRenderedStatsPayload) return;
    const selectedRange = normalizeSalesTimeRange(control.value || DEFAULT_SALES_TIME_RANGE);
    if (state.currentCustomerCode) {
      void fetchRangeSummary(selectedRange, state.currentCustomerCode, state.currentBranchCode, state.currentCustomerSearchFilters);
    }
    renderStats(state.lastRenderedStatsPayload);
  });
});

elements.receivablesPrevBtn?.addEventListener("click", () => {
  if (state.currentReceivablesPage <= 1) return;
  state.currentReceivablesPage -= 1;
  renderReceivablesTable();
});

elements.receivablesNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(state.currentReceivables.length / RECEIVABLES_PAGE_SIZE));
  if (state.currentReceivablesPage >= totalPages) return;
  state.currentReceivablesPage += 1;
  renderReceivablesTable();
});

elements.productSalesPrevBtn?.addEventListener("click", () => {
  if (state.currentProductSalesPage <= 1) return;
  state.currentProductSalesPage -= 1;
  renderProductSales();
});

elements.productSalesNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(
    1,
    Math.ceil(filterProductItems(getSortedProductSalesForTable(), state.currentProductSalesFilters).length / PRODUCT_SALES_PAGE_SIZE),
  );
  if (state.currentProductSalesPage >= totalPages) return;
  state.currentProductSalesPage += 1;
  renderProductSales();
});

elements.recentOrdersPrevBtn?.addEventListener("click", () => {
  if (state.currentRecentOrdersPage <= 1) return;
  state.currentRecentOrdersPage -= 1;
  renderRecentOrdersTable();
});

elements.recentOrdersNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(getRecentOrdersForTable().length / RECENT_ORDERS_PAGE_SIZE));
  if (state.currentRecentOrdersPage >= totalPages) return;
  state.currentRecentOrdersPage += 1;
  renderRecentOrdersTable();
});

elements.openOrdersPrevBtn?.addEventListener("click", () => {
  if (state.currentOpenOrdersPage <= 1) return;
  state.currentOpenOrdersPage -= 1;
  renderOpenOrdersTable();
});

elements.openOrdersNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(getOpenOrdersForTable().length / OPEN_ORDERS_PAGE_SIZE));
  if (state.currentOpenOrdersPage >= totalPages) return;
  state.currentOpenOrdersPage += 1;
  renderOpenOrdersTable();
});

elements.preApprovalOrdersPrevBtn?.addEventListener("click", () => {
  if (state.currentPreApprovalOrdersPage <= 1) return;
  state.currentPreApprovalOrdersPage -= 1;
  renderPreApprovalOrdersTable();
});

elements.preApprovalOrdersNextBtn?.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(getPreApprovalOrdersForTable().length / PRE_APPROVAL_ORDERS_PAGE_SIZE));
  if (state.currentPreApprovalOrdersPage >= totalPages) return;
  state.currentPreApprovalOrdersPage += 1;
  renderPreApprovalOrdersTable();
});

elements.recentOrdersBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;
  state.selectedOrderId = button.getAttribute("data-order-id");
  renderSelectedOrderDetails();
  renderRecentOrdersTable();
});

elements.openOrdersBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;
  state.selectedOrderId = button.getAttribute("data-order-id");
  renderSelectedOrderDetails();
  renderOpenOrdersTable();
});

elements.preApprovalOrdersBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;
  state.selectedOrderId = button.getAttribute("data-order-id");
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
    if (state.openOrdersSort.key === key) {
      state.openOrdersSort.direction = state.openOrdersSort.direction === "asc" ? "desc" : "asc";
    } else {
      state.openOrdersSort = { key, direction: "desc" };
    }
    state.currentOpenOrdersPage = 1;
    renderOpenOrdersTable();
    return;
  }

  if (tableId === "pre-approval") {
    if (state.preApprovalOrdersSort.key === key) {
      state.preApprovalOrdersSort.direction = state.preApprovalOrdersSort.direction === "asc" ? "desc" : "asc";
    } else {
      state.preApprovalOrdersSort = { key, direction: "desc" };
    }
    state.currentPreApprovalOrdersPage = 1;
    renderPreApprovalOrdersTable();
    return;
  }

  if (tableId === "recent") {
    if (state.recentOrdersSort.key === key) {
      state.recentOrdersSort.direction = state.recentOrdersSort.direction === "asc" ? "desc" : "asc";
    } else {
      state.recentOrdersSort = { key, direction: "desc" };
    }
    state.currentRecentOrdersPage = 1;
    renderRecentOrdersTable();
    return;
  }

  if (tableId === "product-sales") {
    if (state.productSalesSort.key === key) {
      state.productSalesSort.direction = state.productSalesSort.direction === "asc" ? "desc" : "asc";
    } else {
      state.productSalesSort = { key, direction: "desc" };
    }
    state.currentProductSalesPage = 1;
    renderProductSales();
  }
});

elements.openRankedOrderFormBtn?.addEventListener("click", openRankedOrderForm);

window.addEventListener("focus", () => {
  if (!elements.dashboardPanel?.hidden) {
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
  if (elements.username && restoredAdminState.username) {
    elements.username.value = restoredAdminState.username;
  }
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
    elements.username.focus();
  }
  saveAdminState();
});
