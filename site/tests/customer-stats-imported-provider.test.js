import assert from "node:assert/strict";
import test from "node:test";
import { createSqliteCustomerStatsProvider } from "../lib/customer-stats/sqlite-provider.js";

function createImportedDbFixture() {
  const currentYear = new Date().getUTCFullYear();
  const previousYear = currentYear - 1;
  const olderYear = currentYear - 2;

  return {
    async get(sql, params = []) {
      if (sql.includes("information_schema.columns")) {
        return { n: 1 };
      }
      if (sql.includes("SELECT COUNT(*) AS n FROM imported_sales_lines"))
        return { n: 3 };
      if (sql.includes("FROM imported_customers")) {
        if (params[1] === "MISS") return undefined;
        return {
          code: "C001",
          name: "Alpha Store",
          email: null,
          delivery_code: "D1",
          delivery_description: "Main store",
          branch_code: null,
          branch_description: null,
        };
      }
      if (
        sql.includes("MAX(delivery_code) AS delivery_code") &&
        sql.includes("FROM imported_sales_lines")
      ) {
        if (params[1] === "MISS") return undefined;
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
      if (sql.includes("FROM imported_orders")) {
        return {
          total_orders: 2,
          total_pieces: 15,
          total_revenue: 245.6,
          last_order_date: `${currentYear}-02-15`,
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
      if (
        sql.includes("AS revenue_3m") &&
        sql.includes("FROM imported_orders")
      ) {
        return {
          revenue_3m: 200,
          revenue_6m: 245.6,
          revenue_12m: 245.6,
        };
      }
      if (
        sql.includes("AS revenue_3m") &&
        sql.includes("FROM imported_sales_lines")
      ) {
        return {
          revenue_3m: 200,
          revenue_6m: 245.6,
          revenue_12m: 245.6,
        };
      }
      if (sql.includes("FROM imported_customer_ledgers")) {
        return {
          customer_code: "C001",
          customer_name: "Alpha Store",
          commercial_balance: 999.99,
          ledger_balance: 321.45,
          credit: 120.5,
          pending_instruments: 0,
          email: "alpha@example.com",
          is_inactive: 0,
          salesperson_code: "90",
        };
      }
      throw new Error(`Unexpected db.get SQL: ${sql}`);
    },

    async all(sql, params = []) {
      if (sql.includes("FROM imported_customer_branches")) {
        return [
          {
            branch_code: "B1",
            branch_description: "Branch 1",
            orders: 1,
            revenue: 175.6,
            last_order_date: `${currentYear}-02-15`,
          },
          {
            branch_code: "B2",
            branch_description: "Branch 2",
            orders: 1,
            revenue: 70,
            last_order_date: `${previousYear}-12-10`,
          },
        ];
      }
      if (sql.includes("FROM imported_customer_ledger_lines")) {
        return [
          {
            document_date: `${currentYear}-02-15`,
            document_no: "INV-2",
            reason: "Ledger movement",
            debit: 175.6,
            credit: 0,
            running_debit: 50,
            running_credit: 10,
            ledger_balance: 321.45,
          },
          {
            document_date: `${previousYear}-12-10`,
            document_no: "INV-1",
            reason: "Older movement",
            debit: 70,
            credit: 0,
            running_debit: 25,
            running_credit: 5,
            ledger_balance: 145.85,
          },
        ];
      }
      if (sql.includes("FROM imported_product_sales")) {
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
      if (sql.includes("GROUP BY item_code")) {
        if (sql.includes("SUBSTR(order_date, 1, 10) >= ?")) {
          return [
            {
              code: "P1",
              description: "First",
              pieces: 10,
              orders: 1,
              revenue: 175.6,
              avg_unit_price: 17.56,
            },
          ];
        }
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
      if (sql.includes("FROM imported_orders") && sql.includes("LIMIT 100")) {
        if (sql.includes("SUBSTR(created_at, 1, 10) >= ?")) {
          return [
            {
              order_id: "C001::2026-02-15::INV-2",
              document_no: "INV-2",
              created_at: `${currentYear}-02-15`,
              progress_step: "2",
              total_lines: 1,
              total_pieces: 10,
              total_net_value: 175.6,
              average_discount_pct: 0,
            },
          ];
        }
        return [
          {
            order_id: "C001::2026-02-15::INV-2",
            document_no: "INV-2",
            created_at: `${currentYear}-02-15`,
            progress_step: "2",
            total_lines: 1,
            total_pieces: 10,
            total_net_value: 175.6,
            average_discount_pct: 0,
          },
          {
            order_id: "C001::2025-12-10::INV-1",
            document_no: "INV-1",
            created_at: `${previousYear}-12-10`,
            progress_step: "1",
            total_lines: 2,
            total_pieces: 5,
            total_net_value: 70,
            average_discount_pct: 0,
          },
        ];
      }
      if (
        sql.includes("FROM imported_orders") &&
        sql.includes("ORDER BY created_at DESC, document_no DESC") &&
        !sql.includes("LIMIT 100")
      ) {
        return [
          {
            order_id: "C001::2026-02-15::INV-2",
            document_no: "INV-2",
            created_at: `${currentYear}-02-15`,
            progress_step: "2",
            total_lines: 1,
            total_pieces: 10,
            total_net_value: 175.6,
            average_discount_pct: 0,
          },
        ];
      }
      if (sql.includes("FROM imported_open_orders")) {
        return [];
      }
      if (
        sql.includes("GROUP BY customer_code, document_no, order_date") &&
        sql.includes("LIMIT 10")
      ) {
        if (sql.includes("SUBSTR(order_date, 1, 10) >= ?")) {
          return [
            {
              order_id: "C001::2026-02-15::INV-2",
              document_no: "INV-2",
              created_at: `${currentYear}-02-15`,
              progress_step: "2",
              total_lines: 1,
              total_pieces: 10,
              total_net_value: 175.6,
              average_discount_pct: 0,
            },
          ];
        }
        return [
          {
            order_id: "C001::2026-02-15::INV-2",
            document_no: "INV-2",
            created_at: `${currentYear}-02-15`,
              progress_step: "2",
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
      if (
        sql.includes("GROUP BY customer_code, document_no, order_date") &&
        sql.includes("LIMIT 6")
      ) {
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
      if (
        sql.includes("FROM imported_sales_lines") &&
        sql.includes("AND document_no = ?")
      ) {
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
      if (sql.includes("FROM imported_monthly_sales")) {
        if (params[1] === olderYear)
          return [{ month: 1, revenue: 25, pieces: 2 }];
        if (params[1] === currentYear)
          return [{ month: 2, revenue: 175.6, pieces: 10 }];
        if (params[1] === previousYear)
          return [{ month: 12, revenue: 70, pieces: 5 }];
      }
      if (sql.includes("GROUP BY order_month")) {
        if (sql.includes("SUBSTR(order_date, 1, 10) >= ?")) {
          if (params[1] === olderYear) return [];
          if (params[1] === currentYear)
            return [{ month: 2, revenue: 175.6, pieces: 10 }];
          if (params[1] === previousYear) return [];
        }
        if (params[1] === olderYear)
          return [{ month: 1, revenue: 25, pieces: 2 }];
        if (params[1] === currentYear)
          return [{ month: 2, revenue: 175.6, pieces: 10 }];
        if (params[1] === previousYear)
          return [{ month: 12, revenue: 70, pieces: 5 }];
      }
      throw new Error(`Unexpected db.all SQL: ${sql}`);
    },
  };
}

test("imported-data provider builds the customer stats contract from imported tables", async () => {
  const currentYear = new Date().getUTCFullYear();
  const olderYear = new Date().getUTCFullYear() - 2;
  const provider = createSqliteCustomerStatsProvider({
    db: createImportedDbFixture(),
    sqlDialect: "mysql",
  });

  const payload = await provider.getCustomerStats("C001");

  assert.equal(payload.customer.code, "C001");
  assert.equal(payload.customer.name, "Alpha Store");
  assert.equal(payload.customer.email, "alpha@example.com");
  assert.equal(payload.customer.aggregation_level, "customer");
  assert.equal(payload.customer.branch_code, null);
  assert.equal(payload.customer.branch_description, null);
  assert.equal(payload.summary.total_orders, 2);
  assert.equal(payload.summary.total_pieces, 15);
  assert.equal(payload.summary.total_revenue, 245.6);
  assert.equal(payload.summary.average_order_value, 122.8);
  assert.equal(payload.product_sales.items.length, 1);
  assert.equal(payload.top_products_by_qty[0].code, "P1");
  assert.equal(payload.top_products_by_value[0].code, "P1");
  assert.equal(payload.recent_orders.length, 1);
  assert.equal(payload.recent_orders[0].progress_step, "2");
  assert.equal(payload.detailed_orders.length, 1);
  assert.equal(payload.detailed_orders[0].lines.length, 1);
  assert.equal(payload.available_branches.length, 2);
  assert.equal(payload.monthly_sales.current_year[1].revenue, 175.6);
  assert.equal(payload.monthly_sales.previous_year[11].revenue, 70);
  assert.equal(payload.monthly_sales.yearly_series.length, 3);
  assert.equal(payload.monthly_sales.yearly_series[0].year, olderYear);
  assert.equal(payload.monthly_sales.yearly_series[0].months[0].revenue, 25);
  assert.equal(payload.receivables.open_balance, 321.45);
  assert.equal(payload.receivables.overdue_balance, 0);
  assert.equal(payload.receivables.progressive_credit, 120.5);
  assert.equal(payload.receivables.items.length, 2);
  assert.deepEqual(payload.receivables.items[0], {
    document_date: `${currentYear}-02-15`,
    document_no: "INV-2",
    reason: "Ledger movement",
    debit: 175.6,
    credit: 0,
    ledger_balance: 321.45,
  });
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

test("imported-data provider falls back to zero receivables when no ledger snapshot exists", async () => {
  const db = createImportedDbFixture();
  const originalGet = db.get.bind(db);
  db.get = async (sql, params = []) => {
    if (sql.includes("FROM imported_customer_ledgers")) return undefined;
    return originalGet(sql, params);
  };

  const provider = createSqliteCustomerStatsProvider({
    db,
    sqlDialect: "mysql",
  });

  const payload = await provider.getCustomerStats("C001");
  assert.equal(payload.receivables.open_balance, 0);
  assert.equal(payload.receivables.overdue_balance, 0);
  assert.equal(payload.receivables.progressive_credit, 0);
  assert.deepEqual(payload.receivables.items, []);
});

test("imported-data provider tolerates sales tables without progression columns", async () => {
  const db = createImportedDbFixture();
  const provider = createSqliteCustomerStatsProvider({
    db,
    sqlDialect: "sqlite",
  });

  const payload = await provider.getCustomerStats("C001");
  assert.equal(payload.detailed_orders.length, 1);
  assert.equal(payload.detailed_orders[0].lines[0].code, "P1");
});
