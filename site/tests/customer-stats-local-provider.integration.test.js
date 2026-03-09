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

test("SQLite-backed local-order stats integration returns the expected contract", async () => {
  const db = await openTestDb();
  const currentYear = new Date().getUTCFullYear();
  const previousYear = currentYear - 1;
  const olderYear = currentYear - 2;

  try {
    await db.run(
      `
        INSERT INTO customers(code, name, email, source)
        VALUES (?, ?, ?, ?)
      `,
      ["C001", "Alpha Store", "buyer@example.com", "local"],
    );

    const productOne = await db.run(
      `
        INSERT INTO products(code, description, image_url, pieces_per_package, volume_liters, color, description_norm, color_norm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ["P1", "First", "", 1, 0, "Red", "first", "red"],
    );
    const productTwo = await db.run(
      `
        INSERT INTO products(code, description, image_url, pieces_per_package, volume_liters, color, description_norm, color_norm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ["P2", "Second", "", 1, 0, "Blue", "second", "blue"],
    );

    const orderOne = await db.run(
      `
        INSERT INTO orders(customer_name, customer_email, customer_code, notes, total_qty_pieces, total_net_value, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ["Alpha Store", "buyer@example.com", "C001", "Seed order", 2, 25, `${olderYear}-01-05`],
    );
    const orderTwo = await db.run(
      `
        INSERT INTO orders(customer_name, customer_email, customer_code, notes, total_qty_pieces, total_net_value, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ["Alpha Store", "buyer@example.com", "C001", "First order", 5, 70, `${previousYear}-12-10`],
    );
    const orderThree = await db.run(
      `
        INSERT INTO orders(customer_name, customer_email, customer_code, notes, total_qty_pieces, total_net_value, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ["Alpha Store", "buyer@example.com", "C001", "Second order", 10, 175.6, `${currentYear}-02-15`],
    );

    await db.run(
      `
        INSERT INTO order_lines(order_id, product_id, qty_pieces, unit_price, discount_pct, line_net_value)
        VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)
      `,
      [
        orderTwo.lastID,
        productTwo.lastID,
        5,
        14,
        0,
        70,
        orderThree.lastID,
        productOne.lastID,
        8,
        17.5,
        0,
        140,
        orderThree.lastID,
        productOne.lastID,
        2,
        17.8,
        0,
        35.6,
      ],
    );

    const provider = createSqliteCustomerStatsProvider({ db, sqlDialect: "sqlite" });
    const payload = await provider.getCustomerStats("C001");

    assert.equal(payload.customer.code, "C001");
    assert.equal(payload.customer.email, "buyer@example.com");
    assert.equal(payload.summary.total_orders, 3);
    assert.equal(payload.summary.total_pieces, 15);
    assert.equal(payload.summary.total_revenue, 245.6);
    assert.equal(payload.summary.average_order_value, 81.87);
    assert.equal(payload.top_products_by_qty[0].code, "P1");
    assert.equal(payload.top_products_by_value[0].code, "P1");
    assert.equal(payload.recent_orders.length, 3);
    assert.equal(payload.detailed_orders.length, 3);
    assert.equal(payload.detailed_orders[0].lines.length, 2);
    assert.equal(payload.monthly_sales.current_year[1].revenue, 175.6);
    assert.equal(payload.monthly_sales.previous_year[11].revenue, 70);
    assert.equal(payload.monthly_sales.yearly_series.length, 3);
    assert.equal(payload.monthly_sales.yearly_series[0].year, olderYear);
    assert.equal(payload.monthly_sales.yearly_series[0].months[0].revenue, 25);
  } finally {
    await db.close();
  }
});
