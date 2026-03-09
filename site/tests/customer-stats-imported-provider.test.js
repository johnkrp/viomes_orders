import test from "node:test";
import assert from "node:assert/strict";
import { createSqliteCustomerStatsProvider } from "../lib/customer-stats/sqlite-provider.js";

function createImportedDbFixture() {
  const currentYear = new Date().getUTCFullYear();
  const previousYear = currentYear - 1;
  const olderYear = currentYear - 2;

  return {
    async get(sql, params = []) {
      if (sql.includes("SELECT COUNT(*) AS n FROM imported_sales_lines")) return { n: 3 };
      if (sql.includes("MAX(delivery_code) AS delivery_code") && sql.includes("FROM imported_sales_lines")) {
        if (params[0] === "MISS") return undefined;
        return {
          code: "C001",
          name: "Alpha Store",
          email: null,
          delivery_code: "D1",
          delivery_description: "Main store",
          branch_code: "B1",
          branch_description: "Branch 1",
        };
      }
      if (sql.includes("COUNT(*) AS total_orders") && sql.includes("FROM (")) {
        return {
          total_orders: 2,
          total_pieces: 15,
          total_revenue: 245.6,
          last_order_date: `${currentYear}-02-15`,
        };
      }
      if (sql.includes("AS revenue_3m") && sql.includes("FROM imported_sales_lines")) {
        return {
          revenue_3m: 200,
          revenue_6m: 245.6,
          revenue_12m: 245.6,
        };
      }
      throw new Error(`Unexpected db.get SQL: ${sql}`);
    },

    async all(sql, params = []) {
      if (sql.includes("COUNT(*) AS raw_rows") && sql.includes("GROUP BY COALESCE(branch_code")) {
        return [
          {
            branch_code: "B1",
            branch_description: "Branch 1",
            raw_rows: 2,
            orders: 1,
            revenue: 175.6,
            last_order_date: `${currentYear}-02-15`,
          },
          {
            branch_code: "B2",
            branch_description: "Branch 2",
            raw_rows: 1,
            orders: 1,
            revenue: 70,
            last_order_date: `${previousYear}-12-10`,
          },
        ];
      }
      if (sql.includes("GROUP BY item_code")) {
        return [
          {
            code: "P2",
            description: "Second",
            pieces: 5,
            orders: 1,
            revenue: 70,
            avg_unit_price: 14,
          },
          {
            code: "P1",
            description: "First",
            pieces: 10,
            orders: 2,
            revenue: 175.6,
            avg_unit_price: 17.56,
          },
        ];
      }
      if (sql.includes("GROUP BY customer_code, document_no, order_date") && sql.includes("LIMIT 10")) {
        return [
          {
            order_id: "C001::2026-02-15::INV-2",
            document_no: "INV-2",
            created_at: `${currentYear}-02-15`,
            total_lines: 1,
            total_pieces: 10,
            total_net_value: 175.6,
            average_discount_pct: 0,
          },
          {
            order_id: "C001::2025-12-10::INV-1",
            document_no: "INV-1",
            created_at: `${previousYear}-12-10`,
            total_lines: 2,
            total_pieces: 5,
            total_net_value: 70,
            average_discount_pct: 0,
          },
        ];
      }
      if (sql.includes("GROUP BY customer_code, document_no, order_date") && sql.includes("LIMIT 6")) {
        return [
          {
            order_id: "C001::2026-02-15::INV-2",
            document_no: "INV-2",
            created_at: `${currentYear}-02-15`,
            total_lines: 1,
            total_pieces: 10,
            total_net_value: 175.6,
            average_discount_pct: 0,
          },
        ];
      }
      if (sql.includes("FROM imported_sales_lines") && sql.includes("AND document_no = ?")) {
        return [
          {
            code: "P1",
            description: "First",
            qty: 10,
            unit_price: 17.56,
            discount_pct: 0,
            line_net_value: 175.6,
          },
        ];
      }
      if (sql.includes("GROUP BY order_month")) {
        if (params[1] === olderYear) return [{ month: 1, revenue: 25, pieces: 2 }];
        if (params[1] === currentYear) return [{ month: 2, revenue: 175.6, pieces: 10 }];
        if (params[1] === previousYear) return [{ month: 12, revenue: 70, pieces: 5 }];
      }
      throw new Error(`Unexpected db.all SQL: ${sql}`);
    },
  };
}

test("imported-data provider builds the customer stats contract from imported tables", async () => {
  const olderYear = new Date().getUTCFullYear() - 2;
  const provider = createSqliteCustomerStatsProvider({
    db: createImportedDbFixture(),
    sqlDialect: "mysql",
  });

  const payload = await provider.getCustomerStats("C001");

  assert.equal(payload.customer.code, "C001");
  assert.equal(payload.customer.name, "Alpha Store");
  assert.equal(payload.customer.aggregation_level, "customer");
  assert.equal(payload.customer.branch_code, null);
  assert.equal(payload.customer.branch_description, null);
  assert.equal(payload.summary.total_orders, 2);
  assert.equal(payload.summary.total_pieces, 15);
  assert.equal(payload.summary.total_revenue, 245.6);
  assert.equal(payload.summary.average_order_value, 122.8);
  assert.equal(payload.product_sales.items.length, 2);
  assert.equal(payload.top_products_by_qty[0].code, "P1");
  assert.equal(payload.top_products_by_value[0].code, "P1");
  assert.equal(payload.recent_orders.length, 2);
  assert.equal(payload.detailed_orders.length, 1);
  assert.equal(payload.detailed_orders[0].lines.length, 1);
  assert.equal(payload.available_branches.length, 2);
  assert.equal(payload.monthly_sales.current_year[1].revenue, 175.6);
  assert.equal(payload.monthly_sales.previous_year[11].revenue, 70);
  assert.equal(payload.monthly_sales.yearly_series.length, 3);
  assert.equal(payload.monthly_sales.yearly_series[0].year, olderYear);
  assert.equal(payload.monthly_sales.yearly_series[0].months[0].revenue, 25);
});

test("imported-data provider returns 404 when imported customer is missing", async () => {
  const provider = createSqliteCustomerStatsProvider({
    db: createImportedDbFixture(),
    sqlDialect: "mysql",
  });

  await assert.rejects(provider.getCustomerStats("MISS"), (error) => {
    assert.equal(error.status, 404);
    assert.match(error.message, /Customer not found/);
    return true;
  });
});
