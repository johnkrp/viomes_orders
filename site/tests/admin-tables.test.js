import assert from "node:assert/strict";
import test from "node:test";
import {
  getRecentOrdersForTable,
  getSortedProductSalesForTable,
} from "../public/admin-tables.js";

test("product sales table sorting respects primary metric direction", () => {
  const context = {
    elements: {
      productSalesMetric: { value: "revenue" },
    },
    state: {
      currentProductSales: [
        {
          code: "B",
          description: "Beta",
          revenue: 10,
          pieces: 5,
          orders: 1,
          avg_unit_price: 2,
        },
        {
          code: "A",
          description: "Alpha",
          revenue: 20,
          pieces: 3,
          orders: 1,
          avg_unit_price: 6.67,
        },
      ],
      productSalesSort: { key: "primary_metric", direction: "desc" },
    },
  };

  const items = getSortedProductSalesForTable(context);
  assert.deepEqual(
    items.map((item) => item.code),
    ["A", "B"],
  );
});

test("recent orders table sorting respects created_at desc", () => {
  const context = {
    state: {
      currentDetailedOrders: [
        {
          order_id: "1",
          created_at: "2026-03-10",
          ordered_at: "2026-03-09",
          total_lines: 1,
          total_pieces: 1,
          total_net_value: 1,
          average_discount_pct: 0,
        },
        {
          order_id: "2",
          created_at: "2026-03-12",
          ordered_at: "2026-03-11",
          total_lines: 1,
          total_pieces: 1,
          total_net_value: 1,
          average_discount_pct: 0,
        },
      ],
      recentOrdersSort: { key: "created_at", direction: "desc" },
    },
  };

  const items = getRecentOrdersForTable(context);
  assert.deepEqual(
    items.map((item) => item.order_id),
    ["2", "1"],
  );
});

test("recent orders table prefers recent_orders payload when available", () => {
  const context = {
    state: {
      currentDetailedOrders: [
        {
          order_id: "1",
          created_at: "2026-03-10",
          ordered_at: "2026-03-09",
          total_lines: 1,
          total_pieces: 1,
          total_net_value: 1,
          average_discount_pct: 0,
          progress_step: "-",
        },
      ],
      lastRenderedStatsPayload: {
        recent_orders: [
          {
            order_id: "1",
            created_at: "2026-03-10",
            ordered_at: "2026-03-09",
            total_lines: 1,
            total_pieces: 1,
            total_net_value: 1,
            average_discount_pct: 0,
            progress_step: "5. ΑΠΕΣΤΑΛΗ",
          },
        ],
      },
      recentOrdersSort: { key: "created_at", direction: "desc" },
    },
  };

  const items = getRecentOrdersForTable(context);
  assert.equal(items[0].progress_step, "5. ΑΠΕΣΤΑΛΗ");
});
