import assert from "node:assert/strict";
import test from "node:test";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { initDatabaseSchema } from "../lib/db/init-schema.js";

async function freshSchema() {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await initDatabaseSchema({ db, kind: "sqlite" });
  return db;
}

test("orders carries the ES1 writer lifecycle columns", async () => {
  const db = await freshSchema();
  try {
    const columns = await db.all(`PRAGMA table_info(orders)`);
    const byName = new Map(columns.map((col) => [col.name, col]));

    for (const name of [
      "es1_document_code",
      "es1_written_at",
      "es1_write_error",
      "es1_write_attempts",
      // The exact branch code the ΠΑΡ writer resolves the ES1 delivery site from.
      "customer_substore_code",
      // Reversible soft-archive for the admin panel's "Clear".
      "archived_at",
    ]) {
      assert.ok(byName.has(name), `orders.${name} should exist`);
    }

    // The attempt counter must default to 0, not NULL - the writer increments it.
    assert.equal(byName.get("es1_write_attempts").dflt_value, "0");
    assert.equal(byName.get("es1_write_attempts").notnull, 1);

    // dispatch_date stays on the table but is unused now (was only ever set at the
    // removed approval step).
    assert.ok(byName.has("dispatch_date"), "orders.dispatch_date should still exist");
  } finally {
    await db.close();
  }
});

test("a new orders row defaults to the writer-ready status", async () => {
  const db = await freshSchema();
  try {
    await db.run(
      `INSERT INTO orders(customer_name, total_qty_pieces, total_net_value, created_at)
       VALUES ('Test', 0, 0, '2026-08-27T00:00:00.000Z')`,
    );
    const row = await db.get(`SELECT status FROM orders LIMIT 1`);
    assert.equal(row.status, "ready");
  } finally {
    await db.close();
  }
});

test("the (status, submitted_at) index still covers the writer poll query", async () => {
  const db = await freshSchema();
  try {
    const indexes = await db.all(`PRAGMA index_list(orders)`);
    assert.ok(
      indexes.some((idx) => idx.name === "idx_orders_status_submitted_at"),
      "idx_orders_status_submitted_at should exist",
    );
  } finally {
    await db.close();
  }
});
