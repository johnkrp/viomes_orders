import { DEFAULT_SALES_TIME_RANGE } from "./admin-constants.js";

export async function handleLogin(context, event) {
  event.preventDefault();
  context.setStatus("");

  const username = (context.elements.username.value || "").trim();
  const password = context.elements.password.value || "";
  if (!username || !password) {
    context.setStatus("Συμπληρώστε όνομα χρήστη και κωδικό.", "error");
    return;
  }

  context.elements.loginBtn.disabled = true;

  try {
    const result = await context.apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    context.setAuthenticatedUI(result);
    void context.loadLatestImportMessage(result);
    context.resetSearchSuggestions();
    context.resetSearchResults();
    context.resetStats();
    context.setSearchPanelCollapsed(false);
    context.elements.password.value = "";
    context.focusPrimarySearchField();
    context.setStatus("Η σύνδεση ολοκληρώθηκε επιτυχώς.", "ok");
  } catch (error) {
    context.setStatus(`Η σύνδεση απέτυχε: ${error.message}`, "error");
  } finally {
    context.elements.loginBtn.disabled = false;
  }
}

export async function handleLogout(context) {
  context.elements.logoutBtn.disabled = true;

  try {
    await context.apiFetch("/api/admin/logout", { method: "POST" });
    context.setAuthenticatedUI({ authenticated: false });
    context.resetSearchSuggestions();
    context.resetSearchResults();
    context.resetStats();
    context.setSearchPanelCollapsed(false);
    context.elements.username.focus();
    context.setStatus("Η αποσύνδεση ολοκληρώθηκε επιτυχώς.", "ok");
    context.clearAdminState();
  } catch (error) {
    context.setStatus(`Η αποσύνδεση απέτυχε: ${error.message}`, "error");
  } finally {
    context.elements.logoutBtn.disabled = false;
  }
}

export async function fetchCustomerStats(context, customerCode, branchCode = "", scopeFilters = context.state.currentCustomerSearchFilters) {
  context.setStatus("");

  if (!customerCode) {
    context.setStatus("Συμπληρώστε κωδικό πελάτη.", "error");
    context.elements.customerCodeQuery.focus();
    return;
  }

  const requestId = ++context.counters.currentStatsRequestId.value;
  const loadingMessage = branchCode
    ? `Φόρτωση στοιχείων για το υποκατάστημα ${branchCode}...`
    : "Φόρτωση στοιχείων πελάτη...";
  context.setStatsLoading(true, loadingMessage);
  context.setStatus(loadingMessage, "info");

  try {
    const params = new URLSearchParams();
    if (branchCode) params.set("branch_code", branchCode);
    const normalizedScopeFilters = {
      branch_code: String(scopeFilters?.branch_code || "").trim(),
      branch_description: String(scopeFilters?.branch_description || "").trim(),
    };
    if (normalizedScopeFilters.branch_code) params.set("filter_branch_code", normalizedScopeFilters.branch_code);
    if (normalizedScopeFilters.branch_description) params.set("filter_branch_description", normalizedScopeFilters.branch_description);
    const normalizedSalesTimeRange = context.getSelectedSalesTimeRange();
    context.state.currentSalesTimeRange = normalizedSalesTimeRange || DEFAULT_SALES_TIME_RANGE;
    context.syncSalesTimeRangeControls(context.state.currentSalesTimeRange);
    params.set("sales_time_range", context.state.currentSalesTimeRange);
    const payload = await context.apiFetch(
      `/api/admin/customers/${encodeURIComponent(customerCode)}/stats${params.toString() ? `?${params.toString()}` : ""}`,
      { method: "GET" },
    );
    if (requestId !== context.counters.currentStatsRequestId.value) return;
    context.renderStats(payload);
    void fetchAllRangeStats(context, customerCode, branchCode, scopeFilters);
    context.setCurrentCustomerSearchFilters({
      ...context.state.currentCustomerSearchFilters,
      ...scopeFilters,
      customer_code: payload?.customer?.code || customerCode,
    });
    context.state.currentCustomerCode = payload?.customer?.code || customerCode;
    context.state.currentBranchCode = payload?.customer?.branch_code || branchCode || "";
    context.resetSearchSuggestions();
    context.setStatus(
      `Φορτώθηκαν τα στοιχεία για τον πελάτη ${customerCode}${context.state.currentBranchCode ? ` / υποκατάστημα ${context.state.currentBranchCode}` : ""}.`,
      "ok",
    );
  } catch (error) {
    if (requestId !== context.counters.currentStatsRequestId.value) return;
    context.resetStats();
    context.setStatus(`Η φόρτωση στοιχείων απέτυχε: ${error.message}`, "error");
  } finally {
    if (requestId === context.counters.currentStatsRequestId.value) {
      await context.setStatsLoading(false);
    }
  }
}

export async function fetchAllRangeStats(context, customerCode, branchCode = "", scopeFilters = context.state.currentCustomerSearchFilters) {
  if (!customerCode) return;
  const requestId = ++context.counters.currentAllRangeRequestId.value;
  try {
    const params = new URLSearchParams();
    if (branchCode) params.set("branch_code", branchCode);
    const normalizedScopeFilters = {
      branch_code: String(scopeFilters?.branch_code || "").trim(),
      branch_description: String(scopeFilters?.branch_description || "").trim(),
    };
    if (normalizedScopeFilters.branch_code) params.set("filter_branch_code", normalizedScopeFilters.branch_code);
    if (normalizedScopeFilters.branch_description) params.set("filter_branch_description", normalizedScopeFilters.branch_description);
    params.set("sales_time_range", "all");
    const payload = await context.apiFetch(
      `/api/admin/customers/${encodeURIComponent(customerCode)}/stats${params.toString() ? `?${params.toString()}` : ""}`,
      { method: "GET" },
    );
    if (requestId !== context.counters.currentAllRangeRequestId.value) return;
    const key = `${payload?.customer?.code || customerCode}::${payload?.customer?.branch_code || branchCode || ""}`;
    context.state.allRangeStatsKey = key;
    context.state.allRangeDetailedOrders = Array.isArray(payload?.detailed_orders) ? payload.detailed_orders : [];
    if (payload?.range_summary) context.cacheRangeSummary(key, "all", payload.range_summary);
    if (!context.state.lastRenderedStatsPayload) return;
    const currentKey = `${context.state.currentCustomerCode || customerCode}::${context.state.currentBranchCode || branchCode || ""}`;
    if (currentKey !== key) return;
    context.renderStats(context.state.lastRenderedStatsPayload);
  } catch (_error) {
    // Ignore background fetch errors for all-range stats.
  }
}

export async function fetchRangeSummary(
  context,
  range,
  customerCode = context.state.currentCustomerCode,
  branchCode = context.state.currentBranchCode,
  scopeFilters = context.state.currentCustomerSearchFilters,
) {
  if (!customerCode) return;
  const normalizedRange = context.normalizeSalesTimeRange(range);
  const statsKey = `${customerCode || ""}::${branchCode || ""}`;
  const cacheKey = context.buildRangeSummaryKey(statsKey, normalizedRange);
  if (context.state.rangeSummaryPending.has(cacheKey)) return;
  context.state.rangeSummaryPending.add(cacheKey);

  try {
    const params = new URLSearchParams();
    if (branchCode) params.set("branch_code", branchCode);
    const normalizedScopeFilters = {
      branch_code: String(scopeFilters?.branch_code || "").trim(),
      branch_description: String(scopeFilters?.branch_description || "").trim(),
    };
    if (normalizedScopeFilters.branch_code) params.set("filter_branch_code", normalizedScopeFilters.branch_code);
    if (normalizedScopeFilters.branch_description) params.set("filter_branch_description", normalizedScopeFilters.branch_description);
    params.set("sales_time_range", normalizedRange);
    const payload = await context.apiFetch(
      `/api/admin/customers/${encodeURIComponent(customerCode)}/stats${params.toString() ? `?${params.toString()}` : ""}`,
      { method: "GET" },
    );
    const key = `${payload?.customer?.code || customerCode}::${payload?.customer?.branch_code || branchCode || ""}`;
    if (payload?.range_summary) context.cacheRangeSummary(key, normalizedRange, payload.range_summary);
    if (!context.state.lastRenderedStatsPayload) return;
    const currentKey = `${context.state.currentCustomerCode || customerCode}::${context.state.currentBranchCode || branchCode || ""}`;
    if (currentKey !== key) return;
    context.renderStats(context.state.lastRenderedStatsPayload);
  } catch (_error) {
    // Ignore background errors for card range summaries.
  } finally {
    context.state.rangeSummaryPending.delete(cacheKey);
  }
}

export async function searchCustomers(context, event) {
  event.preventDefault();
  context.setStatus("");

  const filters = context.getCustomerSearchFilters();
  if (!context.hasCustomerSearchFilters(filters)) {
    context.setStatus("Συμπληρώστε τουλάχιστον ένα πεδίο αναζήτησης.", "error");
    context.elements.customerNameQuery.focus();
    return;
  }

  const requestId = ++context.counters.currentSearchRequestId.value;
  context.setSearchLoading(true, "Αναζήτηση πελατών...");
  context.setStatus("Αναζήτηση πελατών...", "info");
  try {
    context.setCurrentCustomerSearchFilters(filters);
    context.resetSearchSuggestions();
    await context.performCustomerSearch(filters, {
      limit: 20,
      renderTable: true,
      renderSuggestions: false,
      silent: false,
    });
    if (requestId !== context.counters.currentSearchRequestId.value) return;
  } catch (error) {
    if (requestId !== context.counters.currentSearchRequestId.value) return;
    context.resetSearchResults();
    context.setStatus(`Η αναζήτηση πελατών απέτυχε: ${error.message}`, "error");
  } finally {
    if (requestId === context.counters.currentSearchRequestId.value) {
      await context.setSearchLoading(false);
    }
  }
}

export function clearCustomerStats(context) {
  if (context.elements.customerNameQuery) context.elements.customerNameQuery.value = "";
  if (context.elements.customerCodeQuery) context.elements.customerCodeQuery.value = "";
  if (context.elements.branchCodeQuery) context.elements.branchCodeQuery.value = "";
  if (context.elements.branchDescriptionQuery) context.elements.branchDescriptionQuery.value = "";
  context.state.currentSalesTimeRange = DEFAULT_SALES_TIME_RANGE;
  context.syncSalesTimeRangeControls(DEFAULT_SALES_TIME_RANGE);
  context.setCurrentCustomerSearchFilters({});
  context.resetSearchSuggestions();
  context.resetSearchResults();
  context.resetStats();
  context.setSearchPanelCollapsed(false);
  context.setStatus("");
  context.focusPrimarySearchField();
}

export function handleBranchSelectionChange(context) {
  if (!context.state.currentCustomerCode) return;
  const branchCode = context.elements.branchSelector?.value || "";
  if (context.elements.branchSelectorSearch) {
    const selectedBranch = context.state.currentAvailableBranches.find((branch) => (branch.branch_code || "") === branchCode);
    context.elements.branchSelectorSearch.value = branchCode ? context.getBranchOptionLabel(selectedBranch) : "";
  }
  void fetchCustomerStats(context, context.state.currentCustomerCode, branchCode, context.state.currentCustomerSearchFilters);
}

export function handleBranchSearchInput(context) {
  if (!context.state.currentAvailableBranches.length) return;
  context.filterBranches(context.elements.branchSelectorSearch?.value || "");
}

export function handleBranchSearchKeydown(context, event) {
  if (!context.state.currentAvailableBranches.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    context.elements.branchSelector?.focus();
    if (context.elements.branchSelector) {
      const nextIndex = Math.min(context.elements.branchSelector.selectedIndex + 1, context.elements.branchSelector.options.length - 1);
      context.elements.branchSelector.selectedIndex = Math.max(nextIndex, 0);
    }
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const filtered = context.filterBranches(context.elements.branchSelectorSearch?.value || "", "");
    const firstBranch = filtered[0];
    const branchCode = firstBranch?.branch_code || "";
    if (context.elements.branchSelector) {
      context.elements.branchSelector.value = branchCode;
    }
    void fetchCustomerStats(context, context.state.currentCustomerCode, branchCode, context.state.currentCustomerSearchFilters);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    if (context.elements.branchSelectorSearch) {
      context.elements.branchSelectorSearch.value = "";
    }
    context.filterBranches("", context.state.currentBranchCode);
  }
}

export function expandSearchPanel(context) {
  context.setSearchPanelCollapsed(false);
  context.focusPrimarySearchField();
}
