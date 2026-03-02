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
  if (isLocal && window.location.port && window.location.port !== "8000") {
    return `http://${host}:8000`;
  }

  return "";
}

const API_BASE = resolveApiBase();

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
  lastOrderDateValue: document.getElementById("lastOrderDateValue"),
  topProductsBody: document.getElementById("topProductsBody"),
  recentOrdersBody: document.getElementById("recentOrdersBody"),
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
  els.lastOrderDateValue.textContent = "-";
  els.topProductsBody.innerHTML = `
    <tr>
      <td colspan="4" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  els.recentOrdersBody.innerHTML = `
    <tr>
      <td colspan="4" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  els.emptyState.hidden = false;
  els.statsPanel.hidden = true;
}

function renderStats(data) {
  const customer = data?.customer || {};
  const summary = data?.summary || {};
  const topProducts = Array.isArray(data?.top_products) ? data.top_products : [];
  const recentOrders = Array.isArray(data?.recent_orders) ? data.recent_orders : [];

  els.customerNameHeading.textContent = customer.name || "Άγνωστος πελάτης";
  els.customerMeta.textContent = [customer.code, customer.email].filter(Boolean).join(" • ") || "-";
  els.totalOrdersValue.textContent = String(summary.total_orders ?? 0);
  els.totalPiecesValue.textContent = String(summary.total_pieces ?? 0);
  els.lastOrderDateValue.textContent = formatDate(summary.last_order_date);

  els.topProductsBody.innerHTML = topProducts.length
    ? topProducts
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td>${escapeHtml(item.qty)}</td>
              <td>${escapeHtml(item.orders)}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="4" class="admin-table-empty">Δεν βρέθηκαν top προϊόντα για τον πελάτη.</td>
        </tr>
      `;

  els.recentOrdersBody.innerHTML = recentOrders.length
    ? recentOrders
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.order_id)}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td>${escapeHtml(item.total_lines)}</td>
              <td>${escapeHtml(item.total_pieces)}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="4" class="admin-table-empty">Δεν υπάρχουν πρόσφατες παραγγελίες.</td>
        </tr>
      `;

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

resetStats();
refreshSession({ silent: false }).then((me) => {
  if (me.authenticated) {
    els.customerCode.focus();
  } else {
    els.username.focus();
  }
});
