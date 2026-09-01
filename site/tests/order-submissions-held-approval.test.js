import assert from "node:assert/strict";
import test from "node:test";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { initDatabaseSchema } from "../lib/db/init-schema.js";
import {
  approveHeldOrderSubmission,
  listOrderSubmissions,
  rejectHeldOrderSubmission,
} from "../lib/order-submissions.js";

async function freshDb() {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await initDatabaseSchema({ db, kind: "sqlite" });
  await db.run(
    `INSERT INTO products(code, description, pieces_per_package) VALUES ('P1', 'Prod 1', 1)`,
  );
  return db;
}

let seq = 0;
async function insertOrder(db, { status = "ready" } = {}) {
  seq += 1;
  const at = `2026-09-0${seq}T09:00:00.000Z`;
  const { lastID } = await db.run(
    `INSERT INTO orders(customer_name, customer_code, status, submitted_at, created_at,
        total_qty_pieces, total_net_value)
     VALUES ('Cust', 'C1', ?, ?, ?, 1, 10)`,
    [status, at, at],
  );
  await db.run(
    `INSERT INTO order_lines(order_id, product_id, qty_pieces, unit_price, line_net_value)
     VALUES (?, 1, 1, 5, 5)`,
    [lastID],
  );
  return lastID;
}

test("schema carries the denylist held-for-approval columns", async () => {
  const db = await freshDb();
  try {
    const cols = new Set(
      (await db.all(`PRAGMA table_info(orders)`)).map((c) => c.name),
    );
    for (const name of [
      "writer_override",
      "held_reason",
      "approved_by",
      "approved_at",
      "rejected_by",
      "rejected_at",
    ]) {
      assert.ok(cols.has(name), `orders.${name} should exist`);
    }
  } finally {
    await db.close();
  }
});

test("approve releases a held order back to ready with writer_override set", async () => {
  const db = await freshDb();
  try {
    const id = await insertOrder(db, { status: "held" });
    await db.run(`UPDATE orders SET held_reason = 'denylisted' WHERE id = ?`, [id]);

    const result = await approveHeldOrderSubmission(db, id, "owner1");
    assert.equal(result.status, "ready");
    assert.equal(result.writer_override, true);
    assert.equal(result.approved_by, "owner1");

    const row = await db.get(
      `SELECT status, writer_override, approved_by, es1_write_error FROM orders WHERE id = ?`,
      [id],
    );
    assert.equal(row.status, "ready");
    assert.equal(row.writer_override, 1);
    assert.equal(row.approved_by, "owner1");
    assert.equal(row.es1_write_error, null);

    // The row is back in the default admin feed as a normal ready order.
    const listed = await listOrderSubmissions(db);
    assert.equal(listed[0].id, id);
    assert.equal(listed[0].status, "ready");
    assert.equal(listed[0].writer_override, true);
  } finally {
    await db.close();
  }
});

test("reject moves a held order to rejected and folds the reason into es1_write_error", async () => {
  const db = await freshDb();
  try {
    const id = await insertOrder(db, { status: "held" });

    const result = await rejectHeldOrderSubmission(
      db,
      id,
      "owner1",
      "duplicate of ΠΑΡ-Μ-1",
    );
    assert.equal(result.status, "rejected");

    const row = await db.get(
      `SELECT status, rejected_by, es1_write_error FROM orders WHERE id = ?`,
      [id],
    );
    assert.equal(row.status, "rejected");
    assert.equal(row.rejected_by, "owner1");
    assert.equal(row.es1_write_error, "rejected by owner1: duplicate of ΠΑΡ-Μ-1");

    const listed = await listOrderSubmissions(db);
    assert.equal(listed[0].status, "rejected");
  } finally {
    await db.close();
  }
});

test("approve / reject only act on a held row — anything else is a 409", async () => {
  const db = await freshDb();
  try {
    const ready = await insertOrder(db, { status: "ready" });
    const written = await insertOrder(db, { status: "written" });

    await assert.rejects(
      () => approveHeldOrderSubmission(db, ready, "owner1"),
      (err) => err.status === 409,
    );
    await assert.rejects(
      () => rejectHeldOrderSubmission(db, written, "owner1"),
      (err) => err.status === 409,
    );
    await assert.rejects(
      () => approveHeldOrderSubmission(db, 999999, "owner1"),
      (err) => err.status === 409,
    );

    // Nothing moved.
    assert.equal(
      (await db.get(`SELECT status FROM orders WHERE id = ?`, [ready])).status,
      "ready",
    );
  } finally {
    await db.close();
  }
});

test("a second approve of an already-approved order is a 409 (no double writer_override churn)", async () => {
  const db = await freshDb();
  try {
    const id = await insertOrder(db, { status: "held" });
    await approveHeldOrderSubmission(db, id, "owner1");
    await assert.rejects(
      () => approveHeldOrderSubmission(db, id, "owner2"),
      (err) => err.status === 409,
    );
    const row = await db.get(
      `SELECT approved_by FROM orders WHERE id = ?`,
      [id],
    );
    assert.equal(row.approved_by, "owner1", "first approver stands");
  } finally {
    await db.close();
  }
});
