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
const SEARCH_LOADING_MIN_VISIBLE_MS = 250;
const STATS_LOADING_MIN_VISIBLE_MS = 300;
const DEFAULT_SALES_TIME_RANGE = "3m";
const IMPORT_DATASET_LABELS = {
  sales_lines: "γραμμές πωλήσεων",
  customer_ledgers: "καρτέλες πελατών",
  imported_sales_lines: "γραμμές πωλήσεων",
  imported_customer_ledgers: "καρτέλες πελατών",
};

let currentDetailedOrders = [];
let currentProductSales = [];
let currentSearchResults = [];
let selectedOrderId = null;
let currentReceivables = [];
let currentProductSalesPage = 1;
let currentReceivablesPage = 1;
let currentRecentOrdersPage = 1;
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
  averageOrderValue: document.getElementById("averageOrderValue"),
  daysSinceLastOrderValue: document.getElementById("daysSinceLastOrderValue"),
  averageDaysBetweenOrdersValue: document.getElementById("averageDaysBetweenOrdersValue"),
  revenue3mValue: document.getElementById("revenue3mValue"),
  revenue6mValue: document.getElementById("revenue6mValue"),
  revenue12mValue: document.getElementById("revenue12mValue"),
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
  productSalesBody: document.getElementById("productSalesBody"),
  productSalesPagination: document.getElementById("productSalesPagination"),
  productSalesPrevBtn: document.getElementById("productSalesPrevBtn"),
  productSalesNextBtn: document.getElementById("productSalesNextBtn"),
  productSalesPageInfo: document.getElementById("productSalesPageInfo"),
  topProductsQtyBody: document.getElementById("topProductsQtyBody"),
  topProductsValueBody: document.getElementById("topProductsValueBody"),
  recentOrdersBody: document.getElementById("recentOrdersBody"),
  recentOrdersPagination: document.getElementById("recentOrdersPagination"),
  recentOrdersPrevBtn: document.getElementById("recentOrdersPrevBtn"),
  recentOrdersNextBtn: document.getElementById("recentOrdersNextBtn"),
  recentOrdersPageInfo: document.getElementById("recentOrdersPageInfo"),
  detailedOrdersList: document.getElementById("detailedOrdersList"),
};

function getSalesTimeRangeControls() {
  return Array.from(document.querySelectorAll(".sales-time-range-control"));
}

function syncSalesTimeRangeControls(value) {
  getSalesTimeRangeControls().forEach((control) => {
    if (control) control.value = value;
  });
}

function getSelectedSalesTimeRange() {
  const firstControl = getSalesTimeRangeControls()[0];
  return String(firstControl?.value || currentSalesTimeRange || DEFAULT_SALES_TIME_RANGE)
    .trim()
    .toLowerCase();
}

function normalizeSalesTimeRangeControlsText() {
  const labelsByValue = {
    "1w": "Τελευταίες 7 ημέρες",
    "2w": "Τελευταίες 14 ημέρες",
    "1m": "Τελευταίος 1 μήνας",
    "3m": "Τελευταίοι 3 μήνες",
    "6m": "Τελευταίοι 6 μήνες",
    "12m": "Τελευταίοι 12 μήνες",
    all: "Από την αρχή",
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
  return currentDetailedOrders.find((order) => String(order.order_id) === String(orderId)) || null;
}

function formatDisplayOrderId(orderId) {
  const raw = String(orderId || "").trim();
  if (!raw) return "-";
  const parts = raw.split("::").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
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
  if (els.productSalesPagination) els.productSalesPagination.hidden = true;
  if (els.productSalesPageInfo) els.productSalesPageInfo.textContent = "Σελίδα 1 από 1";
  if (els.productSalesPrevBtn) els.productSalesPrevBtn.disabled = true;
  if (els.productSalesNextBtn) els.productSalesNextBtn.disabled = true;
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
  resetBranchSelector();
  currentSalesTimeRange = getSelectedSalesTimeRange();
  els.customerNameHeading.textContent = "Πελάτης";
  els.customerMeta.textContent = "-";
  els.totalOrdersValue.textContent = "0";
  els.totalPiecesValue.textContent = "0";
  els.totalRevenueValue.textContent = "-";
  els.averageOrderValue.textContent = "-";
  els.daysSinceLastOrderValue.textContent = "-";
  els.averageDaysBetweenOrdersValue.textContent = "-";
  els.revenue3mValue.textContent = "-";
  els.revenue6mValue.textContent = "-";
  els.revenue12mValue.textContent = "-";
  els.lastOrderDateValue.textContent = "-";
  resetMonthlySales();
  resetReceivables();
  resetProductSales();
  els.topProductsQtyBody.innerHTML = `
    <tr>
      <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  els.topProductsValueBody.innerHTML = `
    <tr>
      <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  const recentOrdersHeadRow = document.querySelector(".admin-recent-orders-table thead tr");
  if (recentOrdersHeadRow) {
    recentOrdersHeadRow.innerHTML = `
      <th>ID</th>
      <th>Ημερομηνία παραγγελίας</th>
      <th>Ημερομηνία αποστολής</th>
      <th class="admin-table-number">Γραμμές</th>
      <th class="admin-table-number">Τεμάχια</th>
      <th class="admin-table-number">Αξία</th>
      <th class="admin-table-number">Μέση έκπτωση</th>
      <th>Ενέργεια</th>
    `;
  }
  els.recentOrdersBody.innerHTML = `
    <tr>
      <td colspan="8" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  currentRecentOrdersPage = 1;
  if (els.recentOrdersPagination) els.recentOrdersPagination.hidden = true;
  if (els.recentOrdersPageInfo) els.recentOrdersPageInfo.textContent = "Σελίδα 1 από 1";
  currentDetailedOrders = [];
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
          <span>${escapeHtml(formatNumber(selectedOrder.total_lines))} γραμμές</span>
          <span>${escapeHtml(formatNumber(selectedOrder.total_pieces))} τεμ.</span>
          <strong>${escapeHtml(formatMoney(selectedOrder.total_net_value))}</strong>
        </div>
      </div>
      <div class="admin-order-note">${escapeHtml(selectedOrder.notes || "Χωρίς σημειώσεις")}</div>
      <div class="admin-order-meta">
        <span>Αποστολή: ${escapeHtml(formatDate(selectedOrder.sent_at))}</span>
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
              <td>${escapeHtml(formatMoney(item.ledger_balance))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="6" class="admin-table-empty">\u0394\u03b5\u03bd \u03c5\u03c0\u03ac\u03c1\u03c7\u03bf\u03c5\u03bd \u03ba\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2 \u03ba\u03b1\u03c1\u03c4\u03ad\u03bb\u03b1\u03c2 \u03b3\u03b9\u03b1 \u03b1\u03c5\u03c4\u03cc\u03bd \u03c4\u03bf\u03bd \u03c0\u03b5\u03bb\u03ac\u03c4\u03b7.</td>
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
  const sortedItems = [...currentProductSales].sort((a, b) => {
    if (metric === "pieces") {
      return Number(b.pieces || 0) - Number(a.pieces || 0) || Number(b.revenue || 0) - Number(a.revenue || 0);
    }
    return Number(b.revenue || 0) - Number(a.revenue || 0) || Number(b.pieces || 0) - Number(a.pieces || 0);
  });

  if (els.productSalesMetricHeading) {
    els.productSalesMetricHeading.textContent = metric === "pieces" ? "Τεμάχια" : "Τζίρος";
  }

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PRODUCT_SALES_PAGE_SIZE));
  currentProductSalesPage = Math.min(currentProductSalesPage, totalPages);
  const start = (currentProductSalesPage - 1) * PRODUCT_SALES_PAGE_SIZE;
  const pageItems = sortedItems.slice(start, start + PRODUCT_SALES_PAGE_SIZE);

  els.productSalesBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const metricValue = metric === "pieces" ? formatNumber(item.pieces) : formatMoney(item.revenue);
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(metricValue)}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.orders))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.avg_unit_price))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="7" class="admin-table-empty">Δεν υπάρχουν διαθέσιμες πωλήσεις ειδών για την τρέχουσα επιλογή.</td>
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
}

function getRecentOrdersForTable() {
  return [...currentDetailedOrders].sort((a, b) => {
    const aKey = Date.parse(String(a?.sent_at || a?.ordered_at || a?.created_at || "")) || 0;
    const bKey = Date.parse(String(b?.sent_at || b?.ordered_at || b?.created_at || "")) || 0;
    return bKey - aKey || String(b?.order_id || "").localeCompare(String(a?.order_id || ""));
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
              <td>${escapeHtml(formatDate(item.sent_at))}</td>
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
          <td colspan="8" class="admin-table-empty">Δεν βρέθηκαν πρόσφατες παραγγελίες.</td>
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
  const isBranchView = customer.aggregation_level === "branch";

  currentDetailedOrders = Array.isArray(data?.detailed_orders) ? data.detailed_orders : [];
  currentProductSales = Array.isArray(productSales.items) ? productSales.items : [];
  selectedOrderId = null;
  currentProductSalesPage = 1;
  currentRecentOrdersPage = 1;

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
  els.totalOrdersValue.textContent = formatNumber(summary.total_orders ?? 0);
  els.totalPiecesValue.textContent = formatNumber(summary.total_pieces ?? 0);
  els.totalRevenueValue.textContent = formatMoney(summary.total_revenue);
  els.averageOrderValue.textContent = formatMoney(summary.average_order_value);
  els.daysSinceLastOrderValue.textContent = formatDays(summary.days_since_last_order);
  els.averageDaysBetweenOrdersValue.textContent = formatDays(summary.average_days_between_orders);
  els.revenue3mValue.textContent = formatMoney(summary.revenue_3m);
  els.revenue6mValue.textContent = formatMoney(summary.revenue_6m);
  els.revenue12mValue.textContent = formatMoney(summary.revenue_12m);
  els.lastOrderDateValue.textContent = formatDate(summary.last_order_date);
  renderBranchSelector(customer.code, availableBranches, customer.branch_code || "");

  renderMonthlySales(monthlySales);
  if (els.receivablesPanel) {
    els.receivablesPanel.hidden = isBranchView;
  }
  renderReceivables(receivables);
  els.productSalesMetric.value = productSales.metric === "pieces" ? "pieces" : "revenue";
  renderProductSales();

  els.topProductsQtyBody.innerHTML = topProductsByQty.length
    ? topProductsByQty
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

  els.topProductsValueBody.innerHTML = topProductsByValue.length
    ? topProductsByValue
        .map((item) => {
          return `
            <tr>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.qty))}</td>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.revenue))}</td>
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
els.productSalesMetric?.addEventListener("change", () => {
  currentProductSalesPage = 1;
  renderProductSales();
});
getSalesTimeRangeControls().forEach((control) => {
  control.addEventListener("change", () => {
    currentSalesTimeRange = String(control.value || DEFAULT_SALES_TIME_RANGE).trim().toLowerCase();
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
  const totalPages = Math.max(1, Math.ceil(currentProductSales.length / PRODUCT_SALES_PAGE_SIZE));
  if (currentProductSalesPage >= totalPages) return;
  currentProductSalesPage += 1;
  renderProductSales();
});
els.recentOrdersPrevBtn?.addEventListener("click", () => {
  if (currentRecentOrdersPage <= 1) return;
  currentRecentOrdersPage -= 1;
  renderRecentOrdersTable();
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
window.addEventListener("focus", () => {
  if (!els.dashboardPanel?.hidden) {
    void refreshSession({ silent: true });
  }
});

resetStats();
resetSearchResults();
resetSearchSuggestions();
setSearchPanelCollapsed(false);
refreshSession({ silent: false }).then((me) => {
  if (me.authenticated) {
    focusPrimarySearchField();
  } else {
    els.username.focus();
  }
});




