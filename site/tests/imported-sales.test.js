import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETE_DUPLICATES_SQL,
  DUPLICATE_GROUP_BY,
  DUPLICATE_SUMMARY_SQL,
  ensureImportedCustomerBranchProjection,
  getImportedSalesProjectionHealth,
  IMPORTED_CUSTOMER_BRANCHES_COUNT_SQL,
  IMPORTED_MONTHLY_CARDINALITY_SQL,
  IMPORTED_ORDER_COLLISIONS_SQL,
  IMPORTED_ORDER_CARDINALITY_SQL,
  IMPORTED_PRODUCT_CARDINALITY_SQL,
  IMPORTED_SALES_LINES_COUNT_SQL,
  IMPORTED_SALES_ARCHITECTURE,
  LATEST_IMPORT_RUN_SQL,
  MISSING_MIRRORED_CUSTOMERS_SQL,
  ORPHAN_MIRRORED_CUSTOMERS_SQL,
  PREVIEW_DUPLICATES_SQL,
  REBUILD_IMPORTED_CUSTOMER_BRANCHES_SQL,
  rebuildImportedSalesData,
} from "../lib/imported-sales.js";

test("shared imported-sales SQL covers logical duplicate identity and collision checks", () => {
  assert.match(DUPLICATE_GROUP_BY, /order_date/);
  assert.match(DUPLICATE_GROUP_BY, /document_no/);
  assert.match(DUPLICATE_GROUP_BY, /note_1/);
  assert.match(DUPLICATE_SUMMARY_SQL, /duplicate_groups/);
  assert.match(PREVIEW_DUPLICATES_SQL, /duplicate_rows_to_delete/);
  assert.match(DELETE_DUPLICATES_SQL, /keeper\.id < duplicate_row\.id/);
  assert.match(IMPORTED_ORDER_COLLISIONS_SQL, /GROUP BY document_no, customer_code, created_at/);
  assert.match(MISSING_MIRRORED_CUSTOMERS_SQL, /missing_mirrors/);
  assert.match(ORPHAN_MIRRORED_CUSTOMERS_SQL, /orphan_mirrors/);
  assert.match(IMPORTED_ORDER_CARDINALITY_SQL, /grouped_orders_count/);
  assert.match(IMPORTED_PRODUCT_CARDINALITY_SQL, /grouped_products_count/);
  assert.match(IMPORTED_MONTHLY_CARDINALITY_SQL, /grouped_months_count/);
  assert.match(LATEST_IMPORT_RUN_SQL, /rows_skipped_duplicate/);
  assert.equal(IMPORTED_SALES_ARCHITECTURE.rawFactTable, "imported_sales_lines");
});

test("rebuildImportedSalesData runs the expected rebuild sequence", async () => {
  const executed = [];
  const db = {
    async run(sql) {
      executed.push(sql.trim());
      return { changes: 0 };
    },
  };

  await rebuildImportedSalesData(db);

  assert.equal(executed.length, 12);
  assert.equal(executed[0], "DELETE FROM imported_orders");
  assert.equal(executed[1], "DELETE FROM imported_monthly_sales");
  assert.equal(executed[2], "DELETE FROM imported_product_sales");
  assert.equal(executed[3], "DELETE FROM imported_customer_branches");
  assert.equal(executed[4], "DELETE FROM imported_customers");
  assert.equal(executed[5], "DELETE FROM customers WHERE source = 'entersoft_import'");
  assert.match(executed[6], /^INSERT INTO imported_customer_branches\(/);
  assert.match(executed[7], /^INSERT INTO imported_customers\(/);
  assert.match(executed[8], /^INSERT INTO customers\(code, name, email, source\)/);
  assert.match(executed[9], /^INSERT INTO imported_orders\(/);
  assert.match(executed[10], /^INSERT INTO imported_monthly_sales/);
  assert.match(executed[11], /^INSERT INTO imported_product_sales\(/);
});

test("ensureImportedCustomerBranchProjection backfills missing branch projection rows", async () => {
  const executed = [];
  const db = {
    async get(sql) {
      if (sql === IMPORTED_CUSTOMER_BRANCHES_COUNT_SQL) {
        return executed.includes("DELETE FROM imported_customer_branches")
          ? { imported_customer_branches_count: 12 }
          : { imported_customer_branches_count: 0 };
      }
      if (sql === IMPORTED_SALES_LINES_COUNT_SQL) {
        return { imported_sales_lines_count: 25 };
      }
      throw new Error(`Unexpected get SQL: ${sql}`);
    },
    async run(sql) {
      executed.push(sql.trim());
      return { changes: 0 };
    },
  };

  const result = await ensureImportedCustomerBranchProjection(db);

  assert.deepEqual(result, {
    repaired: true,
    branch_count: 12,
    sales_line_count: 25,
  });
  assert.deepEqual(executed, [
    "DELETE FROM imported_customer_branches",
    REBUILD_IMPORTED_CUSTOMER_BRANCHES_SQL.trim(),
  ]);
});

test("ensureImportedCustomerBranchProjection skips rebuild when branch projection already exists", async () => {
  let runCalled = false;
  const db = {
    async get(sql) {
      if (sql === IMPORTED_CUSTOMER_BRANCHES_COUNT_SQL) {
        return { imported_customer_branches_count: 3 };
      }
      if (sql === IMPORTED_SALES_LINES_COUNT_SQL) {
        return { imported_sales_lines_count: 25 };
      }
      throw new Error(`Unexpected get SQL: ${sql}`);
    },
    async run() {
      runCalled = true;
      return { changes: 0 };
    },
  };

  const result = await ensureImportedCustomerBranchProjection(db);

  assert.deepEqual(result, {
    repaired: false,
    branch_count: 3,
    sales_line_count: 25,
  });
  assert.equal(runCalled, false);
});

test("getImportedSalesProjectionHealth summarizes invariant and ledger status", async () => {
  const db = {
    async get(sql) {
      if (sql === DUPLICATE_SUMMARY_SQL) return { duplicate_groups: 0, duplicate_rows: 0 };
      if (sql === MISSING_MIRRORED_CUSTOMERS_SQL) return { missing_mirrors: 0 };
      if (sql === ORPHAN_MIRRORED_CUSTOMERS_SQL) return { orphan_mirrors: 0 };
      if (sql === IMPORTED_ORDER_CARDINALITY_SQL) {
        return { imported_orders_count: 2, grouped_orders_count: 2 };
      }
      if (sql === IMPORTED_PRODUCT_CARDINALITY_SQL) {
        return { imported_product_sales_count: 3, grouped_products_count: 3 };
      }
      if (sql === IMPORTED_MONTHLY_CARDINALITY_SQL) {
        return { imported_monthly_sales_count: 4, grouped_months_count: 4 };
      }
      if (sql === LATEST_IMPORT_RUN_SQL) {
        return {
          id: 9,
          dataset: "sales_lines",
          file_name: "today.csv",
          import_mode: "incremental",
          status: "success",
          started_at: "2026-03-09T00:00:00+00:00",
          finished_at: "2026-03-09T00:00:05+00:00",
          source_row_count: 10,
          rows_in: 10,
          rows_upserted: 7,
          rows_skipped_duplicate: 2,
          rows_rejected: 1,
          rebuild_started_at: "2026-03-09T00:00:04+00:00",
          rebuild_finished_at: "2026-03-09T00:00:05+00:00",
          schema_version: "import-ledger-v2",
          trigger_source: "scheduled_task_nightly",
          source_checksum: "abc123",
        };
      }
      throw new Error(`Unexpected get SQL: ${sql}`);
    },
    async all(sql) {
      if (sql === IMPORTED_ORDER_COLLISIONS_SQL) return [];
      throw new Error(`Unexpected all SQL: ${sql}`);
    },
  };

  const health = await getImportedSalesProjectionHealth(db);

  assert.equal(health.ok, true);
  assert.equal(health.latest_import_run.rows_skipped_duplicate, 2);
  assert.equal(health.latest_import_run.rows_rejected, 1);
  assert.equal(health.invariants.imported_orders_match_grouped_sales, true);
  assert.equal(health.architecture.projectionStrategy, "truncate_and_recompute");
});
