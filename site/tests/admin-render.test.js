import assert from "node:assert/strict";
import test from "node:test";

import { renderRecentOrdersTable, renderSelectedOrderDetails } from "../public/admin-render.js";

test("recent orders table renders the progress step column", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll: () => [],
  };

  try {
    const body = { innerHTML: "" };
    renderRecentOrdersTable({
      state: {
        currentDetailedOrders: [
          {
            order_id: "C001::2026-04-09::INV-1",
            created_at: "2026-04-09",
            ordered_at: "2026-04-08",
            progress_step: "5. ΑΠΕΣΤΑΛΗ",
            total_lines: 4,
            total_pieces: 12,
            total_net_value: 48.25,
            average_discount_pct: 35,
          },
        ],
        currentRecentOrdersPage: 1,
        recentOrdersSort: { key: "created_at", direction: "desc" },
        selectedOrderId: null,
      },
      elements: {
        recentOrdersBody: body,
        recentOrdersPagination: null,
        recentOrdersPageInfo: null,
        recentOrdersPrevBtn: null,
        recentOrdersNextBtn: null,
      },
      formatDisplayOrderId: (value) => value,
    });

    assert.match(body.innerHTML, /5\. ΑΠΕΣΤΑΛΗ/);
    assert.equal((body.innerHTML.match(/<td/g) || []).length, 9);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("selected order details render the branch metadata", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll: () => [],
  };

  try {
    const body = { innerHTML: "" };
    renderSelectedOrderDetails({
      state: {
        selectedOrderId: "C001::2026-04-09::INV-1",
        currentDetailedOrders: [
          {
            order_id: "C001::2026-04-09::INV-1",
            created_at: "2026-04-09",
            ordered_at: "2026-04-08",
            branch_code: "B1",
            branch_description: "Branch 1",
            document_type: "ΤΔΑ",
            total_net_value: 48.25,
            lines: [
              {
                code: "P1",
                description: "Product 1",
                qty: 2,
                unit_price: 12,
                discount_pct: 0,
                line_net_value: 24,
              },
            ],
          },
        ],
        currentDetailedOpenOrders: [],
        currentDetailedPreApprovalOrders: [],
      },
      elements: {
        detailedOrdersList: body,
      },
      findDetailedOrder(orderId) {
        return this.state.currentDetailedOrders.find(
          (order) => String(order.order_id) === String(orderId),
        );
      },
      formatDisplayOrderId: (value) => value,
    });

    assert.match(body.innerHTML, /Υποκατάστημα: B1/);
    assert.match(body.innerHTML, /Branch 1/);
    assert.match(body.innerHTML, /Τύπος: ΤΔΑ/);
  } finally {
    globalThis.document = originalDocument;
  }
});
