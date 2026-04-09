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
  notes: document.getElementById("notes"),
  customerName: document.getElementById("customerName"),
  customerSubstore: document.getElementById("customerSubstore"),
  customerEmail: document.getElementById("customerEmail"),
  clearBtn: document.getElementById("clearBtn"),
  downloadExcelBtn: document.getElementById("downloadExcelBtn"),
  submitBtn: document.getElementById("submitBtn"),
  submitStatus: document.getElementById("submitStatus"),
  reloadBtn: document.getElementById("reloadBtn"),
  pager: document.getElementById("pager"),
};

const imgModal = document.getElementById("imgModal");
const imgModalImg = document.getElementById("imgModalImg");
const imgModalCap = document.getElementById("imgModalCap");
const submitModal = document.getElementById("submitModal");
const sendGmailBtn = document.getElementById("sendGmailBtn");
const sendMailtoBtn = document.getElementById("sendMailtoBtn");

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
    const state = {
      q: els.q?.value || "",
      toolbarQty: els.toolbarQty?.value || "",
      customerName: els.customerName?.value || "",
      customerSubstore: els.customerSubstore?.value || "",
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
  if (els.customerName) els.customerName.value = state?.customerName || "";
  if (els.customerSubstore)
    els.customerSubstore.value = state?.customerSubstore || "";
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
    volume_liters: getVolLitersFromProduct(product),
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

function applyImportedOrderDraft(draft) {
  if (!draft) return;

  cart.clear();
  draftCatalogInputs.clear();
  importedCatalogCodes.clear();
  rankedCatalogCodes = [];
  if (els.q) els.q.value = "";
  if (els.toolbarQty) els.toolbarQty.value = "";
  if (els.customerName) els.customerName.value = draft.customerName || "";
  if (els.customerSubstore)
    els.customerSubstore.value =
      draft.customerSubstore || draft.branchDescription || draft.branchCode || "";
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

function applyCustomerRankingDraft(draft) {
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
  if (els.customerName) els.customerName.value = draft.customerName || "";
  if (els.customerSubstore)
    els.customerSubstore.value =
      draft.customerSubstore || draft.branchDescription || draft.branchCode || "";
  if (els.customerEmail) els.customerEmail.value = draft.customerEmail || "";
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

function getVolLitersFromProduct(product) {
  const value =
    product?.volume_liters ??
    product?.volume_l ??
    product?.volumeLiters ??
    product?.volume ??
    0;
  return toNum(value, 0);
}

function calcVolumes(pieces, piecesPerPack, volumeLitersPerPack) {
  const qty = toNum(pieces, 0);
  const perPack = Math.max(1, parseInt(piecesPerPack, 10) || 1);
  const packages = qty / perPack;
  const totalLiters = packages * toNum(volumeLitersPerPack, 0);
  return { packages, totalLiters };
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
  renderPager({ page: safePage, pages, total });
  els.countPill.textContent = `${total} προϊόντα`;
  saveOrderFormState();
}

async function loadCatalog(page = 1, query = "") {
  els.catalogStatus.textContent = "";

  try {
    const response = await fetch(`catalog.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    allCatalog = Array.isArray(data.items) ? data.items : [];
    if (importedOrderDraft) {
      updateCodesDatalist(allCatalog);
      applyImportedOrderDraft(importedOrderDraft);
      return;
    }

    const rankingDraft = loadOrderFormRankingDraft();
    if (rankingDraft) {
      updateCodesDatalist(allCatalog);
      applyCustomerRankingDraft(rankingDraft);
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
    volume_liters: getVolLitersFromProduct(product),
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
  if (!els.catalog) return [];

  return Array.from(els.catalog.querySelectorAll("tr[data-id]"))
    .map((row) => {
      const productId = parseInt(row.getAttribute("data-id"), 10);
      const product = allCatalog.find((item) => item.id === productId);
      if (!product) return null;

      const piecesInput = row.querySelector(".qty-inline input");
      const packsInput = row.querySelector(".packsInput");
      const piecesPerPack = parseInt(product.pieces_per_package, 10) || 1;
      const packs = parseInt(packsInput?.value || "", 10);
      const qtyPieces = parseInt(piecesInput?.value || "", 10);

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
      entry.piecesInput?.setCustomValidity(
        `Πρέπει να είναι πολλαπλάσιο των ${entry.piecesPerPack}.`,
      );
      entry.piecesInput?.reportValidity();
      entry.piecesInput?.focus();
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
          <th class="th-packs">ΣΥΣΚΕΥΑΣΙΕΣ</th>
          <th class="th-qty">ΤΕΜΑΧΙΑ</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" style="padding:14px; color:#6b6b6b;">Δεν βρέθηκαν προϊόντα.</td></tr>`}
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

function renderCart() {
  if (cart.size === 0) {
    els.cart.innerHTML = `<div class="small">Δεν έχετε επιλέξει προϊόντα.</div>`;
    return;
  }

  let totalLiters = 0;
  let totalPackages = 0;

  const itemsHtml = Array.from(cart.values())
    .map((item) => {
      // Sidebar totals are derived here so the cart stays self-contained.
      const totals = calcVolumes(
        item.qty,
        item.pieces_per_package,
        item.volume_liters,
      );
      totalLiters += totals.totalLiters;
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
              <div class="small" style="margin-top:2px;">${totals.packages} συσκ. - ${fmtM3(totals.totalLiters)} m³</div>
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
      <div style="font-weight:700;">${fmtM3(totalLiters)} m³ (${totalPackages} συσκ.)</div>
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
  let totalLiters = 0;
  let totalPieces = 0;

  for (const item of cartMap.values()) {
    const piecesPerPack = Math.max(
      1,
      parseInt(item.pieces_per_package, 10) || 1,
    );
    const qty = parseInt(item.qty, 10) || 0;
    const packages = qty / piecesPerPack;
    const volumePerPack = toNum(item.volume_liters, 0);

    totalPieces += qty;
    totalPackages += packages;
    totalLiters += packages * volumePerPack;
  }

  return {
    totalPackages,
    totalLiters,
    totalM3: totalLiters / 1000,
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
  const comments = document.getElementById("notes")?.value?.trim() || "";

  const rows = [
    ["ΣΤΟΙΧΕΙΑ ΠΑΡΑΓΓΕΛΙΑΣ", ""],
    ["Ονοματεπώνυμο / Επωνυμία Πελάτη", customerName],
    ["Υποκατάστημα", customerSubstore],
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

  const customerName =
    document.getElementById("customerName")?.value?.trim() || "";
  const customerSubstore =
    document.getElementById("customerSubstore")?.value?.trim() || "";
  const customerEmail =
    document.getElementById("customerEmail")?.value?.trim() || "";
  const notes = els.notes?.value?.trim() || "";

  // Reuse the same normalized payload for both Gmail and Outlook draft flows.
  return {
    subject: `Παραγγελία B2B (${customerName || "Πελάτης"})`,
    payload: {
      customer_name: customerName,
      customer_substore: customerSubstore,
      customer_email: customerEmail,
      notes,
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

sendGmailBtn?.addEventListener("click", () => {
  if (!lastOrder) return;

  try {
    els.submitStatus.textContent = "Δημιουργία Excel...";
    const filename = downloadOrderExcelFromCart(cart);
    const body = buildEmailBodyNice(
      lastOrder.payload,
      lastOrder.totals,
      filename,
    );

    closeSubmitModal();
    els.submitStatus.textContent = `Κατέβηκε το ${filename}. Άνοιξε draft στο Gmail.`;
    openGmailDraft(ORDERS_EMAIL, lastOrder.subject, body);
  } catch (error) {
    console.error(error);
    els.submitStatus.textContent = `Σφάλμα Excel: ${error?.message || error}`;
  }
});

sendMailtoBtn?.addEventListener("click", () => {
  if (!lastOrder) return;

  try {
    els.submitStatus.textContent = "Δημιουργία Excel...";
    const filename = downloadOrderExcelFromCart(cart);
    const body = buildEmailBodyNice(
      lastOrder.payload,
      lastOrder.totals,
      filename,
    );

    closeSubmitModal();
    els.submitStatus.textContent = `Κατέβηκε το ${filename}. Άνοιξε draft στο Outlook.`;
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
els.customerSubstore?.addEventListener("input", saveOrderFormState);
els.customerEmail?.addEventListener("input", saveOrderFormState);
els.notes?.addEventListener("input", saveOrderFormState);

els.toolbarAddBtn?.addEventListener("click", addFromUnifiedBar);
els.preparedAddBtn?.addEventListener("click", () => {
  addPreparedCatalogRowsToCart();
});
els.clearBtn?.addEventListener("click", () => {
  cart.clear();
  renderCart();
  if (els.customerName) els.customerName.value = "";
  if (els.customerSubstore) els.customerSubstore.value = "";
  if (els.customerEmail) els.customerEmail.value = "";
  if (els.notes) els.notes.value = "";
  setToolbarMsg("");
  saveOrderFormState();
});
els.submitBtn?.addEventListener("click", submitOrder);
els.downloadExcelBtn?.addEventListener("click", downloadExcelOnly);
els.reloadBtn?.addEventListener("click", clearTopFilters);
els.reloadBtn?.addEventListener("pointerup", clearTopFilters);
els.reloadBtn?.addEventListener("touchend", clearTopFilters, {
  passive: false,
});
window.addEventListener("pagehide", saveOrderFormState);
window.addEventListener("beforeunload", saveOrderFormState);

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
