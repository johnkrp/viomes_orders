const token = new URLSearchParams(location.search).get("t") || "demo-token";

const API_BASE = "";
const ORDERS_EMAIL = "sales@viomes.gr";
const PAGE_SIZE = 20;
const PLACEHOLDER_PACKSHOT =
  "https://via.placeholder.com/300x300?text=Packshot";
const PLACEHOLDER_CART_IMAGE =
  "https://via.placeholder.com/80x80?text=Packshot";
const ORDER_FORM_STATE_KEY = "viomes.orderForm.state.v1";
const ORDER_FORM_IMPORT_KEY = "viomes.orderForm.import.v1";
const ORDER_FORM_RANKING_KEY = "viomes.orderForm.ranking.v1";

let allCatalog = [];
let catalog = [];
let currentPage = 1;
let lastQuery = "";
let msgTimer = null;
let lastOrder = null;
let draftCatalogInputs = new Map();
let restoredOrderFormState = loadOrderFormState();
let importedOrderDraft = loadImportedOrderDraft();
let importedCatalogCodes = new Set();
let rankedCatalogCodes = [];
let productHistoryMap = {};

const cart = new Map();

let actorState = { role: null, customerCode: null, customerName: null };
let selectedStaffCustomer = null;
let customerPickerSearchToken = 0;
let customerBranches = [];
const NO_SUBSTORE_OPTION = {
  value: "",
  code: "",
  label: "— Χωρίς υποκατάστημα —",
  text: "— Χωρίς υποκατάστημα —",
};
let customerSubstoreOptions = [NO_SUBSTORE_OPTION];

const els = {
  q: document.getElementById("q"),
  toolbarQty: document.getElementById("toolbarQty"),
  toolbarAddBtn: document.getElementById("toolbarAddBtn"),
  preparedAddBtn: document.getElementById("preparedAddBtn"),
  toolbarMsg: document.getElementById("toolbarMsg"),
  catalog: document.getElementById("catalog"),
  cart: document.getElementById("cart"),
  countPill: document.getElementById("countPill"),
  catalogStatus: document.getElementById("catalogStatus"),
  stockRefreshBtn: document.getElementById("stockRefreshBtn"),
  stockAsOf: document.getElementById("stockAsOf"),
  notes: document.getElementById("notes"),
  desiredDeliveryDate: document.getElementById("desiredDeliveryDate"),
  customerName: document.getElementById("customerName"),
  customerSubstore: document.getElementById("customerSubstore"),
  customerOrderNo: document.getElementById("customerOrderNo"),
  customerEmail: document.getElementById("customerEmail"),
  clearBtn: document.getElementById("clearBtn"),
  downloadExcelBtn: document.getElementById("downloadExcelBtn"),
  submitBtn: document.getElementById("submitBtn"),
  submitToAdminBtn: document.getElementById("submitToAdminBtn"),
  submitStatus: document.getElementById("submitStatus"),
  reloadBtn: document.getElementById("reloadBtn"),
  pager: document.getElementById("pager"),
  loginPanel: document.getElementById("loginPanel"),
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  loginStatus: document.getElementById("loginStatus"),
  appMain: document.getElementById("appMain"),
  adminLinkBtn: document.getElementById("adminLinkBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  customerSubstoreField: document.getElementById("customerSubstoreField"),
  customerPickerPanel: document.getElementById("customerPickerPanel"),
  customerPickerQuery: document.getElementById("customerPickerQuery"),
  customerPickerResults: document.getElementById("customerPickerResults"),
  customerSubstoreQuery: document.getElementById("customerSubstoreQuery"),
  customerSubstoreResults: document.getElementById("customerSubstoreResults"),
  customerSubstoreSpinner: document.getElementById("customerSubstoreSpinner"),
  customerIdentityDisplay: document.getElementById("customerIdentityDisplay"),
};

const imgModal = document.getElementById("imgModal");
const imgModalImg = document.getElementById("imgModalImg");
const imgModalCap = document.getElementById("imgModalCap");
const submitModal = document.getElementById("submitModal");
const sendGmailBtn = document.getElementById("sendGmailBtn");
const sendMailtoBtn = document.getElementById("sendMailtoBtn");

// A 401 on these is an expected answer, not "your session died": the login
// endpoints 401 while probing staff-vs-customer credentials, and the /me
// endpoints answer 200 { authenticated: false } (never 401) — but list them
// too so a future change can't accidentally bounce the auth check itself.
const NO_BOUNCE_ON_401 = new Set([
  "/api/admin/login",
  "/api/customer/login",
  "/api/admin/me",
  "/api/customer/me",
]);

// The session expired while the tab was open. Send the browser to the login
// page (which the server also gates) rather than letting the failed call
// surface as an inline "σφάλμα". Returns true if it initiated a navigation.
function bounceIfUnauthorized(response, requestUrl) {
  if (response.status !== 401) return false;
  if (NO_BOUNCE_ON_401.has(requestUrl)) return false;
  const next = encodeURIComponent(location.pathname + location.search);
  window.location.assign(`/login?next=${next}`);
  return true;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });
  if (bounceIfUnauthorized(response, url)) {
    return { ok: false, status: 401, payload: null };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }
  return { ok: response.ok, status: response.status, payload };
}

async function checkAuthState() {
  const [adminResult, customerResult] = await Promise.all([
    fetchJson("/api/admin/me"),
    fetchJson("/api/customer/me"),
  ]);

  if (adminResult.payload?.authenticated) {
    return {
      role: "staff",
      username: adminResult.payload.username,
      customerCode: null,
      customerName: null,
    };
  }

  if (customerResult.payload?.authenticated) {
    return {
      role: "customer",
      username: customerResult.payload.username,
      customerCode: customerResult.payload.customer_code,
      customerName: customerResult.payload.customer_name || null,
    };
  }

  return {
    role: null,
    username: null,
    customerCode: null,
    customerName: null,
  };
}

function setLoginStatus(message, kind = "") {
  if (!els.loginStatus) return;
  els.loginStatus.textContent = message || "";
  els.loginStatus.className = kind ? `status ${kind}` : "status";
}

function applyRoleUi(actor) {
  actorState = actor;

  const isAuthenticated = Boolean(actor.role);
  if (els.loginPanel) els.loginPanel.hidden = isAuthenticated;
  if (els.appMain) els.appMain.hidden = !isAuthenticated;
  if (els.logoutBtn) els.logoutBtn.hidden = !isAuthenticated;

  if (!isAuthenticated) return;

  const isStaff = actor.role === "staff";
  if (els.adminLinkBtn) els.adminLinkBtn.hidden = !isStaff;
  if (els.customerPickerPanel) els.customerPickerPanel.hidden = !isStaff;
  // Branch selection matters most for customers, not least: a chain ordering for itself
  // still has to say which store the delivery is for. It stays visible for both roles.
  if (els.customerSubstoreField) els.customerSubstoreField.hidden = false;

  if (els.customerIdentityDisplay) {
    els.customerIdentityDisplay.hidden = isStaff;
    if (!isStaff) {
      els.customerIdentityDisplay.textContent = actor.customerName
        ? `Παραγγελία για: ${actor.customerName} (${actor.customerCode})`
        : `Παραγγελία για κωδικό πελάτη: ${actor.customerCode}`;
    }
  }

  if (!isStaff && els.customerName) {
    els.customerName.value = actor.customerName || "";
  }

  // A customer has no picker to trigger the load, so fetch their own branches directly.
  if (!isStaff && actor.customerCode) {
    loadBranchesInto(actor.customerCode).catch(() => {
      populateCustomerSubstoreOptions([]);
    });
  }
}

function renderCustomerPickerResults(items) {
  if (!els.customerPickerResults) return;
  if (!items.length) {
    els.customerPickerResults.innerHTML = "";
    return;
  }
  els.customerPickerResults.innerHTML = items
    .map(
      (item) => `
        <button type="button" class="customer-picker-result" data-code="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">
          <span class="customer-picker-result-name">${escapeHtml(item.name)}</span>
          <span class="customer-picker-result-meta">${escapeHtml(item.code)}${item.branch_description ? ` · ${escapeHtml(item.branch_description)}` : ""}</span>
        </button>
      `,
    )
    .join("");
}

function customerPickerLabel(code, name) {
  const cleanCode = String(code || "").trim();
  const cleanName = String(name || "").trim();
  if (cleanName && cleanCode) return `${cleanName} (${cleanCode})`;
  return cleanName || cleanCode;
}

function clearSelectedStaffCustomer() {
  selectedStaffCustomer = null;
  customerBranches = [];
  if (els.customerName) els.customerName.value = "";
  populateCustomerSubstoreOptions([]);
}

async function performCustomerPickerSearch(query) {
  const trimmed = query.trim();
  const searchToken = ++customerPickerSearchToken;
  if (!trimmed) {
    renderCustomerPickerResults([]);
    return;
  }

  const [byName, byCode] = await Promise.all([
    fetchJson(
      `/api/admin/customers/search?customer_name=${encodeURIComponent(trimmed)}&limit=10`,
    ),
    fetchJson(
      `/api/admin/customers/search?customer_code=${encodeURIComponent(trimmed)}&limit=10`,
    ),
  ]);

  if (searchToken !== customerPickerSearchToken) return;

  const merged = new Map();
  for (const item of byName.payload?.items || []) merged.set(item.code, item);
  for (const item of byCode.payload?.items || []) merged.set(item.code, item);

  renderCustomerPickerResults([...merged.values()]);
}

function setCustomerSubstoreValue(value) {
  if (!els.customerSubstore) return;
  const trimmed = value || "";
  const match = customerSubstoreOptions.find((opt) => opt.value === trimmed);
  els.customerSubstore.value = match ? match.value : "";
  if (els.customerSubstoreQuery) {
    els.customerSubstoreQuery.value = match && match.value ? match.label : "";
  }
  renderCustomerSubstoreResults([]);
}

function buildCustomerSubstoreOptions(branches) {
  const options = [NO_SUBSTORE_OPTION];
  for (const branch of branches) {
    const label = branch.branch_description || branch.branch_code || "";
    if (!label) continue;
    const text = branch.branch_code && branch.branch_code !== label
      ? `${label} · ${branch.branch_code}`
      : label;
    // branch_code is byte-identical to ES1's ESGOSites.Code and is what the ΠΑΡ writer
    // resolves the delivery site from (the free-text label alone only resolves ~85%).
    options.push({ value: label, code: branch.branch_code || "", label, text });
  }
  return options;
}

function populateCustomerSubstoreOptions(branches) {
  if (!els.customerSubstore) return;
  customerSubstoreOptions = buildCustomerSubstoreOptions(branches);
  els.customerSubstore.value = "";
  if (els.customerSubstoreQuery) els.customerSubstoreQuery.value = "";
  renderCustomerSubstoreResults([]);
}

function renderCustomerSubstoreResults(options) {
  if (!els.customerSubstoreResults) return;
  if (!options.length) {
    els.customerSubstoreResults.innerHTML = "";
    return;
  }
  els.customerSubstoreResults.innerHTML = options
    .map(
      (opt) => `
        <button type="button" class="customer-picker-result" data-value="${escapeHtml(opt.value)}">
          <span class="customer-picker-result-name">${escapeHtml(opt.label)}</span>
        </button>
      `,
    )
    .join("");
}

function filterCustomerSubstoreOptions(query) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return customerSubstoreOptions;
  return customerSubstoreOptions.filter((opt) =>
    opt.text.toLowerCase().includes(trimmed),
  );
}

function selectCustomerSubstoreOption(value) {
  const match = customerSubstoreOptions.find((opt) => opt.value === value);
  if (els.customerSubstore) els.customerSubstore.value = match?.value || "";
  if (els.customerSubstoreQuery) {
    els.customerSubstoreQuery.value = match?.value ? match.label : "";
  }
  renderCustomerSubstoreResults([]);
  saveOrderFormState();
}

async function loadCustomerBranches(code) {
  customerBranches = [];
  // Dedicated branches endpoint. The admin stats route computes an entire analytics
  // payload just to expose this list (~53s for Σκλαβενίτης) and is staff-only besides,
  // so a customer session could never load its own branches through it.
  const response = await fetchJson(
    `/api/order-form/customers/${encodeURIComponent(code)}/branches`,
  );
  customerBranches = Array.isArray(response.payload?.available_branches)
    ? response.payload.available_branches
    : [];
}

async function loadBranchesInto(code) {
  populateCustomerSubstoreOptions([]);
  if (els.customerSubstoreQuery) els.customerSubstoreQuery.disabled = true;
  if (els.customerSubstoreSpinner) els.customerSubstoreSpinner.hidden = false;
  try {
    await loadCustomerBranches(code);
    populateCustomerSubstoreOptions(customerBranches);
  } finally {
    if (els.customerSubstoreQuery) els.customerSubstoreQuery.disabled = false;
    if (els.customerSubstoreSpinner) els.customerSubstoreSpinner.hidden = true;
  }
}

async function selectStaffCustomer(code, name) {
  selectedStaffCustomer = { code, name };
  if (els.customerName) els.customerName.value = name;
  if (els.customerPickerResults) els.customerPickerResults.innerHTML = "";
  if (els.customerPickerQuery) {
    els.customerPickerQuery.value = customerPickerLabel(code, name);
  }
  await loadBranchesInto(code);
  saveOrderFormState();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = els.loginUsername?.value?.trim() || "";
  const password = els.loginPassword?.value || "";
  if (!username || !password) return;

  setLoginStatus("Σύνδεση...", "");

  const adminResponse = await fetchJson("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (adminResponse.status !== 200) {
    const customerResponse = await fetchJson("/api/customer/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (customerResponse.status !== 200) {
      setLoginStatus("Λάθος στοιχεία σύνδεσης.", "error");
      return;
    }
  }

  setLoginStatus("", "");
  if (els.loginPassword) els.loginPassword.value = "";
  await bootstrapApp();
}

let customerPickerDebounceTimer = null;
els.customerPickerQuery?.addEventListener("input", () => {
  if (selectedStaffCustomer) {
    clearSelectedStaffCustomer();
  }
  clearTimeout(customerPickerDebounceTimer);
  customerPickerDebounceTimer = setTimeout(() => {
    performCustomerPickerSearch(els.customerPickerQuery.value || "");
  }, 250);
});

els.customerPickerResults?.addEventListener("click", (event) => {
  const button = event.target.closest(".customer-picker-result");
  if (!button) return;
  selectStaffCustomer(button.dataset.code, button.dataset.name);
});

els.loginForm?.addEventListener("submit", handleLoginSubmit);

els.logoutBtn?.addEventListener("click", async () => {
  const logoutUrl =
    actorState.role === "staff" ? "/api/admin/logout" : "/api/customer/logout";
  await fetchJson(logoutUrl, { method: "POST" });
  // Drop the unload/pagehide listeners first so they can't re-persist the
  // still-populated DOM fields into sessionStorage after we clear it below.
  window.removeEventListener("pagehide", saveOrderFormState);
  window.removeEventListener("beforeunload", saveOrderFormState);
  try {
    window.sessionStorage.removeItem(ORDER_FORM_STATE_KEY);
    window.sessionStorage.removeItem(ORDER_FORM_IMPORT_KEY);
    window.sessionStorage.removeItem(ORDER_FORM_RANKING_KEY);
  } catch (_error) {
    // Ignore storage failures; the reload below still starts a clean session.
  }
  window.location.reload();
});

function loadOrderFormState() {
  try {
    const raw = window.sessionStorage.getItem(ORDER_FORM_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function loadImportedOrderDraft() {
  try {
    const raw = window.sessionStorage.getItem(ORDER_FORM_IMPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function loadOrderFormRankingDraft() {
  try {
    const raw = window.sessionStorage.getItem(ORDER_FORM_RANKING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function clearImportedOrderDraft() {
  try {
    window.sessionStorage.removeItem(ORDER_FORM_IMPORT_KEY);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function clearOrderFormRankingDraft() {
  try {
    window.sessionStorage.removeItem(ORDER_FORM_RANKING_KEY);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function saveOrderFormState() {
  try {
    const isStaff = actorState.role === "staff";
    const state = {
      q: els.q?.value || "",
      toolbarQty: els.toolbarQty?.value || "",
      customerCode: isStaff ? selectedStaffCustomer?.code || "" : "",
      customerName: isStaff ? els.customerName?.value || "" : "",
      customerSubstore: isStaff ? els.customerSubstore?.value || "" : "",
      customerOrderNo: els.customerOrderNo?.value || "",
      customerEmail: els.customerEmail?.value || "",
      notes: els.notes?.value || "",
      currentPage,
      lastQuery,
      cartItems: Array.from(cart.values()),
      draftCatalogInputs: Object.fromEntries(draftCatalogInputs.entries()),
      importedCatalogCodes: Array.from(importedCatalogCodes),
      rankedCatalogCodes: [...rankedCatalogCodes],
    };
    window.sessionStorage.setItem(ORDER_FORM_STATE_KEY, JSON.stringify(state));
  } catch (_error) {
    // Ignore storage failures and keep the page usable.
  }
}

function restoreCartFromState(state) {
  cart.clear();
  const items = Array.isArray(state?.cartItems) ? state.cartItems : [];
  items.forEach((item) => {
    if (!item?.code) return;
    cart.set(item.code, item);
  });
}

function restoreOrderFormFields(state) {
  if (els.q) els.q.value = state?.q || "";
  if (els.toolbarQty) els.toolbarQty.value = state?.toolbarQty || "";
  if (actorState.role === "staff") {
    const customerCode = String(state?.customerCode || "").trim();
    const customerName = String(state?.customerName || "").trim();
    if (customerCode) {
      selectedStaffCustomer = { code: customerCode, name: customerName };
      if (els.customerName) els.customerName.value = customerName;
      if (els.customerPickerQuery) {
        els.customerPickerQuery.value = customerPickerLabel(customerCode, customerName);
      }
      loadBranchesInto(customerCode)
        .then(() => setCustomerSubstoreValue(state?.customerSubstore || ""))
        .catch(() => populateCustomerSubstoreOptions([]));
    } else {
      clearSelectedStaffCustomer();
      if (els.customerPickerQuery) els.customerPickerQuery.value = "";
    }
  }
  if (els.customerOrderNo) els.customerOrderNo.value = state?.customerOrderNo || "";
  if (els.customerEmail) els.customerEmail.value = state?.customerEmail || "";
  if (els.notes) els.notes.value = state?.notes || "";
}

function restoreDraftCatalogInputs(state) {
  const rawEntries =
    state?.draftCatalogInputs && typeof state.draftCatalogInputs === "object"
      ? Object.entries(state.draftCatalogInputs)
      : [];
  draftCatalogInputs = new Map(
    rawEntries.map(([code, value]) => [code, value || {}]),
  );
}

function restoreImportedCatalogCodes(state) {
  const codes = Array.isArray(state?.importedCatalogCodes)
    ? state.importedCatalogCodes
    : [];
  importedCatalogCodes = new Set(
    codes.map((value) => String(value || "").trim()).filter(Boolean),
  );
}

function restoreRankedCatalogCodes(state) {
  const codes = Array.isArray(state?.rankedCatalogCodes)
    ? state.rankedCatalogCodes
    : [];
  rankedCatalogCodes = codes
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function buildCartItemFromCatalog(product, qty, fallbackDescription = "") {
  return {
    code: product.code,
    title:
      product.description ||
      productTitle(product) ||
      fallbackDescription ||
      product.code,
    qty,
    image_url: product.image_url || "",
    pieces_per_package: product.pieces_per_package,
    volume_liters: getVolM3PerPiece(product),
    color: product.color || "",
  };
}

function buildFallbackCartItem(line) {
  return {
    code: line.code,
    title: line.description || line.code,
    qty: line.qty,
    image_url: "",
    pieces_per_package: 1,
    volume_liters: 0,
    color: "",
  };
}

// The substore <select> only carries options for the customer whose branches were
// last loaded. Without re-selecting the customer from an imported/ranked draft, its
// substore value has nothing to match and setCustomerSubstoreValue clears it to "".
async function applyDraftCustomerContext(draft) {
  if (els.customerName) els.customerName.value = draft.customerName || "";
  if (actorState?.role === "staff" && draft.customerCode) {
    await selectStaffCustomer(draft.customerCode, draft.customerName || "");
  }
  setCustomerSubstoreValue(
    draft.customerSubstore || draft.branchDescription || draft.branchCode || "",
  );
}

async function applyImportedOrderDraft(draft) {
  if (!draft) return;

  cart.clear();
  draftCatalogInputs.clear();
  importedCatalogCodes.clear();
  rankedCatalogCodes = [];
  if (els.q) els.q.value = "";
  if (els.toolbarQty) els.toolbarQty.value = "";
  await applyDraftCustomerContext(draft);
  if (els.customerEmail) els.customerEmail.value = draft.customerEmail || "";
  if (els.notes) els.notes.value = draft.notes || "";
  currentPage = 1;
  lastQuery = "";

  const lines = Array.isArray(draft.lines) ? draft.lines : [];
  let missingLines = 0;
  lines.forEach((line) => {
    if (!line?.code || Number(line?.qty || 0) <= 0) return;
    const product = findProductByCode(line.code);
    if (!product) {
      missingLines += 1;
      return;
    }

    const qty = Number(line.qty || 0);
    const piecesPerPack = Math.max(
      1,
      parseInt(product.pieces_per_package, 10) || 1,
    );
    importedCatalogCodes.add(product.code);
    draftCatalogInputs.set(product.code, {
      pieces: String(qty),
      packs: qty % piecesPerPack === 0 ? String(qty / piecesPerPack) : "",
    });
  });

  renderCart();
  applyCatalogView(1, "");
  setToolbarMsg(
    importedCatalogCodes.size
      ? `Φορτώθηκε η παραγγελία ${draft.sourceOrderId || ""} στον κατάλογο.${missingLines ? ` ${missingLines} γραμμές δεν βρέθηκαν.` : ""}`
      : "Δεν βρέθηκαν γραμμές ειδών για φόρτωση.",
    importedCatalogCodes.size ? "ok" : "error",
  );
  clearImportedOrderDraft();
  importedOrderDraft = null;
  saveOrderFormState();
}

async function applyCustomerRankingDraft(draft) {
  if (!draft) return;

  cart.clear();
  draftCatalogInputs.clear();
  importedCatalogCodes.clear();
  rankedCatalogCodes = Array.isArray(draft.rankedCodes)
    ? draft.rankedCodes
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];
  productHistoryMap =
    typeof draft.productHistoryMap === "object" && draft.productHistoryMap
      ? draft.productHistoryMap
      : {};

  if (els.q) els.q.value = "";
  if (els.toolbarQty) els.toolbarQty.value = "";
  await applyDraftCustomerContext(draft);
  if (els.customerEmail) els.customerEmail.value = draft.customerEmail || "";
  if (els.customerOrderNo) els.customerOrderNo.value = "";
  if (els.notes) els.notes.value = "";
  currentPage = 1;
  lastQuery = "";

  renderCart();
  applyCatalogView(1, "");
  setToolbarMsg(
    rankedCatalogCodes.length
      ? `Φορτώθηκε κατάταξη ειδών για τον πελάτη ${draft.customerName || draft.customerCode || ""}.`
      : "Δεν βρέθηκαν είδη για κατάταξη πελάτη.",
    rankedCatalogCodes.length ? "ok" : "error",
  );
  clearOrderFormRankingDraft();
  saveOrderFormState();
}

function rememberDraftCatalogInput(productCode, values = {}) {
  if (!productCode) return;
  const packs = String(values.packs || "").trim();
  const pieces = String(values.pieces || "").trim();

  if (!packs && !pieces) {
    draftCatalogInputs.delete(productCode);
  } else {
    draftCatalogInputs.set(productCode, { packs, pieces });
  }
  saveOrderFormState();
}

function applyDraftValuesToCatalogRow(product, packsInput, piecesInput) {
  const draft = draftCatalogInputs.get(product.code);
  if (!draft) return;

  if (packsInput) packsInput.value = draft.packs || "";
  if (piecesInput) piecesInput.value = draft.pieces || "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function buildHistoryBadge(orderCount) {
  if (!Number.isFinite(orderCount) || orderCount < 0) return "";

  if (orderCount === 0) {
    return '<span class="history-badge never-ordered" title="Ποτέ δεν παραγγέλθηκε">●</span>';
  } else if (orderCount === 1) {
    return '<span class="history-badge once-ordered" title="Παραγγέλθηκε 1 φορά">◐</span>';
  } else {
    return `<span class="history-badge many-times-ordered" title="Παραγγέλθηκε ${orderCount} φορές">${orderCount}</span>`;
  }
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toNum(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fallback;

  const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function fmtM3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";

  return n
    .toFixed(3)
    .replace(/\.000$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

// products.volume_liters is misnamed: it holds the volume in m³ of ONE piece (τεμάχιο)
// — the same "ν ΚΜΕΤ = 1 ΤΕΜ" figure ES1 stores on the item. It is NOT a per-package
// volume.
function getVolM3PerPiece(product) {
  const value =
    product?.volume_liters ??
    product?.volume_l ??
    product?.volumeLiters ??
    product?.volume ??
    0;
  return toNum(value, 0);
}

function calcVolumes(pieces, piecesPerPack, volumeM3PerPiece) {
  const qty = toNum(pieces, 0);
  const perPack = Math.max(1, parseInt(piecesPerPack, 10) || 1);
  const packages = qty / perPack;
  // Volume scales with pieces, not packages: a 6-piece carton is 6 × the piece volume.
  const volumeM3 = qty * toNum(volumeM3PerPiece, 0);
  return { packages, volumeM3 };
}

function productTitle(product) {
  const title = (product.title || "").trim();
  if (title) return title;

  const color = (product.color || "").trim();
  return color ? `${product.code} - ${color}` : `${product.code}`;
}

function matchScore(product, query) {
  const code = normalizeText(product.code || "");
  const description = normalizeText(product.description || "");
  const color = normalizeText(product.color || "");
  const haystack = `${code} ${description} ${color}`.trim();

  if (!query) return 9999;
  if (code.startsWith(query)) return 0;
  if (haystack.startsWith(query)) return 1;
  if (code.includes(query)) return 2;
  if (haystack.includes(query)) return 3;
  return 9999;
}

function setToolbarMsg(text, type = "info") {
  const el = els.toolbarMsg;
  if (!el) return;

  if (msgTimer) {
    clearTimeout(msgTimer);
    msgTimer = null;
  }

  if (!text) {
    el.classList.remove("show", "is-error", "is-ok", "is-info");
    el.innerHTML = "";
    return;
  }

  const icon = type === "error" ? "!" : type === "ok" ? "OK" : "i";

  el.classList.remove("is-error", "is-ok", "is-info");
  el.classList.add("show");
  if (type === "error") el.classList.add("is-error");
  else if (type === "ok") el.classList.add("is-ok");
  else el.classList.add("is-info");

  el.innerHTML = `
    <div class="icon">${icon}</div>
    <div class="text">${escapeHtml(text)}</div>
  `;
}

function clearToolbarQty() {
  if (!els.toolbarQty) return;
  els.toolbarQty.value = "";
  saveOrderFormState();
}

function sanitizeToolbarQty() {
  if (!els.toolbarQty) return;
  const digitsOnly = String(els.toolbarQty.value || "").replace(/\D+/g, "");
  if (els.toolbarQty.value !== digitsOnly) {
    els.toolbarQty.value = digitsOnly;
  }
  saveOrderFormState();
}

function updateCodesDatalist(items) {
  const datalist = document.getElementById("codesList");
  if (!datalist) return;

  datalist.innerHTML = items
    .slice(0, 2000)
    .map((item) => `<option value="${escapeHtml(item.code || "")}"></option>`)
    .join("");
}

function findProductByCode(code) {
  const needle = String(code || "")
    .trim()
    .toLowerCase();
  if (!needle) return null;

  return (
    allCatalog.find((item) => (item.code || "").toLowerCase() === needle) ||
    allCatalog.find((item) =>
      (item.code || "").toLowerCase().startsWith(needle),
    ) ||
    null
  );
}

function renderPager(meta) {
  if (!els.pager) return;

  const page = meta.page || 1;
  const pages = meta.pages || 1;
  const total = meta.total ?? 0;

  els.pager.innerHTML = `
    <div class="left">
      <div class="meta">Σελίδα ${page} / ${pages} - Σύνολο: ${total}</div>
      <button type="button" class="btn ghost" id="prevPage" ${page <= 1 ? "disabled" : ""}>Προηγ.</button>
      <button type="button" class="btn ghost" id="nextPage" ${page >= pages ? "disabled" : ""}>Επόμ.</button>
    </div>
  `;

  document.getElementById("prevPage")?.addEventListener("click", () => {
    if (currentPage > 1) applyCatalogView(currentPage - 1, lastQuery);
  });

  document.getElementById("nextPage")?.addEventListener("click", () => {
    if (currentPage < pages) applyCatalogView(currentPage + 1, lastQuery);
  });
}

function applyCatalogView(page = 1, query = "") {
  // Filter and paginate in memory so search/clear actions update instantly.
  currentPage = page;
  lastQuery = query;

  let items = [...allCatalog];
  if (importedCatalogCodes.size) {
    items = items.filter((item) =>
      importedCatalogCodes.has(String(item.code || "").trim()),
    );
  }
  const normalizedQuery = normalizeText(query);

  if (normalizedQuery) {
    items = items
      .map((item) => ({ item, score: matchScore(item, normalizedQuery) }))
      .filter((entry) => entry.score < 9999)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return String(a.item.code || "").localeCompare(
          String(b.item.code || ""),
          "el",
        );
      })
      .map((entry) => entry.item);
  }

  if (rankedCatalogCodes.length) {
    const rankingMap = new Map(
      rankedCatalogCodes.map((code, index) => [code, index]),
    );
    items.sort((a, b) => {
      const aCode = String(a.code || "").trim();
      const bCode = String(b.code || "").trim();
      const aRank = rankingMap.has(aCode)
        ? rankingMap.get(aCode)
        : Number.POSITIVE_INFINITY;
      const bRank = rankingMap.has(bCode)
        ? rankingMap.get(bCode)
        : Number.POSITIVE_INFINITY;
      if (aRank !== bRank) return aRank - bRank;
      return aCode.localeCompare(bCode, "el");
    });
  }

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), pages);
  const start = (safePage - 1) * PAGE_SIZE;

  currentPage = safePage;
  catalog = items.slice(start, start + PAGE_SIZE);

  renderCatalog(catalog);
  hydrateStockColumn(catalog);
  renderPager({ page: safePage, pages, total });
  els.countPill.textContent = `${total} προϊόντα`;
  saveOrderFormState();
}

async function loadCatalog(page = 1, query = "") {
  els.catalogStatus.textContent = "";

  try {
    const response = await fetch(`catalog.json?ts=${Date.now()}`);
    if (bounceIfUnauthorized(response, "/catalog.json")) return;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    allCatalog = Array.isArray(data.items) ? data.items : [];
    if (importedOrderDraft) {
      updateCodesDatalist(allCatalog);
      await applyImportedOrderDraft(importedOrderDraft);
      return;
    }

    const rankingDraft = loadOrderFormRankingDraft();
    if (rankingDraft) {
      updateCodesDatalist(allCatalog);
      await applyCustomerRankingDraft(rankingDraft);
      return;
    }

    updateCodesDatalist(allCatalog);
    applyCatalogView(page, query);
  } catch (error) {
    console.error("Catalog load/render error:", error);
    els.catalogStatus.textContent = `Σφάλμα: ${error?.message || error}`;
  }
}

function filterCatalog() {
  const query = (els.q?.value || "").trim();
  saveOrderFormState();
  if (allCatalog.length) applyCatalogView(1, query);
  else loadCatalog(1, query);
}

function clearTopFilters(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  // This clears only the catalog toolbar state, not the cart or customer form.
  if (els.q) els.q.value = "";
  clearToolbarQty();
  draftCatalogInputs.clear();
  importedCatalogCodes.clear();
  rankedCatalogCodes = [];
  productHistoryMap = {};
  setToolbarMsg("");
  currentPage = 1;
  lastQuery = "";

  if (allCatalog.length) applyCatalogView(1, "");
  else loadCatalog(1, "");

  els.q?.focus();
  saveOrderFormState();
  return false;
}

window.__clearTopFilters = clearTopFilters;
window.__hardClearCatalog = clearTopFilters;

function addToCart(product, qty) {
  const existing = cart.get(product.code);
  const previousQty = existing ? existing.qty : 0;

  // Re-adding the same code should accumulate quantity instead of duplicating the row.
  cart.set(product.code, {
    code: product.code,
    title: product.description || productTitle(product) || product.code,
    qty: previousQty + qty,
    image_url: product.image_url || "",
    pieces_per_package: product.pieces_per_package,
    volume_liters: getVolM3PerPiece(product),
    color: product.color || "",
  });

  renderCart();
  saveOrderFormState();
}

function setCartItemQty(code, qty, options = {}) {
  const item = cart.get(code);
  if (!item) return false;

  const piecesPerPack = Math.max(1, parseInt(item.pieces_per_package, 10) || 1);
  const parsedQty = parseInt(qty, 10);
  if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
    if (options.removeIfEmpty) {
      cart.delete(code);
      renderCart();
      saveOrderFormState();
      return true;
    }
    return false;
  }

  if (parsedQty % piecesPerPack !== 0) {
    return false;
  }

  item.qty = parsedQty;
  cart.set(code, item);
  renderCart();
  saveOrderFormState();
  return true;
}

function addFromUnifiedBar() {
  if (!allCatalog.length) {
    setToolbarMsg("Ο κατάλογος δεν έχει φορτώσει ακόμα.", "error");
    return;
  }

  const code = (els.q?.value || "").trim();
  const qty = parseInt(els.toolbarQty?.value || "", 10);

  if (!code) {
    setToolbarMsg("Γράψε κωδικό προϊόντος.", "error");
    els.q?.focus();
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    setToolbarMsg("Βάλε τεμάχια (>= 1).", "error");
    els.toolbarQty?.focus();
    return;
  }

  const product = findProductByCode(code);
  if (!product) {
    setToolbarMsg(`Δεν βρέθηκε προϊόν με κωδικό: ${code}`, "error");
    els.q?.focus();
    return;
  }

  const piecesPerPack = parseInt(product.pieces_per_package, 10) || 1;
  if (qty % piecesPerPack !== 0) {
    setToolbarMsg(
      `Λάθος ποσότητα. Το προϊόν ${product.code} έχει ${piecesPerPack} τεμ./συσκ.`,
      "error",
    );
    els.toolbarQty?.focus();
    return;
  }

  addToCart(product, qty);
  setToolbarMsg(`Προστέθηκε: ${product.code} (${qty} τεμ.)`, "ok");
  if (els.q) els.q.value = "";
  clearToolbarQty();
  els.q?.focus();
  saveOrderFormState();
}

function getPreparedCatalogRows() {
  // Sourced from draftCatalogInputs, not the DOM: the catalog is paginated, so a
  // product typed into on an earlier page has no row on the currently rendered page.
  return Array.from(draftCatalogInputs.entries())
    .map(([code, draft]) => {
      const product = findProductByCode(code);
      if (!product) return null;

      const row =
        els.catalog?.querySelector(`tr[data-id="${product.id}"]`) || null;
      const piecesInput = row?.querySelector(".qty-inline input") || null;
      const packsInput = row?.querySelector(".packsInput") || null;
      const piecesPerPack = parseInt(product.pieces_per_package, 10) || 1;
      const packs = parseInt(draft.packs || "", 10);
      const qtyPieces = parseInt(draft.pieces || "", 10);

      let finalPieces = 0;
      if (Number.isFinite(packs) && packs > 0)
        finalPieces = packs * piecesPerPack;
      else if (Number.isFinite(qtyPieces) && qtyPieces > 0)
        finalPieces = qtyPieces;
      else return null;

      return {
        row,
        product,
        piecesInput,
        packsInput,
        piecesPerPack,
        finalPieces,
      };
    })
    .filter(Boolean);
}

function clearPreparedCatalogRow(entry) {
  entry.piecesInput?.setCustomValidity("");
  if (entry.piecesInput) entry.piecesInput.value = "";
  if (entry.packsInput) entry.packsInput.value = "";
  rememberDraftCatalogInput(entry.product.code, {});
}

function updatePreparedAddButton() {
  if (!els.preparedAddBtn) return;

  const preparedCount = getPreparedCatalogRows().length;
  els.preparedAddBtn.disabled = preparedCount === 0;
  els.preparedAddBtn.textContent = preparedCount
    ? `Προσθήκη έτοιμων γραμμών (${preparedCount})`
    : "Προσθήκη έτοιμων γραμμών";
}

function addPreparedCatalogRowsToCart() {
  const preparedRows = getPreparedCatalogRows();
  if (!preparedRows.length) return false;

  for (const entry of preparedRows) {
    if (entry.finalPieces % entry.piecesPerPack !== 0) {
      if (entry.piecesInput) {
        entry.piecesInput.setCustomValidity(
          `Πρέπει να είναι πολλαπλάσιο των ${entry.piecesPerPack}.`,
        );
        entry.piecesInput.reportValidity();
        entry.piecesInput.focus();
      } else {
        // The offending row is on a different catalog page, so there is no input to
        // focus — name the product instead of failing silently.
        setToolbarMsg(
          `${entry.product.code}: πρέπει να είναι πολλαπλάσιο των ${entry.piecesPerPack}.`,
          "error",
        );
      }
      return true;
    }
  }

  for (const entry of preparedRows) {
    addToCart(entry.product, entry.finalPieces);
    clearPreparedCatalogRow(entry);
  }

  setToolbarMsg(
    preparedRows.length === 1
      ? `Προστέθηκε: ${preparedRows[0].product.code} (${preparedRows[0].finalPieces} τεμ.)`
      : `Προστέθηκαν ${preparedRows.length} προϊόντα στο καλάθι.`,
    "ok",
  );
  updatePreparedAddButton();
  return true;
}

function openImgModal(src, caption) {
  if (!imgModal || !imgModalImg) return;

  imgModalImg.src = src;
  imgModalImg.alt = caption || "Εικόνα προϊόντος";
  if (imgModalCap) imgModalCap.textContent = caption || "";

  imgModal.classList.add("open");
  imgModal.setAttribute("aria-hidden", "false");
}

function closeImgModal() {
  if (!imgModal) return;

  imgModal.classList.remove("open");
  imgModal.setAttribute("aria-hidden", "true");
  if (imgModalImg) imgModalImg.src = "";
}

function createCatalogRow(product) {
  const image = product.image_url || PLACEHOLDER_PACKSHOT;
  const orderCount = productHistoryMap[String(product.code || "").trim()] || 0;
  const historyBadge = rankedCatalogCodes.length
    ? buildHistoryBadge(orderCount)
    : "";

  return `
    <tr data-id="${product.id}">
      <td class="td-code">${escapeHtml(product.code)}${historyBadge}</td>
      <td class="td-desc">
        <div style="font-weight:600;">${escapeHtml(product.description || "")}</div>
      </td>
      <td class="td-pack">
        <img
          class="packshot clickable"
          src="${escapeHtml(image)}"
          alt="${escapeHtml(product.code)}"
          loading="lazy"
          data-img="${escapeHtml(image)}"
          data-cap="${escapeHtml(`${product.code} - ${product.description || ""}`)}"
        />
      </td>
      <td class="td-bundle"><span class="bundle-pill">${product.pieces_per_package} τεμ.</span></td>
      <td class="td-stock" data-code="${escapeHtml(product.code)}">
        <span class="stock-cell stock-loading" title="Φόρτωση αποθέματος…">·</span>
      </td>
      <td class="td-packs">
        <input class="packsInput" type="number" min="1" step="1" inputmode="numeric" data-ppp="${product.pieces_per_package}" />
      </td>
      <td class="td-qty">
        <div class="qty-inline">
          <div class="stepper qty-stepper">
            <button type="button" class="stepBtn qtyMinus" aria-label="Μείωση τεμαχίων">-</button>
            <input type="number" min="${product.pieces_per_package}" step="${product.pieces_per_package}" inputmode="numeric" data-ppp="${product.pieces_per_package}" />
            <button type="button" class="stepBtn qtyPlus" aria-label="Αύξηση τεμαχίων">+</button>
          </div>
          <button type="button" class="btn ghost addBtn">Προσθήκη</button>
        </div>
      </td>
    </tr>
  `;
}

function renderCatalog(items) {
  const rows = Array.isArray(items) ? items.map(createCatalogRow).join("") : "";

  els.catalog.innerHTML = `
    <table class="catalog-table">
      <thead>
        <tr>
          <th class="th-code">ΚΩΔ.</th>
          <th class="th-desc">ΠΕΡΙΓΡΑΦΗ</th>
          <th class="th-pack">ΕΙΔΟΣ</th>
          <th class="th-bundle">ΤΕΜ./ΣΥΣΚ.</th>
          <th class="th-stock">ΑΠΟΘΕΜΑ</th>
          <th class="th-packs">ΣΥΣΚΕΥΑΣΙΕΣ</th>
          <th class="th-qty">ΤΕΜΑΧΙΑ</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="7" style="padding:14px; color:#6b6b6b;">Δεν βρέθηκαν προϊόντα.</td></tr>`}
      </tbody>
    </table>
  `;

  els.catalog.querySelectorAll("img.packshot.clickable").forEach((img) => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImgModal(img.dataset.img, img.dataset.cap);
    });
  });

  els.catalog.querySelectorAll("tr[data-id]").forEach((row) => {
    const id = parseInt(row.getAttribute("data-id"), 10);
    const product = allCatalog.find((item) => item.id === id);
    if (!product) return;

    const piecesInput = row.querySelector(".qty-inline input");
    const packsInput = row.querySelector(".packsInput");
    const addBtn = row.querySelector(".addBtn");
    const qtyMinusBtn = row.querySelector(".qtyMinus");
    const qtyPlusBtn = row.querySelector(".qtyPlus");
    const piecesPerPack = parseInt(product.pieces_per_package, 10) || 1;

    applyDraftValuesToCatalogRow(product, packsInput, piecesInput);

    function clearRowQty() {
      piecesInput.value = "";
      packsInput.value = "";
      piecesInput.setCustomValidity("");
      rememberDraftCatalogInput(product.code, {});
      updatePreparedAddButton();
    }

    function applyFromPieces(qty) {
      // Keep the pieces and packs inputs synchronized around the product pack size.
      if (!Number.isFinite(qty) || qty <= 0) {
        clearRowQty();
        return;
      }

      piecesInput.value = String(qty);
      packsInput.value =
        qty % piecesPerPack === 0 ? String(qty / piecesPerPack) : "";
      piecesInput.setCustomValidity("");
      rememberDraftCatalogInput(product.code, {
        packs: packsInput.value,
        pieces: piecesInput.value,
      });
      updatePreparedAddButton();
    }

    row.addEventListener("click", (event) => {
      // Clicking code/description is a shortcut to preload the top quick-add toolbar.
      const allowedCell = event.target.closest("td.td-code, td.td-desc");
      if (!allowedCell) return;
      if (
        event.target.closest("button") ||
        event.target.closest("input") ||
        event.target.closest("img.packshot")
      )
        return;

      if (els.q) els.q.value = product.code;
      setToolbarMsg("");
      els.toolbarQty?.focus();
      saveOrderFormState();
      filterCatalog();
    });

    packsInput?.addEventListener("input", () => {
      // Packs are always translated into pieces immediately for one validation path.
      const packs = parseInt(packsInput.value, 10);
      if (!Number.isFinite(packs) || packs <= 0) {
        piecesInput.value = "";
        rememberDraftCatalogInput(product.code, {});
        updatePreparedAddButton();
        return;
      }

      piecesInput.value = String(packs * piecesPerPack);
      piecesInput.setCustomValidity("");
      rememberDraftCatalogInput(product.code, {
        packs: packsInput.value,
        pieces: piecesInput.value,
      });
      updatePreparedAddButton();
    });

    piecesInput?.addEventListener("input", () => {
      // Only exact multiples back-fill the packs field; partial packs stay blank.
      const qty = parseInt(piecesInput.value, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        packsInput.value = "";
        rememberDraftCatalogInput(product.code, {});
        updatePreparedAddButton();
        return;
      }

      packsInput.value =
        qty % piecesPerPack === 0 ? String(qty / piecesPerPack) : "";
      rememberDraftCatalogInput(product.code, {
        packs: packsInput.value,
        pieces: piecesInput.value,
      });
      updatePreparedAddButton();
    });

    qtyMinusBtn?.addEventListener("click", () => {
      const current = toPositiveInt(piecesInput?.value);
      applyFromPieces(Math.max(0, current - piecesPerPack));
    });

    qtyPlusBtn?.addEventListener("click", () => {
      const current = toPositiveInt(piecesInput?.value);
      applyFromPieces(current > 0 ? current + piecesPerPack : piecesPerPack);
    });

    addBtn.addEventListener("click", () => {
      // Accept either packs or pieces input, but normalize to final piece quantity.
      const packs = parseInt(packsInput?.value || "", 10);
      const qtyPieces = parseInt(piecesInput?.value || "", 10);

      let finalPieces = 0;
      if (Number.isFinite(packs) && packs > 0)
        finalPieces = packs * piecesPerPack;
      else if (Number.isFinite(qtyPieces) && qtyPieces > 0)
        finalPieces = qtyPieces;
      else {
        piecesInput.setCustomValidity("Βάλε συσκευασίες ή τεμάχια.");
        piecesInput.reportValidity();
        return;
      }

      if (finalPieces % piecesPerPack !== 0) {
        piecesInput.setCustomValidity(
          `Πρέπει να είναι πολλαπλάσιο των ${piecesPerPack}.`,
        );
        piecesInput.reportValidity();
        return;
      }

      piecesInput.setCustomValidity("");
      addToCart(product, finalPieces);
      clearRowQty();
    });

    [piecesInput, packsInput].forEach((input) => {
      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addBtn.click();
        }
      });
    });
  });

  els.countPill.textContent = `${items.length} προϊόντα`;
  updatePreparedAddButton();
}

// --- "Απόθεμα" catalog column ---------------------------------------------------
// Informational stock figure per catalog row. Never gates a submit: any failure
// leaves the cell as a muted "—" and the form stays fully usable.
//
// Per-code session cache (90s TTL) so paging back and forth doesn't re-fetch. A
// cached value of `null` means the endpoint answered but had no row for that code
// (obsolete/unknown code) - we render "—" and stop asking until the TTL lapses.
const STOCK_CACHE_TTL_MS = 90_000;
const stockCache = new Map(); // code -> { level: object|null, at: number }
let stockHydrateTimer = null;
let stockHydrateSeq = 0;
let latestStockAsOf = null;

function stockCacheGet(code) {
  const hit = stockCache.get(code);
  if (!hit) return undefined;
  if (Date.now() - hit.at > STOCK_CACHE_TTL_MS) {
    stockCache.delete(code);
    return undefined;
  }
  return hit;
}

function fmtStockNumber(value) {
  const n = Number(value) || 0;
  // ES1 stock is usually whole pieces but can be fractional for weighed items.
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function renderStockCell(cell, level, qtyValue) {
  if (!cell) return;
  let span = cell.querySelector(".stock-cell");
  if (!span) {
    span = document.createElement("span");
    cell.appendChild(span);
  }

  if (!level) {
    span.className = "stock-cell stock-none";
    span.textContent = "—";
    span.title = "Απόθεμα μη διαθέσιμο";
    return;
  }

  const avail = Number(level.available) || 0;
  const qty = Number.parseInt(qtyValue, 10);
  const hasQty = Number.isFinite(qty) && qty > 0;

  let state = "neutral";
  if (avail <= 0) state = "bad";
  else if (hasQty && avail < qty) state = "warn";
  else if (hasQty && avail >= qty) state = "good";

  span.className = `stock-cell stock-${state}`;
  const shown = fmtStockNumber(avail);
  span.textContent = level.isMixedContent ? `≈ ${shown}` : shown;

  const tip = [
    `Διαθέσιμο (αποθ. 101): ${fmtStockNumber(avail)}`,
    `Φυσικό υπόλοιπο 101: ${fmtStockNumber(level.onHand101)}`,
    `Σύνολο εταιρείας: ${fmtStockNumber(level.onHandCompany)}`,
  ];
  if (level.isMixedContent && level.fulfillmentCode) {
    tip.push(`από συγγενικό κωδικό ${level.fulfillmentCode}`);
  }
  span.title = tip.join(" · ");
}

// Paint td-stock cells from `levelByCode` (this batch's fresh values); for codes not
// in it, fall back to the session cache. Cells whose code is neither known nor cached
// keep the loading dot.
function applyStockLevelsToDom(levelByCode) {
  if (!els.catalog) return;
  els.catalog.querySelectorAll("td.td-stock").forEach((cell) => {
    const code = cell.getAttribute("data-code");
    if (!code) return;
    const row = cell.closest("tr[data-id]");
    const qtyInput = row?.querySelector(".qty-inline input");

    let level;
    if (levelByCode.has(code)) {
      level = levelByCode.get(code);
    } else {
      const cached = stockCacheGet(code);
      if (!cached) return;
      level = cached.level;
    }
    renderStockCell(cell, level, qtyInput?.value);
  });
}

function updateStockAsOfLabel() {
  if (!els.stockAsOf) return;
  if (!latestStockAsOf) {
    els.stockAsOf.textContent = "";
    return;
  }
  const d = new Date(latestStockAsOf);
  if (Number.isNaN(d.getTime())) {
    els.stockAsOf.textContent = "";
    return;
  }
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  els.stockAsOf.textContent = `απόθεμα ${hh}:${mm}`;
}

function hydrateStockColumn(items) {
  const codes = (Array.isArray(items) ? items : [])
    .map((it) => String(it?.code || "").trim())
    .filter(Boolean);
  if (codes.length === 0) return;

  // Paint anything already cached right away so paging back doesn't flash a dot.
  const cachedByCode = new Map();
  const missing = [];
  for (const code of codes) {
    const hit = stockCacheGet(code);
    if (hit) cachedByCode.set(code, hit.level);
    else missing.push(code);
  }
  if (cachedByCode.size) applyStockLevelsToDom(cachedByCode);
  if (missing.length === 0) return;

  clearTimeout(stockHydrateTimer);
  const seq = ++stockHydrateSeq;
  stockHydrateTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({ codes: missing.join(",") });
      const res = await fetch(`/api/stock?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (seq !== stockHydrateSeq) return; // a newer page superseded this fetch
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const levels = Array.isArray(data?.levels) ? data.levels : [];

      const byCode = new Map();
      for (const lvl of levels) {
        if (lvl?.itemCode) byCode.set(String(lvl.itemCode).trim(), lvl);
      }
      // Cache every code we asked about: a hit as its level, a miss as null.
      for (const code of missing) {
        const level = byCode.has(code) ? byCode.get(code) : null;
        byCode.set(code, level);
        stockCache.set(code, { level, at: Date.now() });
      }
      if (data?.asOf && !data?.unavailable) {
        latestStockAsOf = data.asOf;
        updateStockAsOfLabel();
      }
      applyStockLevelsToDom(byCode);
    } catch {
      if (seq !== stockHydrateSeq) return;
      // Endpoint down / unreachable: show "—" for the codes we were waiting on, but
      // do NOT cache the failure - a refresh or a later page revisit retries.
      const failed = new Map();
      for (const code of missing) failed.set(code, null);
      applyStockLevelsToDom(failed);
    }
  }, 150);
}

function refreshStockColumn() {
  stockCache.clear();
  latestStockAsOf = null;
  updateStockAsOfLabel();
  els.catalog?.querySelectorAll("td.td-stock .stock-cell").forEach((span) => {
    span.className = "stock-cell stock-loading";
    span.textContent = "·";
    span.title = "Φόρτωση αποθέματος…";
  });
  hydrateStockColumn(catalog);
}

function renderCart() {
  if (cart.size === 0) {
    els.cart.innerHTML = `<div class="small">Δεν έχετε επιλέξει προϊόντα.</div>`;
    return;
  }

  let totalVolumeM3 = 0;
  let totalPackages = 0;

  const itemsHtml = Array.from(cart.values())
    .map((item) => {
      // Sidebar totals are derived here so the cart stays self-contained.
      const totals = calcVolumes(
        item.qty,
        item.pieces_per_package,
        item.volume_liters,
      );
      totalVolumeM3 += totals.volumeM3;
      totalPackages += totals.packages;

      const image = item.image_url || PLACEHOLDER_CART_IMAGE;

      return `
        <div class="cartItem">
          <div class="cartLeft" style="display:flex; gap:10px; align-items:center; min-width:0;">
            <img
              src="${escapeHtml(image)}"
              alt="${escapeHtml(item.code)}"
              loading="lazy"
              style="width:44px;height:44px;object-fit:contain;border:1px solid var(--line);border-radius:10px;background:#fff;flex:0 0 auto;"
            />
            <div style="min-width:0;">
              <div class="cartTitle">${escapeHtml(item.title || item.code)}</div>
              <div class="cartCode">${escapeHtml(item.code)}${item.color ? " - " + escapeHtml(item.color) : ""}</div>
              <div class="small" style="margin-top:2px;">${totals.packages} συσκ. - ${fmtM3(totals.volumeM3)} m³</div>
            </div>
          </div>
          <div class="cartRight">
            <div class="cartQtyEditor">
              <button type="button" class="secondary cartStepBtn" data-cart-minus="${escapeHtml(item.code)}">-</button>
              <input
                class="cartQtyInput"
                type="number"
                min="${Math.max(1, parseInt(item.pieces_per_package, 10) || 1)}"
                step="${Math.max(1, parseInt(item.pieces_per_package, 10) || 1)}"
                inputmode="numeric"
                value="${item.qty}"
                data-cart-qty="${escapeHtml(item.code)}"
                data-ppp="${Math.max(1, parseInt(item.pieces_per_package, 10) || 1)}"
              />
              <button type="button" class="secondary cartStepBtn" data-cart-plus="${escapeHtml(item.code)}">+</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  els.cart.innerHTML = `
    ${itemsHtml}
    <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--line); display:flex; justify-content:space-between; gap:10px; align-items:center;">
      <div class="small">Σύνολο όγκου συσκευασιών:</div>
      <div style="font-weight:700;">${fmtM3(totalVolumeM3)} m³ (${totalPackages} συσκ.)</div>
    </div>
  `;

  els.cart.querySelectorAll("button[data-cart-minus]").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.getAttribute("data-cart-minus");
      const item = cart.get(code);
      if (!item) return;
      const piecesPerPack = Math.max(
        1,
        parseInt(item.pieces_per_package, 10) || 1,
      );
      const nextQty = item.qty - piecesPerPack;
      if (nextQty <= 0) {
        cart.delete(code);
        renderCart();
        saveOrderFormState();
        return;
      }
      setCartItemQty(code, nextQty);
    });
  });

  els.cart.querySelectorAll("button[data-cart-plus]").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.getAttribute("data-cart-plus");
      const item = cart.get(code);
      if (!item) return;
      const piecesPerPack = Math.max(
        1,
        parseInt(item.pieces_per_package, 10) || 1,
      );
      setCartItemQty(code, item.qty + piecesPerPack);
    });
  });

  els.cart.querySelectorAll("input[data-cart-qty]").forEach((input) => {
    const commit = () => {
      const code = input.getAttribute("data-cart-qty");
      const item = cart.get(code);
      if (!item) return;
      const piecesPerPack = Math.max(
        1,
        parseInt(input.getAttribute("data-ppp"), 10) || 1,
      );
      const qty = parseInt(input.value || "", 10);

      if (!Number.isFinite(qty) || qty <= 0) {
        input.value = String(item.qty);
        return;
      }

      if (qty % piecesPerPack !== 0) {
        input.setCustomValidity(
          `Πρέπει να είναι πολλαπλάσιο των ${piecesPerPack}.`,
        );
        input.reportValidity();
        input.value = String(item.qty);
        input.setCustomValidity("");
        return;
      }

      input.setCustomValidity("");
      setCartItemQty(code, qty);
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    });
    input.addEventListener("blur", commit);
  });
}

function calcTotals(cartMap) {
  let totalPackages = 0;
  let totalVolumeM3 = 0;
  let totalPieces = 0;

  for (const item of cartMap.values()) {
    const piecesPerPack = Math.max(
      1,
      parseInt(item.pieces_per_package, 10) || 1,
    );
    const qty = parseInt(item.qty, 10) || 0;
    const packages = qty / piecesPerPack;
    // volume_liters is m³ per single piece — scale by pieces, not packages.
    const volumeM3PerPiece = toNum(item.volume_liters, 0);

    totalPieces += qty;
    totalPackages += packages;
    totalVolumeM3 += qty * volumeM3PerPiece;
  }

  return {
    totalPackages,
    totalVolumeM3,
    totalPieces,
  };
}

function sanitizeFilenamePart(value) {
  return (value || "pelatis")
    .toString()
    .trim()
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\w\u0370-\u03FF\u1F00-\u1FFF .-]/g, "")
    .slice(0, 60)
    .trim()
    .replace(/\s/g, "_");
}

function todayYYYYMMDD() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function downloadOrderExcelFromCart(cartMap) {
  const customerName =
    document.getElementById("customerName")?.value?.trim() || "";
  const customerSubstore =
    document.getElementById("customerSubstore")?.value?.trim() || "";
  const customerOrderNo =
    document.getElementById("customerOrderNo")?.value?.trim() || "";
  const comments = document.getElementById("notes")?.value?.trim() || "";

  const rows = [
    ["ΣΤΟΙΧΕΙΑ ΠΑΡΑΓΓΕΛΙΑΣ", ""],
    ["Ονοματεπώνυμο / Επωνυμία Πελάτη", customerName],
    ["Υποκατάστημα", customerSubstore],
    ["Αρ. Παραγγελίας", customerOrderNo],
    ["Σχόλια", comments],
    ["", ""],
    ["ΚΩΔΙΚΟΣ", "ΤΕΜΑΧΙΑ", "ΠΕΡΙΓΡΑΦΗ"],
  ];

  for (const item of cartMap.values()) {
    rows.push([item.code, item.qty, item.title || ""]);
  }

  // Excel export is generated fully in-browser because this deployment is static.
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 52 }];
  worksheet["!freeze"] = { xSplit: 0, ySplit: 5 };

  XLSX.utils.book_append_sheet(workbook, worksheet, "Order");

  const filename = `${todayYYYYMMDD()}_${sanitizeFilenamePart(customerName)}.xlsx`;
  XLSX.writeFile(workbook, filename);
  return filename;
}

function downloadExcelOnly() {
  if (cart.size === 0) {
    setToolbarMsg("Βάλε τουλάχιστον 1 προϊόν για να κατέβει Excel.", "error");
    return;
  }

  try {
    const filename = downloadOrderExcelFromCart(cart);
    setToolbarMsg(`Κατέβηκε το αρχείο: ${filename}`, "ok");
  } catch (error) {
    console.error(error);
    setToolbarMsg(`Σφάλμα Excel: ${error?.message || error}`, "error");
  }
}

function buildEmailBodyNice(payload, totals, filename = "") {
  const lines = payload.lines || [];
  const codeWidth = Math.max(
    6,
    ...lines.map((line) => String(line.itemCode || "").length),
  );
  const qtyWidth = Math.max(
    6,
    ...lines.map((line) => String(line.qty || "").length),
  );

  const header = `${"ΚΩΔΙΚΟΣ".padEnd(codeWidth)}  ${"ΤΕΜΑΧΙΑ".padStart(qtyWidth)}`;
  const separator = `${"-".repeat(codeWidth)}  ${"-".repeat(qtyWidth)}`;
  const rows = lines
    .map(
      (line) =>
        `${String(line.itemCode || "").padEnd(codeWidth)}  ${String(line.qty || "").padStart(qtyWidth)}`,
    )
    .join("\n");

  return [
    `Πελάτης: ${payload.customer_name || ""}`,
    payload.customer_substore
      ? `Υποκατάστημα: ${payload.customer_substore}`
      : "",
    payload.customer_email ? `Email: ${payload.customer_email}` : "",
    "",
    "Παραγγελία:",
    header,
    separator,
    rows,
    "",
    payload.desired_delivery_date
      ? `Επιθυμητή ημ/νία παραλαβής: ${payload.desired_delivery_date}`
      : "",
    `Σχόλια: ${payload.notes || ""}`,
    "",
    filename ? `ΣΗΜΕΙΩΣΗ: Επισυνάψτε παρακαλώ το αρχείο: ${filename}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function openOutlookWebDraft(toEmail, subject, body) {
  const url =
    "https://outlook.office.com/mail/deeplink/compose" +
    `?to=${encodeURIComponent(toEmail)}` +
    `&subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  window.open(url, "_blank");
}

function openGmailDraft(toEmail, subject, body) {
  const url =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(toEmail)}` +
    `&su=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  window.open(url, "_blank");
}

async function submitOrderToBackend(meta) {
  try {
    const response = await fetch(`${API_BASE}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        customerCode:
          actorState.role === "staff"
            ? selectedStaffCustomer?.code || ""
            : "",
        customerName: meta.payload.customer_name,
        customerSubstore: meta.payload.customer_substore,
        customerSubstoreCode: meta.payload.customer_substore_code,
        customerOrderNo: meta.payload.customer_order_no,
        customerEmail: meta.payload.customer_email,
        notes: meta.payload.notes,
        desiredDeliveryDate: meta.payload.desired_delivery_date,
        items: meta.payload.lines.map((line) => ({
          code: line.itemCode,
          qty: line.qty,
        })),
      }),
    });

    if (bounceIfUnauthorized(response, `${API_BASE}/api/orders/submit`)) {
      return { ok: false, error: new Error("Session expired.") };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }

    return { ok: true, orderId: payload?.order_id };
  } catch (error) {
    console.error(error);
    return { ok: false, error };
  }
}

function openSubmitModal() {
  submitModal?.classList.add("open");
  submitModal?.setAttribute("aria-hidden", "false");
}

function closeSubmitModal() {
  submitModal?.classList.remove("open");
  submitModal?.setAttribute("aria-hidden", "true");
}

function prepareOrderMeta() {
  if (cart.size === 0) {
    els.submitStatus.textContent = "Βάλε τουλάχιστον 1 προϊόν στην παραγγελία.";
    return null;
  }

  if (actorState.role === "staff" && !selectedStaffCustomer?.code) {
    els.submitStatus.textContent = "Επιλέξτε πελάτη πριν την υποβολή.";
    return null;
  }

  const customerName =
    document.getElementById("customerName")?.value?.trim() || "";
  const customerSubstore =
    document.getElementById("customerSubstore")?.value?.trim() || "";
  // The exact branch_code of the picked substore option, for the ΠΑΡ writer's
  // delivery-site resolver. Re-derived from the selected label so a restored draft
  // (which only stores the label) still carries it.
  const customerSubstoreCode =
    customerSubstoreOptions.find((opt) => opt.value === customerSubstore)?.code ||
    "";
  const customerEmail =
    document.getElementById("customerEmail")?.value?.trim() || "";
  const customerOrderNo =
    document.getElementById("customerOrderNo")?.value?.trim() || "";
  const notes = els.notes?.value?.trim() || "";
  const desiredDeliveryDate =
    document.getElementById("desiredDeliveryDate")?.value || "";

  // Reuse the same normalized payload for both Gmail and Outlook draft flows.
  return {
    subject: `Παραγγελία B2B (${customerName || "Πελάτης"})`,
    payload: {
      customer_name: customerName,
      customer_substore: customerSubstore,
      customer_substore_code: customerSubstoreCode,
      customer_order_no: customerOrderNo,
      customer_email: customerEmail,
      notes,
      desired_delivery_date: desiredDeliveryDate,
      token,
      lines: Array.from(cart.values()).map((item) => ({
        itemCode: item.code,
        qty: item.qty,
      })),
    },
    totals: calcTotals(cart),
  };
}

function submitOrder() {
  els.submitStatus.textContent = "";
  const meta = prepareOrderMeta();
  if (!meta) return;

  lastOrder = meta;
  openSubmitModal();
}

async function submitOrderDirectlyToAdmin() {
  els.submitStatus.textContent = "";
  const meta = prepareOrderMeta();
  if (!meta) return;

  const confirmed = window.confirm(
    "Η παραγγελία θα καταχωρηθεί για καταχώρηση στο ES1. Θέλετε να συνεχίσετε;",
  );
  if (!confirmed) return;

  if (els.submitToAdminBtn) els.submitToAdminBtn.disabled = true;
  els.submitStatus.textContent = "Καταχώρηση παραγγελίας...";

  try {
    const submission = await submitOrderToBackend(meta);
    els.submitStatus.textContent = submission.ok
      ? `Καταχωρήθηκε η παραγγελία (#${submission.orderId}).`
      : `Σφάλμα: δεν καταχωρήθηκε η παραγγελία (${submission.error?.message || "σφάλμα"}).`;
  } finally {
    if (els.submitToAdminBtn) els.submitToAdminBtn.disabled = false;
  }
}

imgModal?.addEventListener("click", (event) => {
  if (event.target?.dataset?.close === "1") closeImgModal();
});

submitModal?.addEventListener("click", (event) => {
  if (event.target?.dataset?.close === "1") closeSubmitModal();
});

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;

  if (event.key === "Escape" && imgModal?.classList.contains("open")) {
    closeImgModal();
  }
  if (event.key === "Escape") {
    closeSubmitModal();
  }

  if (event.key !== "Enter") return;
  if (
    imgModal?.classList.contains("open") ||
    submitModal?.classList.contains("open")
  )
    return;
  if (event.isComposing) return;
  if (event.target instanceof HTMLTextAreaElement) return;

  if (addPreparedCatalogRowsToCart()) {
    event.preventDefault();
  }
});

sendGmailBtn?.addEventListener("click", async () => {
  if (!lastOrder) return;

  try {
    els.submitStatus.textContent = "Καταχώρηση παραγγελίας...";
    const submission = await submitOrderToBackend(lastOrder);
    const filename = downloadOrderExcelFromCart(cart);
    const body = buildEmailBodyNice(
      lastOrder.payload,
      lastOrder.totals,
      filename,
    );

    closeSubmitModal();
    els.submitStatus.textContent = submission.ok
      ? `Καταχωρήθηκε η παραγγελία (#${submission.orderId}). Κατέβηκε το ${filename}. Άνοιξε draft στο Gmail.`
      : `Προσοχή: δεν καταχωρήθηκε στο σύστημα (${submission.error?.message || "σφάλμα"}). Κατέβηκε το ${filename}. Άνοιξε draft στο Gmail.`;
    openGmailDraft(ORDERS_EMAIL, lastOrder.subject, body);
  } catch (error) {
    console.error(error);
    els.submitStatus.textContent = `Σφάλμα Excel: ${error?.message || error}`;
  }
});

sendMailtoBtn?.addEventListener("click", async () => {
  if (!lastOrder) return;

  try {
    els.submitStatus.textContent = "Καταχώρηση παραγγελίας...";
    const submission = await submitOrderToBackend(lastOrder);
    const filename = downloadOrderExcelFromCart(cart);
    const body = buildEmailBodyNice(
      lastOrder.payload,
      lastOrder.totals,
      filename,
    );

    closeSubmitModal();
    els.submitStatus.textContent = submission.ok
      ? `Καταχωρήθηκε η παραγγελία (#${submission.orderId}). Κατέβηκε το ${filename}. Άνοιξε draft στο Outlook.`
      : `Προσοχή: δεν καταχωρήθηκε στο σύστημα (${submission.error?.message || "σφάλμα"}). Κατέβηκε το ${filename}. Άνοιξε draft στο Outlook.`;
    openOutlookWebDraft(ORDERS_EMAIL, lastOrder.subject, body);
  } catch (error) {
    console.error(error);
    els.submitStatus.textContent = `Σφάλμα Excel: ${error?.message || error}`;
  }
});

els.q?.addEventListener("input", () => {
  setToolbarMsg("");
  filterCatalog();
});

els.q?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;

  event.preventDefault();
  const code = (els.q.value || "").trim();
  if (!code) return;

  const product = findProductByCode(code);
  if (!product) {
    setToolbarMsg(`Δεν βρέθηκε προϊόν με κωδικό: ${code}`, "error");
    return;
  }

  setToolbarMsg("");
  els.toolbarQty?.focus();
});

els.toolbarQty?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addFromUnifiedBar();
  }
});
els.toolbarQty?.addEventListener("input", sanitizeToolbarQty);
els.toolbarQty?.addEventListener("paste", () =>
  setTimeout(sanitizeToolbarQty, 0),
);
els.customerName?.addEventListener("input", saveOrderFormState);
els.customerSubstoreQuery?.addEventListener("input", () => {
  renderCustomerSubstoreResults(
    filterCustomerSubstoreOptions(els.customerSubstoreQuery.value || ""),
  );
});
els.customerSubstoreQuery?.addEventListener("focus", () => {
  renderCustomerSubstoreResults(
    filterCustomerSubstoreOptions(els.customerSubstoreQuery.value || ""),
  );
});
els.customerSubstoreResults?.addEventListener("click", (event) => {
  const button = event.target.closest(".customer-picker-result");
  if (!button) return;
  selectCustomerSubstoreOption(button.dataset.value || "");
});
els.customerEmail?.addEventListener("input", saveOrderFormState);
els.customerOrderNo?.addEventListener("input", saveOrderFormState);
els.notes?.addEventListener("input", saveOrderFormState);

els.toolbarAddBtn?.addEventListener("click", addFromUnifiedBar);
els.preparedAddBtn?.addEventListener("click", () => {
  addPreparedCatalogRowsToCart();
});
els.clearBtn?.addEventListener("click", () => {
  cart.clear();
  renderCart();
  if (actorState.role === "staff") {
    clearSelectedStaffCustomer();
    if (els.customerPickerQuery) els.customerPickerQuery.value = "";
    if (els.customerPickerResults) els.customerPickerResults.innerHTML = "";
  }
  if (els.customerEmail) els.customerEmail.value = "";
  if (els.customerOrderNo) els.customerOrderNo.value = "";
  if (els.notes) els.notes.value = "";
  if (els.desiredDeliveryDate) els.desiredDeliveryDate.value = "";
  setToolbarMsg("");
  saveOrderFormState();
});
els.submitBtn?.addEventListener("click", submitOrder);
els.submitToAdminBtn?.addEventListener("click", submitOrderDirectlyToAdmin);
els.downloadExcelBtn?.addEventListener("click", downloadExcelOnly);
els.reloadBtn?.addEventListener("click", clearTopFilters);
els.reloadBtn?.addEventListener("pointerup", clearTopFilters);
els.reloadBtn?.addEventListener("touchend", clearTopFilters, {
  passive: false,
});

els.stockRefreshBtn?.addEventListener("click", refreshStockColumn);

// Recolour a row's "Απόθεμα" cell as its quantity input changes (red/amber/green vs
// available). Delegated on the catalog container, which survives innerHTML swaps.
els.catalog?.addEventListener("input", (event) => {
  const input = event.target.closest?.(".qty-inline input");
  if (!input) return;
  const row = input.closest("tr[data-id]");
  const cell = row?.querySelector("td.td-stock");
  const code = cell?.getAttribute("data-code");
  if (!code) return;
  const hit = stockCacheGet(code);
  if (hit === undefined) return; // not loaded yet - leave the dot
  renderStockCell(cell, hit.level, input.value);
});
window.addEventListener("pagehide", saveOrderFormState);
window.addEventListener("beforeunload", saveOrderFormState);

let appStarted = false;

function startApp() {
  if (appStarted) return;
  appStarted = true;

  restoreDraftCatalogInputs(restoredOrderFormState);
  restoreImportedCatalogCodes(restoredOrderFormState);
  restoreRankedCatalogCodes(restoredOrderFormState);
  restoreCartFromState(restoredOrderFormState);
  restoreOrderFormFields(restoredOrderFormState);
  loadCatalog(
    Number.isFinite(Number(restoredOrderFormState?.currentPage))
      ? Number(restoredOrderFormState.currentPage)
      : 1,
    restoredOrderFormState?.lastQuery || restoredOrderFormState?.q || "",
  );
  renderCart();
  updatePreparedAddButton();
  saveOrderFormState();
}

async function bootstrapApp() {
  const actor = await checkAuthState();
  // The server gate on "/" means a logged-out browser never gets here. The only
  // way role is null now is a session that died between that gate and this
  // check — treat it the same as an in-session expiry and go to the login page
  // instead of showing the vestigial #loginPanel.
  if (!actor.role) {
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.assign(`/login?next=${next}`);
    return;
  }
  applyRoleUi(actor);
  startApp();
}

bootstrapApp();
