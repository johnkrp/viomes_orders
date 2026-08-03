import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderFormDraftFromSelectedOrder } from "../public/admin-handoff.js";

test("order form handoff draft keeps stable line shape", () => {
  const draft = buildOrderFormDraftFromSelectedOrder(
    {
      order_id: "ORD-1",
      customer_email: "buyer@example.com",
      notes: "Urgent",
      lines: [
        { code: "P001", qty: 12, description: "Primer" },
        { code: "P002", qty: 0, description: "Skip" },
      ],
    },
    { textContent: "Alpha Store" },
  );

  assert.equal(draft.customerName, "Alpha Store");
  assert.equal(draft.customerEmail, "buyer@example.com");
  assert.equal(draft.sourceOrderId, "ORD-1");
  assert.deepEqual(draft.lines, [{ code: "P001", qty: 12, description: "Primer" }]);
});

test("order form handoff draft carries the customer code and the order's own branch, not the currently-loaded customer's", () => {
  const draft = buildOrderFormDraftFromSelectedOrder(
    {
      order_id: "ORD-2",
      branch_code: "B02",
      branch_description: "Θεσσαλονίκη",
      lines: [{ code: "P001", qty: 1, description: "Primer" }],
    },
    {
      code: "CUST-1",
      name: "Alpha Store",
      branch_code: "B01",
      branch_description: "Αθήνα",
    },
  );

  assert.equal(draft.customerCode, "CUST-1");
  assert.equal(draft.branchCode, "B02");
  assert.equal(draft.branchDescription, "Θεσσαλονίκη");
  // Must equal exactly branch_description (or branch_code), the same shape
  // populateCustomerSubstoreOptions() uses for its <option value>.
  assert.equal(draft.customerSubstore, "Θεσσαλονίκη");
});
