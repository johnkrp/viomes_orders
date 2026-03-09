import test from "node:test";
import assert from "node:assert/strict";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { createSqliteCustomerStatsProvider } from "../lib/customer-stats/sqlite-provider.js";
import { initDatabaseSchema } from "../lib/db/init-schema.js";

async function openTestDb() {
  const raw = await open({
    filename: ":memory:",
    driver: sqlite3.Database,
  });

  const db = {
    async get(sql, params = []) {
      return raw.get(sql, params);
    },
    async all(sql, params = []) {
      return raw.all(sql, params);
    },
    async run(sql, params = []) {
      const result = await raw.run(sql, params);
      return {
        lastID: Number(result?.lastID || 0),
        changes: Number(result?.changes || 0),
      };
    },
    async exec(sql) {
      return raw.exec(sql);
    },
    async close() {
      return raw.close();
    },
  };

  await initDatabaseSchema({ db, kind: "sqlite" });
  return db;
}

test("SQLite-backed imported stats integration returns the expected contract", async () => {
  const db = await openTestDb();
  const currentYear = new Date().getUTCFullYear();
  const previousYear = currentYear - 1;
  const olderYear = currentYear - 2;

  try {
    await db.run(
      `
        INSERT INTO imported_customers(customer_code, customer_name, delivery_code, delivery_description, source_file)
        VALUES (?, ?, ?, ?, ?)
      `,
      ["C001", "Alpha Store", "D1", "Main Store", "2026.CSV"],
    );

    await db.run(
      `
        INSERT INTO imported_orders(
          order_id, document_no, customer_code, customer_name, created_at, total_lines,
          total_pieces, total_net_value, average_discount_pct, document_type, delivery_code,
          delivery_description, source_file
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "C001::2026-02-15::INV-2",
        "INV-2",
        "C001",
        "Alpha Store",
        `${currentYear}-02-15`,
        1,
        10,
        175.6,
        0,
        "TI",
        "D1",
        "Main Store",
        "2026.CSV",
      ],
    );
    await db.run(
      `
        INSERT INTO imported_orders(
          order_id, document_no, customer_code, customer_name, created_at, total_lines,
          total_pieces, total_net_value, average_discount_pct, document_type, delivery_code,
          delivery_description, source_file
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "C001::2025-12-10::INV-1",
        "INV-1",
        "C001",
        "Alpha Store",
        `${previousYear}-12-10`,
        2,
        5,
        70,
        0,
        "TI",
        "D1",
        "Main Store",
        "2025.CSV",
      ],
    );

    await db.run(
      `
        INSERT INTO imported_product_sales(customer_code, item_code, item_description, revenue, pieces, orders, avg_unit_price)
        VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "C001",
        "P1",
        "First",
        175.6,
        10,
        2,
        17.56,
        "C001",
        "P2",
        "Second",
        70,
        5,
        1,
        14,
      ],
    );

    await db.run(
      `
        INSERT INTO imported_monthly_sales(customer_code, order_year, order_month, revenue, pieces)
        VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
      `,
      [
        "C001",
        olderYear,
        1,
        25,
        2,
        "C001",
        currentYear,
        2,
        175.6,
        10,
        "C001",
        previousYear,
        12,
        70,
        5,
      ],
    );

    await db.run(
      `
        INSERT INTO imported_sales_lines(
          source_file, order_date, order_year, order_month, document_no, document_type,
          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
          customer_code, customer_name, delivery_code, delivery_description, account_code,
          account_description, branch_code, branch_description, note_1
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
               (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "2026.CSV",
        `${currentYear}-02-15`,
        currentYear,
        2,
        "INV-2",
        "TI",
        "P1",
        "First",
        "PCS",
        10,
        10,
        17.56,
        175.6,
        "C001",
        "Alpha Store",
        "D1",
        "Main Store",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Note",
        "2025.CSV",
        `${previousYear}-12-10`,
        previousYear,
        12,
        "INV-1",
        "TI",
        "P2",
        "Second",
        "PCS",
        5,
        5,
        14,
        70,
        "C001",
        "Alpha Store",
        "D2",
        "Second Store",
        "A1",
        "Account",
        "B2",
        "Branch 2",
        "Note",
      ],
    );

    const provider = createSqliteCustomerStatsProvider({ db, sqlDialect: "sqlite" });
    const payload = await provider.getCustomerStats("C001");

    assert.equal(payload.customer.code, "C001");
    assert.equal(payload.customer.aggregation_level, "customer");
    assert.equal(payload.customer.branch_code, null);
    assert.equal(payload.customer.branch_description, null);
    assert.equal(payload.summary.total_orders, 2);
    assert.equal(payload.summary.total_revenue, 245.6);
    assert.equal(payload.summary.average_order_value, 122.8);
    assert.equal(payload.top_products_by_qty[0].code, "P1");
    assert.equal(payload.top_products_by_value[0].code, "P1");
    assert.equal(payload.available_branches.length, 2);
    assert.equal(payload.monthly_sales.current_year[1].revenue, 175.6);
    assert.equal(payload.monthly_sales.previous_year[11].revenue, 70);
    assert.equal(payload.monthly_sales.yearly_series.length, 3);
    assert.equal(payload.monthly_sales.yearly_series[0].year, olderYear);
    assert.equal(payload.monthly_sales.yearly_series[0].months[0].revenue, 0);
    assert.equal(payload.detailed_orders[0].lines[0].code, "P1");

    const branchPayload = await provider.getCustomerStats("C001", { branchCode: "B1" });
    assert.equal(branchPayload.customer.aggregation_level, "branch");
    assert.equal(branchPayload.customer.branch_code, "B1");
    assert.equal(branchPayload.summary.total_orders, 1);
    assert.equal(branchPayload.summary.total_revenue, 175.6);

    const scopedPayload = await provider.getCustomerStats("C001", {
      branchScopeDescription: "Branch 1",
    });
    assert.equal(scopedPayload.customer.aggregation_level, "customer");
    assert.equal(scopedPayload.customer.branch_code, null);
    assert.equal(scopedPayload.available_branches.length, 1);
    assert.equal(scopedPayload.available_branches[0].branch_code, "B1");
    assert.equal(scopedPayload.summary.total_orders, 1);
    assert.equal(scopedPayload.summary.total_revenue, 175.6);
  } finally {
    await db.close();
  }
});
