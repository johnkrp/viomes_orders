import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStatsPayload } from "../lib/customer-stats/shared.js";

test("normalizeStatsPayload preserves contract defaults and monthly coverage", () => {
  const payload = normalizeStatsPayload(
    {
      customer: {
        code: "C001",
        name: "Store 1",
        branch_code: "B1",
        branch_description: "Branch 1",
      },
      summary: {
        total_orders: 2,
        total_revenue: 123.456,
        last_order_date: "2026-03-01",
      },
      monthly_sales: {
        yearly_series: [
          { year: 2024, months: [{ month: 1, revenue: 25, pieces: 1 }] },
          { year: 2025, months: [{ month: 12, revenue: 50, pieces: 2 }] },
          { year: 2026, months: [{ month: 3, revenue: 100, pieces: 5 }] },
        ],
        current_year: [{ month: 3, revenue: 100, pieces: 5 }],
        previous_year: [{ month: 12, revenue: 50, pieces: 2 }],
      },
      product_sales: {
        metric: "pieces",
        items: [{ code: "P1", description: "Prod", pieces: 4, orders: 2, revenue: 99.995 }],
      },
      receivables: {
        progressive_credit: 55.25,
        items: [{ document: "INV-1", amount: 10, balance: 3, reason: "Movement", debit: 10, credit: 7 }],
      },
      available_branches: [
        { branch_code: "B1", branch_description: "Branch 1", orders: 2, revenue: 123.456, raw_rows: 4 },
      ],
      recent_orders: [
        {
          order_id: "A",
          created_at: "2026-02-15",
          total_lines: 1,
          total_pieces: 2,
          total_net_value: 50,
          average_discount_pct: 0,
        },
      ],
    },
    "C001",
  );

  assert.equal(payload.customer.code, "C001");
  assert.equal(payload.customer.aggregation_level, "store");
  assert.equal(payload.customer.branch_code, "B1");
  assert.equal(payload.customer.branch_description, "Branch 1");
  assert.equal(payload.summary.total_revenue, 123.46);
  assert.equal(payload.monthly_sales.current_year.length, 12);
  assert.deepEqual(payload.monthly_sales.current_year[2], { month: 3, revenue: 100, pieces: 5 });
  assert.equal(payload.monthly_sales.yearly_series.length, 3);
  assert.equal(payload.monthly_sales.yearly_series[0].year, 2024);
  assert.equal(payload.monthly_sales.yearly_series[0].months[0].revenue, 25);
  assert.equal(payload.product_sales.metric, "pieces");
  assert.deepEqual(payload.product_sales.items[0], {
    code: "P1",
    description: "Prod",
    pieces: 4,
    orders: 2,
    revenue: 100,
    avg_unit_price: 0,
  });
  assert.deepEqual(payload.receivables.items[0], {
    document_no: "INV-1",
    document_date: null,
    reason: "Movement",
    due_date: null,
    amount_total: 10,
    amount_paid: 7,
    open_balance: 3,
    debit: 10,
    credit: 7,
    ledger_balance: 3,
    is_overdue: false,
    status: "",
  });
  assert.equal(payload.receivables.progressive_credit, 55.25);
  assert.deepEqual(payload.available_branches[0], {
    branch_code: "B1",
    branch_description: "Branch 1",
    orders: 2,
    revenue: 123.46,
    raw_rows: 4,
    last_order_date: null,
  });
});
