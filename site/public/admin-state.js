import { ADMIN_STATE_KEY } from "./admin-constants.js";

export function loadAdminState() {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function clearAdminState() {
  try {
    window.sessionStorage.removeItem(ADMIN_STATE_KEY);
  } catch (_error) {
    // Ignore storage failures.
  }
}

export function fillSearchFields(elements, filters = {}) {
  if (elements.customerNameQuery) elements.customerNameQuery.value = filters.customer_name || "";
  if (elements.customerCodeQuery) elements.customerCodeQuery.value = filters.customer_code || "";
  if (elements.branchCodeQuery) elements.branchCodeQuery.value = filters.branch_code || "";
  if (elements.branchDescriptionQuery) elements.branchDescriptionQuery.value = filters.branch_description || "";
}

export function saveAdminState(elements, state) {
  try {
    const payload = {
      authenticatedLikely: !elements.dashboardPanel?.hidden,
      username: elements.username?.value || "",
      searchPanelCollapsed: Boolean(elements.searchPanelContent?.hidden),
      searchFields: state.getCustomerSearchFilters(),
      currentCustomerSearchFilters: state.currentCustomerSearchFilters,
      currentSearchResults: state.currentSearchResults,
      currentCustomerCode: state.currentCustomerCode,
      currentBranchCode: state.currentBranchCode,
      currentAvailableBranches: state.currentAvailableBranches,
      currentSalesTimeRange: state.currentSalesTimeRange,
      currentProductSalesPage: state.currentProductSalesPage,
      currentReceivablesPage: state.currentReceivablesPage,
      currentRecentOrdersPage: state.currentRecentOrdersPage,
      currentOpenOrdersPage: state.currentOpenOrdersPage,
      currentPreApprovalOrdersPage: state.currentPreApprovalOrdersPage,
      selectedOrderId: state.selectedOrderId,
      branchSelectorSearch: elements.branchSelectorSearch?.value || "",
      productSalesMetric: elements.productSalesMetric?.value || "revenue",
      lastRenderedStatsPayload: state.lastRenderedStatsPayload,
    };
    window.sessionStorage.setItem(ADMIN_STATE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // Ignore storage failures.
  }
}
