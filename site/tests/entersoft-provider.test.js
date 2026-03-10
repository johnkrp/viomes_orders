import test from "node:test";
import assert from "node:assert/strict";
import { createEntersoftCustomerStatsProvider } from "../lib/customer-stats/entersoft-provider.js";

test("Entersoft provider forwards branch query params and preserves branch contract fields", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          customer: {
            code: "C001",
            name: "Alpha Store",
            aggregation_level: "branch",
            branch_code: "B1",
            branch_description: "Branch 1",
          },
          summary: {
            total_orders: 2,
            total_revenue: 245.6,
            total_pieces: 15,
          },
          monthly_sales: {
            current_year: [{ month: 2, revenue: 175.6, pieces: 10 }],
            previous_year: [{ month: 12, revenue: 70, pieces: 5 }],
          },
          available_branches: [
            {
              branch_code: "B1",
              branch_description: "Branch 1",
              orders: 1,
              revenue: 175.6,
              raw_rows: 2,
              last_order_date: "2026-02-15",
            },
          ],
        };
      },
    };
  };

  try {
    const provider = createEntersoftCustomerStatsProvider({
      baseUrl: "https://entersoft.example",
      pathTemplate: "/customers/{code}/stats",
      responseShape: "entersoft-customer-stats-v1",
    });

    const payload = await provider.getCustomerStats("C001", {
      branchCode: "B1",
      branchScopeCode: "B",
      branchScopeDescription: "Branch",
    });

    assert.equal(
      requests[0].url,
      "https://entersoft.example/customers/C001/stats?branch_code=B1&filter_branch_code=B&filter_branch_description=Branch",
    );
    assert.equal(payload.customer.aggregation_level, "branch");
    assert.equal(payload.customer.branch_code, "B1");
    assert.equal(payload.customer.branch_description, "Branch 1");
    assert.equal(payload.available_branches.length, 1);
    assert.deepEqual(payload.available_branches[0], {
      branch_code: "B1",
      branch_description: "Branch 1",
      orders: 1,
      revenue: 175.6,
      raw_rows: 2,
      last_order_date: "2026-02-15",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Entersoft provider accepts viomes-admin-stats payloads with branch metadata intact", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        customer: {
          code: "C001",
          name: "Alpha Store",
          aggregation_level: "customer",
          branch_code: null,
          branch_description: null,
        },
        summary: {
          total_orders: 2,
          total_revenue: 245.6,
        },
        available_branches: [
          { branch_code: "B1", branch_description: "Branch 1", revenue: 175.6, orders: 1 },
          { branch_code: "B2", branch_description: "Branch 2", revenue: 70, orders: 1 },
        ],
      };
    },
  });

  try {
    const provider = createEntersoftCustomerStatsProvider({
      baseUrl: "https://entersoft.example",
      responseShape: "viomes-admin-stats",
    });

    const payload = await provider.getCustomerStats("C001");

    assert.equal(payload.customer.code, "C001");
    assert.equal(payload.available_branches.length, 2);
    assert.equal(payload.available_branches[1].branch_code, "B2");
    assert.equal(payload.available_branches[1].branch_description, "Branch 2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
