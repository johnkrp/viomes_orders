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
