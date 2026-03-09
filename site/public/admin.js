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
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PRODUCT_SALES_PAGE_SIZE = 10;

let currentDetailedOrders = [];
let currentProductSales = [];
let currentSearchResults = [];
let selectedOrderId = null;
let currentProductSalesPage = 1;
let currentCustomerCode = null;
let currentBranchCode = "";
let currentAvailableBranches = [];
let currentCustomerSearchFilters = {
  customer_name: "",
  customer_code: "",
  branch_code: "",
  branch_description: "",
};

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
  searchResultsPanel: document.getElementById("searchResultsPanel"),
  searchResultsBody: document.getElementById("searchResultsBody"),
  branchSelectorPanel: document.getElementById("branchSelectorPanel"),
  branchSelectorSearch: document.getElementById("branchSelectorSearch"),
  branchSelector: document.getElementById("branchSelector"),
  emptyState: document.getElementById("emptyState"),
  statsPanel: document.getElementById("statsPanel"),
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
  receivablesOverdueValue: document.getElementById("receivablesOverdueValue"),
  receivablesBody: document.getElementById("receivablesBody"),
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
  detailedOrdersList: document.getElementById("detailedOrdersList"),
};

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

function formatDays(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${formatNumber(value)} d`;
}

function numberStateClass(value) {
  return Number(value || 0) < 0 ? " admin-number-negative" : "";
}

function findDetailedOrder(orderId) {
  return currentDetailedOrders.find((order) => String(order.order_id) === String(orderId)) || null;
}

function setAuthenticatedUI(me) {
  const authenticated = Boolean(me?.authenticated);
  els.loginPanel.hidden = authenticated;
  els.dashboardPanel.hidden = !authenticated;
  els.logoutBtn.hidden = !authenticated;

  if (!authenticated) {
    els.sessionInfo.textContent = "Δεν υπάρχει ενεργή συνεδρία admin.";
    return;
  }

  els.sessionInfo.textContent = `Συνδεδεμένος ως ${me.username}. API: ${API_BASE || "same-origin"}`;
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
        <td colspan="6" class="admin-table-empty">Δεν έχουν φορτωθεί ακόμη πωλήσεις προϊόντων.</td>
      </tr>
    `;
  }
}

function resetSearchResults() {
  currentSearchResults = [];
  if (els.searchResultsPanel) els.searchResultsPanel.hidden = true;
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
    setStatus(`Βρέθηκαν ${payload.total} αποτελέσματα.`, "ok");
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
        <td colspan="5" class="admin-table-empty">Δεν έχουν φορτωθεί ακόμη μηνιαίες πωλήσεις.</td>
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
  if (els.receivablesOpenValue) els.receivablesOpenValue.textContent = "-";
  if (els.receivablesOverdueValue) els.receivablesOverdueValue.textContent = "-";
  if (els.receivablesBody) {
    els.receivablesBody.innerHTML = `
      <tr>
        <td colspan="7" class="admin-table-empty">Δεν έχουν φορτωθεί ακόμη υπόλοιπα.</td>
      </tr>
    `;
  }
}

function resetStats() {
  resetBranchSelector();
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
  els.recentOrdersBody.innerHTML = `
    <tr>
      <td colspan="7" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  currentDetailedOrders = [];
  selectedOrderId = null;
  els.detailedOrdersList.innerHTML = `
    <article class="admin-order-card admin-order-empty">
      Επιλέξτε μια παραγγελία από τον πίνακα για να δείτε τις αναλυτικές γραμμές.
    </article>
  `;
  els.emptyState.hidden = false;
  els.statsPanel.hidden = true;
}

function renderBranchSelector(customerCode, branches = [], selectedBranchCode = "") {
  currentCustomerCode = customerCode || null;
  currentBranchCode = selectedBranchCode || "";

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
    els.branchSelectorSearch.disabled = false;
    els.branchSelectorSearch.value = "";
  }
  renderFilteredBranchOptions(items, selectedBranchCode);
}

function formatAggregationLevelLabel(level) {
  if (level === "branch") return "υποκατάστημα";
  if (level === "customer") return "πελάτης";
  return level || "";
}

function renderSearchResults(items, filters = {}) {
  currentSearchResults = Array.isArray(items) ? items : [];
  if (els.searchResultsPanel) els.searchResultsPanel.hidden = false;
  if (!els.searchResultsBody) return;

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
        Επιλέξτε μια παραγγελία από τον πίνακα για να δείτε τις αναλυτικές γραμμές.
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
              <td>${escapeHtml(`${line.discount_pct}%`)}</td>
              <td>${escapeHtml(formatMoney(line.line_net_value))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="6" class="admin-table-empty">Δεν υπάρχουν γραμμές παραγγελίας.</td>
        </tr>
      `;

  els.detailedOrdersList.innerHTML = `
    <article class="admin-order-card admin-order-card-active">
      <div class="admin-order-head">
        <div>
          <h3>Παραγγελία #${escapeHtml(selectedOrder.order_id)}</h3>
          <p>${escapeHtml(formatDateTime(selectedOrder.created_at))}</p>
        </div>
        <div class="admin-order-kpis">
          <span>${escapeHtml(formatNumber(selectedOrder.total_lines))} γραμμές</span>
          <span>${escapeHtml(formatNumber(selectedOrder.total_pieces))} τεμ.</span>
          <strong>${escapeHtml(formatMoney(selectedOrder.total_net_value))}</strong>
        </div>
      </div>
      <div class="admin-order-note">${escapeHtml(selectedOrder.notes || "Χωρίς σημειώσεις")}</div>
      <div class="admin-order-meta">
        <span>Μ. έκπτωση: ${escapeHtml(`${selectedOrder.average_discount_pct}%`)}</span>
      </div>
      <div class="admin-table-wrap admin-order-table-wrap">
        <table class="admin-table admin-order-table">
          <thead>
            <tr>
              <th>Κωδικός</th>
              <th>Περιγραφή</th>
              <th>Τεμάχια</th>
              <th>Τιμή</th>
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
        <td>Σύνολο</td>
        ${totalCells}
        <td class="admin-table-number admin-monthly-total-cell${numberStateClass(grandTotal)}">${escapeHtml(formatMoney(grandTotal))}</td>
      </tr>
    `;
  }
}

function renderReceivables(receivables) {
  const items = Array.isArray(receivables?.items) ? receivables.items : [];
  els.receivablesOpenValue.textContent = formatMoney(receivables?.open_balance);
  els.receivablesOverdueValue.textContent = formatMoney(receivables?.overdue_balance);

  els.receivablesBody.innerHTML = items.length
    ? items
        .map((item) => {
      const status = item.is_overdue ? "overdue" : item.status || "open";
      const statusLabel = status === "overdue" ? "ληξιπρόθεσμο" : status === "open" ? "ανοιχτό" : status;
          return `
            <tr>
              <td>${escapeHtml(item.document_no)}</td>
              <td>${escapeHtml(formatDate(item.document_date))}</td>
              <td>${escapeHtml(formatDate(item.due_date))}</td>
              <td>${escapeHtml(formatMoney(item.amount_total))}</td>
              <td>${escapeHtml(formatMoney(item.amount_paid))}</td>
              <td>${escapeHtml(formatMoney(item.open_balance))}</td>
              <td>${escapeHtml(statusLabel)}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="7" class="admin-table-empty">Δεν υπάρχουν ανοιχτά υπόλοιπα για αυτό το κατάστημα.</td>
        </tr>
      `;
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
          <td colspan="6" class="admin-table-empty">Δεν βρέθηκαν πωλήσεις προϊόντων για αυτό το κατάστημα.</td>
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

function renderStats(data) {
  const customer = data?.customer || {};
  const summary = data?.summary || {};
  const monthlySales = data?.monthly_sales || {};
  const productSales = data?.product_sales || {};
  const receivables = data?.receivables || {};
  const availableBranches = Array.isArray(data?.available_branches) ? data.available_branches : [];
  const topProductsByQty = Array.isArray(data?.top_products_by_qty) ? data.top_products_by_qty : [];
  const topProductsByValue = Array.isArray(data?.top_products_by_value) ? data.top_products_by_value : [];
  const recentOrders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];

  currentDetailedOrders = Array.isArray(data?.detailed_orders) ? data.detailed_orders : [];
  currentProductSales = Array.isArray(productSales.items) ? productSales.items : [];
  selectedOrderId = null;
  currentProductSalesPage = 1;

  const metaParts = [customer.code, customer.email];
  if (customer.branch_code) {
    metaParts.push(`υποκ.: ${customer.branch_code}`);
  }
  if (customer.branch_description) {
    metaParts.push(customer.branch_description);
  }
  if (customer.aggregation_level) {
    metaParts.push(`επίπεδο: ${formatAggregationLevelLabel(customer.aggregation_level)}`);
  }
  if (customer.chain_name) {
    metaParts.push(`αλυσίδα: ${customer.chain_name}`);
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
  els.lastOrderDateValue.textContent = formatDateTime(summary.last_order_date);
  renderBranchSelector(customer.code, availableBranches, customer.branch_code || "");

  renderMonthlySales(monthlySales);
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
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν top προϊόντα σε τεμάχια.</td>
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
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν top προϊόντα σε αξία.</td>
        </tr>
      `;

  els.recentOrdersBody.innerHTML = recentOrders.length
    ? recentOrders
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.order_id)}</td>
              <td>${escapeHtml(formatDateTime(item.created_at))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_lines))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td class="admin-table-number">${escapeHtml(`${item.average_discount_pct}%`)}</td>
              <td class="admin-table-action">
                <button
                  type="button"
                  class="btn ghost admin-order-select"
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
          <td colspan="7" class="admin-table-empty">Δεν βρέθηκαν πρόσφατες παραγγελίες.</td>
        </tr>
      `;

  renderSelectedOrderDetails();
  els.emptyState.hidden = true;
  els.statsPanel.hidden = false;
  setSearchPanelCollapsed(true);
}

async function refreshSession(options = {}) {
  try {
    const me = await apiFetch("/api/admin/me", { method: "GET" });
    setAuthenticatedUI(me);

    if (!me.authenticated && !options.silent) {
      setStatus("Συνδεθείτε για να δείτε στατιστικά πελατών.", "info");
    }

    return me;
  } catch (error) {
    setAuthenticatedUI({ authenticated: false });
    if (!options.silent) {
      setStatus(`Αποτυχία σύνδεσης με το backend: ${error.message}`, "error");
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
    setStatus("Συμπληρώστε username και password.", "error");
    return;
  }

  els.loginBtn.disabled = true;

  try {
    const result = await apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    setAuthenticatedUI(result);
    resetSearchSuggestions();
    resetSearchResults();
    resetStats();
    setSearchPanelCollapsed(false);
    els.password.value = "";
    focusPrimarySearchField();
    setStatus("Η σύνδεση ολοκληρώθηκε.", "ok");
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
    setStatus("Η αποσύνδεση ολοκληρώθηκε.", "ok");
  } catch (error) {
    setStatus(`Η αποσύνδεση απέτυχε: ${error.message}`, "error");
  } finally {
    els.logoutBtn.disabled = false;
  }
}

async function fetchCustomerStats(customerCode, branchCode = "", scopeFilters = currentCustomerSearchFilters) {
  setStatus("");

  if (!customerCode) {
    setStatus("Δώστε κωδικό πελάτη.", "error");
    els.customerCodeQuery.focus();
    return;
  }

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
    const payload = await apiFetch(
      `/api/admin/customers/${encodeURIComponent(customerCode)}/stats${params.toString() ? `?${params.toString()}` : ""}`,
      { method: "GET" },
    );
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
      `Φορτώθηκαν τα στατιστικά για τον κωδικό ${customerCode}${currentBranchCode ? ` / υποκ. ${currentBranchCode}` : ""}.`,
      "ok",
    );
  } catch (error) {
    resetStats();
    setStatus(`Η φόρτωση στατιστικών απέτυχε: ${error.message}`, "error");
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

  els.searchCustomersBtn.disabled = true;
  try {
    setCurrentCustomerSearchFilters(filters);
    resetSearchSuggestions();
    await performCustomerSearch(filters, {
      limit: 20,
      renderTable: true,
      renderSuggestions: false,
      silent: false,
    });
  } catch (error) {
    resetSearchResults();
    setStatus(`Η αναζήτηση πελάτη απέτυχε: ${error.message}`, "error");
  } finally {
    els.searchCustomersBtn.disabled = false;
  }
}

function clearCustomerStats() {
  if (els.customerNameQuery) els.customerNameQuery.value = "";
  if (els.customerCodeQuery) els.customerCodeQuery.value = "";
  if (els.branchCodeQuery) els.branchCodeQuery.value = "";
  if (els.branchDescriptionQuery) els.branchDescriptionQuery.value = "";
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
els.recentOrdersBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-id]");
  if (!button) return;

  selectedOrderId = button.getAttribute("data-order-id");
  renderSelectedOrderDetails();

  els.recentOrdersBody.querySelectorAll("[data-order-id]").forEach((candidate) => {
    const isActive = candidate.getAttribute("data-order-id") === String(selectedOrderId);
    candidate.classList.toggle("is-active", isActive);
  });
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
