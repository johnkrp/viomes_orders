import assert from "node:assert/strict";
import test from "node:test";

import { renderRecentOrdersTable } from "../public/admin-render.js";

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
