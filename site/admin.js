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
let currentDetailedOrders = [];
let selectedOrderId = null;

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
  customerSearchForm: document.getElementById("customerSearchForm"),
  customerCode: document.getElementById("customerCode"),
  loadStatsBtn: document.getElementById("loadStatsBtn"),
  clearStatsBtn: document.getElementById("clearStatsBtn"),
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
  return `${formatNumber(value)} ημ.`;
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
    els.sessionInfo.textContent = "Δεν υπάρχει ενεργή σύνδεση.";
    return;
  }

  els.sessionInfo.textContent = `Συνδεδεμένος ως ${me.username}. API: ${API_BASE || "same-origin"}`;
}

function resetStats() {
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
      Επιλέξτε μια παραγγελία για να εμφανιστεί η αναλυτική προβολή.
    </article>
  `;
  els.emptyState.hidden = false;
  els.statsPanel.hidden = true;
}

function renderSelectedOrderDetails() {
  const selectedOrder = findDetailedOrder(selectedOrderId);
  if (!selectedOrder) {
    els.detailedOrdersList.innerHTML = `
      <article class="admin-order-card admin-order-empty">
        Επιλέξτε μια παραγγελία για να εμφανιστεί η αναλυτική προβολή.
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
          <td colspan="6" class="admin-table-empty">Δεν υπάρχουν γραμμές.</td>
        </tr>
      `;

  els.detailedOrdersList.innerHTML = `
    <article class="admin-order-card admin-order-card-active">
      <div class="admin-order-head">
        <div>
          <h3>Order #${escapeHtml(selectedOrder.order_id)}</h3>
          <p>${escapeHtml(formatDate(selectedOrder.created_at))}</p>
        </div>
        <div class="admin-order-kpis">
          <span>${escapeHtml(formatNumber(selectedOrder.total_lines))} γραμμές</span>
          <span>${escapeHtml(formatNumber(selectedOrder.total_pieces))} τεμ.</span>
          <strong>${escapeHtml(formatMoney(selectedOrder.total_net_value))}</strong>
        </div>
      </div>
      <div class="admin-order-note">${escapeHtml(selectedOrder.notes || "Χωρίς σχόλια")}</div>
      <div class="admin-order-meta">
        <span>Μ. έκπτωση: ${escapeHtml(`${selectedOrder.average_discount_pct}%`)}</span>
      </div>
      <div class="admin-table-wrap admin-order-table-wrap">
        <table class="admin-table admin-order-table">
          <thead>
            <tr>
              <th>Κωδ.</th>
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

function renderStats(data) {
  const customer = data?.customer || {};
  const summary = data?.summary || {};
  const topProductsByQty = Array.isArray(data?.top_products_by_qty) ? data.top_products_by_qty : [];
  const topProductsByValue = Array.isArray(data?.top_products_by_value) ? data.top_products_by_value : [];
  const recentOrders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];
  currentDetailedOrders = Array.isArray(data?.detailed_orders) ? data.detailed_orders : [];
  selectedOrderId = null;

  els.customerNameHeading.textContent = customer.name || "Άγνωστος πελάτης";
  els.customerMeta.textContent = [customer.code, customer.email].filter(Boolean).join(" • ") || "-";
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

  els.topProductsQtyBody.innerHTML = topProductsByQty.length
    ? topProductsByQty
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td>${escapeHtml(formatNumber(item.qty))}</td>
              <td>${escapeHtml(formatNumber(item.orders))}</td>
              <td>${escapeHtml(formatMoney(item.revenue))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν top προϊόντα για τον πελάτη.</td>
        </tr>
      `;

  els.topProductsValueBody.innerHTML = topProductsByValue.length
    ? topProductsByValue
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(formatNumber(item.qty))}</td>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td>${escapeHtml(formatMoney(item.revenue))}</td>
              <td>${escapeHtml(formatMoney(item.avg_unit_price))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν value προϊόντα για τον πελάτη.</td>
        </tr>
      `;

  els.recentOrdersBody.innerHTML = recentOrders.length
    ? recentOrders
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.order_id)}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td>${escapeHtml(formatNumber(item.total_lines))}</td>
              <td>${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td>${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td>${escapeHtml(`${item.average_discount_pct}%`)}</td>
              <td>
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
          <td colspan="7" class="admin-table-empty">Δεν υπάρχουν πρόσφατες παραγγελίες.</td>
        </tr>
      `;
  renderSelectedOrderDetails();

  els.emptyState.hidden = true;
  els.statsPanel.hidden = false;
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
      setStatus(`Αδυναμία επικοινωνίας με το backend: ${error.message}`, "error");
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
    resetStats();
    els.password.value = "";
    els.customerCode.focus();
    setStatus("Η σύνδεση ολοκληρώθηκε.", "ok");
  } catch (error) {
    setStatus(`Αποτυχία σύνδεσης: ${error.message}`, "error");
  } finally {
    els.loginBtn.disabled = false;
  }
}

async function handleLogout() {
  els.logoutBtn.disabled = true;

  try {
    await apiFetch("/api/admin/logout", { method: "POST" });
    setAuthenticatedUI({ authenticated: false });
    resetStats();
    els.username.focus();
    setStatus("Η αποσύνδεση ολοκληρώθηκε.", "ok");
  } catch (error) {
    setStatus(`Αποτυχία αποσύνδεσης: ${error.message}`, "error");
  } finally {
    els.logoutBtn.disabled = false;
  }
}

async function loadCustomerStats(event) {
  event.preventDefault();
  setStatus("");

  const customerCode = (els.customerCode.value || "").trim();
  if (!customerCode) {
    setStatus("Δώστε κωδικό πελάτη.", "error");
    els.customerCode.focus();
    return;
  }

  els.loadStatsBtn.disabled = true;

  try {
    const payload = await apiFetch(
      `/api/admin/customers/${encodeURIComponent(customerCode)}/stats`,
      { method: "GET" },
    );
    renderStats(payload);
    setStatus(`Φορτώθηκαν στατιστικά για ${customerCode}.`, "ok");
  } catch (error) {
    resetStats();
    setStatus(`Αποτυχία φόρτωσης πελάτη: ${error.message}`, "error");
  } finally {
    els.loadStatsBtn.disabled = false;
  }
}

function clearCustomerStats() {
  els.customerCode.value = "";
  resetStats();
  setStatus("");
  els.customerCode.focus();
}

els.loginForm?.addEventListener("submit", handleLogin);
els.logoutBtn?.addEventListener("click", handleLogout);
els.customerSearchForm?.addEventListener("submit", loadCustomerStats);
els.clearStatsBtn?.addEventListener("click", clearCustomerStats);
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
refreshSession({ silent: false }).then((me) => {
  if (me.authenticated) {
    els.customerCode.focus();
  } else {
    els.username.focus();
  }
});
