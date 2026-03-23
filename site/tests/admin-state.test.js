import test from "node:test";
import assert from "node:assert/strict";
import { loadAdminState, saveAdminState } from "../public/admin-state.js";

function createSessionStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("admin state saves and restores stable payload keys", () => {
  global.window = { sessionStorage: createSessionStorage() };

  const elements = {
    dashboardPanel: { hidden: false },
    username: { value: "admin" },
    searchPanelContent: { hidden: true },
    branchSelectorSearch: { value: "B1" },
    productSalesMetric: { value: "pieces" },
  };
  const state = {
    getCustomerSearchFilters: () => ({ customer_name: "Alpha", customer_code: "C001", branch_code: "", branch_description: "" }),
    currentCustomerSearchFilters: { customer_name: "Alpha", customer_code: "C001", branch_code: "", branch_description: "" },
    currentSearchResults: [{ code: "C001" }],
    currentCustomerCode: "C001",
    currentBranchCode: "B1",
    currentAvailableBranches: [{ branch_code: "B1" }],
    currentSalesTimeRange: "3m",
    currentProductSalesPage: 2,
    currentReceivablesPage: 1,
    currentRecentOrdersPage: 1,
    currentOpenOrdersPage: 1,
    currentPreApprovalOrdersPage: 1,
    selectedOrderId: "ORD-1",
    lastRenderedStatsPayload: { customer: { code: "C001" } },
  };

  saveAdminState(elements, state);
  const restored = loadAdminState();

  assert.equal(restored.username, "admin");
  assert.equal(restored.searchPanelCollapsed, true);
  assert.equal(restored.productSalesMetric, "pieces");
  assert.equal(restored.currentCustomerCode, "C001");
  assert.equal(restored.selectedOrderId, "ORD-1");
});
