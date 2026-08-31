import assert from "node:assert/strict";
import test from "node:test";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { initDatabaseSchema } from "../lib/db/init-schema.js";
import {
  archiveOrderSubmissions,
  listOrderSubmissions,
  unarchiveOrderSubmissions,
  validateListFilterDate,
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
async function insertOrder(db, { status = "ready", submittedAt, archivedAt = null }) {
  seq += 1;
  const at = submittedAt || `2026-08-${String(seq).padStart(2, "0")}T09:00:00.000Z`;
  const { lastID } = await db.run(
    `
      INSERT INTO orders(
        customer_name, customer_code, status, submitted_at, created_at,
        archived_at, total_qty_pieces, total_net_value
      ) VALUES ('Cust', 'C1', ?, ?, ?, ?, 1, 10)
    `,
    [status, at, at, archivedAt],
  );
  await db.run(
    `INSERT INTO order_lines(order_id, product_id, qty_pieces, unit_price, line_net_value)
     VALUES (?, 1, 1, 5, 5)`,
    [lastID],
  );
  return lastID;
}

test("validateListFilterDate accepts a real date, rejects a fake one, and has no ±day window", () => {
  assert.equal(validateListFilterDate("2020-01-15", "Από"), "2020-01-15");
  assert.equal(validateListFilterDate("", "Από"), null);
  assert.equal(validateListFilterDate(undefined, "Από"), null);
  assert.throws(() => validateListFilterDate("2026-02-31", "Από"), /not a real date/);
  assert.throws(() => validateListFilterDate("31/01/2026", "Από"), /YYYY-MM-DD/);
});

test("listOrderSubmissions filters submitted_at by an inclusive [from, to] day range", async () => {
  const db = await freshDb();
  try {
    await insertOrder(db, { submittedAt: "2026-07-10T08:00:00.000Z" });
    const wanted = await insertOrder(db, {
      submittedAt: "2026-07-15T23:30:00.000Z",
    });
    await insertOrder(db, { submittedAt: "2026-07-20T08:00:00.000Z" });

    const oneDay = await listOrderSubmissions(db, {
      from: "2026-07-15",
      to: "2026-07-15",
    });
    assert.deepEqual(
      oneDay.map((row) => row.id),
      [wanted],
    );

    const spanning = await listOrderSubmissions(db, {
      from: "2026-07-10",
      to: "2026-07-15",
    });
    assert.equal(spanning.length, 2);
  } finally {
    await db.close();
  }
});

test("listOrderSubmissions hides archived rows by default and shows only them with { archived: true }", async () => {
  const db = await freshDb();
  try {
    const live = await insertOrder(db, {});
    const archived = await insertOrder(db, {
      archivedAt: "2026-08-30T10:00:00.000Z",
    });

    const def = await listOrderSubmissions(db);
    assert.deepEqual(
      def.map((row) => row.id),
      [live],
    );

    const arch = await listOrderSubmissions(db, { archived: true });
    assert.deepEqual(
      arch.map((row) => row.id),
      [archived],
    );
  } finally {
    await db.close();
  }
});

test("archiveOrderSubmissions stamps archivable rows and refuses writing/written", async () => {
  const db = await freshDb();
  try {
    const ready = await insertOrder(db, { status: "ready" });
    const failed = await insertOrder(db, { status: "write_failed" });
    const writing = await insertOrder(db, { status: "writing" });
    const written = await insertOrder(db, { status: "written" });

    const result = await archiveOrderSubmissions(db, [
      ready,
      failed,
      writing,
      written,
      999999,
    ]);

    assert.equal(result.archived, 2);
    const skippedById = new Map(result.skipped.map((s) => [s.id, s.reason]));
    assert.equal(skippedById.get(writing), "status_not_archivable");
    assert.equal(skippedById.get(written), "status_not_archivable");
    assert.equal(skippedById.get(999999), "not_found");

    // The two refused rows are still visible in the default (non-archived) view.
    const visibleIds = (await listOrderSubmissions(db)).map((row) => row.id);
    assert.ok(visibleIds.includes(writing));
    assert.ok(visibleIds.includes(written));
    assert.ok(!visibleIds.includes(ready));
  } finally {
    await db.close();
  }
});

test("archiveOrderSubmissions reports an already-archived id without erroring", async () => {
  const db = await freshDb();
  try {
    const id = await insertOrder(db, {
      status: "held",
      archivedAt: "2026-08-01T00:00:00.000Z",
    });
    const result = await archiveOrderSubmissions(db, [id]);
    assert.equal(result.archived, 0);
    assert.equal(result.skipped[0].reason, "already_archived");
  } finally {
    await db.close();
  }
});

test("unarchiveOrderSubmissions returns a row to the default view", async () => {
  const db = await freshDb();
  try {
    const id = await insertOrder(db, {
      status: "ready",
      archivedAt: "2026-08-01T00:00:00.000Z",
    });

    const result = await unarchiveOrderSubmissions(db, [id]);
    assert.equal(result.unarchived, 1);

    const visibleIds = (await listOrderSubmissions(db)).map((row) => row.id);
    assert.deepEqual(visibleIds, [id]);
    // A second unarchive is a no-op.
    assert.equal((await unarchiveOrderSubmissions(db, [id])).unarchived, 0);
  } finally {
    await db.close();
  }
});
