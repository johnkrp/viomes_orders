import assert from "node:assert/strict";
import test from "node:test";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { createSqliteCustomerStatsProvider } from "../lib/customer-stats/sqlite-provider.js";
import { initDatabaseSchema } from "../lib/db/init-schema.js";
import { FACTUAL_LIFECYCLE_RULES } from "../lib/factual-lifecycle.js";

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
          total_pieces, total_net_value, average_discount_pct, ordered_at, sent_at, document_type, delivery_code,
          delivery_description, source_file
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        `${currentYear}-02-14`,
        `${currentYear}-02-16`,
        "\u03A4\u0399\u03A0",
        "D1",
        "Main Store",
        "2026.CSV",
      ],
    );
    await db.run(
      `
        INSERT INTO imported_orders(
          order_id, document_no, customer_code, customer_name, created_at, total_lines,
          total_pieces, total_net_value, average_discount_pct, ordered_at, sent_at, document_type, delivery_code,
          delivery_description, source_file
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        `${previousYear}-12-09`,
        `${previousYear}-12-11`,
        "\u03A4\u0399\u03A0",
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
        INSERT INTO imported_customer_branches(customer_code, customer_name, branch_code, branch_description, orders, revenue, last_order_date, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "C001",
        "Alpha Store",
        "B1",
        "Branch 1",
        1,
        175.6,
        `${currentYear}-02-15`,
        "2026.CSV",
        "C001",
        "Alpha Store",
        "B2",
        "Branch 2",
        1,
        70,
        `${previousYear}-12-10`,
        "2025.CSV",
      ],
    );

    await db.run(
      `
        INSERT INTO imported_customer_ledgers(
          customer_code, customer_name, opening_balance, debit, credit, ledger_balance,
          pending_instruments, commercial_balance, email, is_inactive, salesperson_code, source_file
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "C001",
        "Alpha Store",
        0,
        0,
        120.5,
        321.45,
        0,
        999.99,
        "alpha@example.com",
        0,
        "90",
        "karteles.csv",
      ],
    );

    await db.run(
      `
        INSERT INTO imported_customer_ledger_lines(
          customer_code, customer_name, document_date, document_no, reason,
          debit, credit, running_debit, running_credit, ledger_balance, source_file
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
               (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "C001",
        "Alpha Store",
        `${currentYear}-02-15`,
        "INV-2",
        "Ledger movement",
        175.6,
        0,
        50,
        10,
        321.45,
        "new-kart.csv",
        "C001",
        "Alpha Store",
        `${previousYear}-12-10`,
        "INV-1",
        "Older movement",
        70,
        0,
        25,
        5,
        145.85,
        "new-kart.csv",
      ],
    );

    await db.run(
      `
        INSERT INTO imported_sales_lines(
          source_file, order_date, order_year, order_month, document_no, document_type,
          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
          discount_pct_1, discount_pct_2, discount_pct_total,
          customer_code, customer_name, delivery_code, delivery_description, account_code,
          account_description, branch_code, branch_description, note_1
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
               (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
               (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "2026.CSV",
        `${currentYear}-02-15`,
        currentYear,
        2,
        "INV-2",
        "\u03A4\u0399\u03A0",
        "P1",
        "First",
        "PCS",
        10,
        10,
        17.56,
        175.6,
        5,
        2,
        7,
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
        "\u03A4\u0399\u03A0",
        "P2",
        "Second",
        "PCS",
        5,
        5,
        14,
        70,
        3,
        1,
        4,
        "C001",
        "Alpha Store",
        "D2",
        "Second Store",
        "A1",
        "Account",
        "B2",
        "Branch 2",
        "Note",
        "2026.CSV",
        `${currentYear}-02-16`,
        currentYear,
        2,
        "QUOTE-1",
        "\u03A0\u0391\u03A1",
        "P999",
        "Quote Only",
        "PCS",
        99,
        99,
        999,
        999,
        11,
        0,
        11,
        "C001",
        "Alpha Store",
        "D1",
        "Main Store",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Ignored non-sale",
      ],
    );

    const provider = createSqliteCustomerStatsProvider({
      db,
      sqlDialect: "sqlite",
    });
    const payload = await provider.getCustomerStats("C001");

    assert.equal(payload.customer.code, "C001");
    assert.equal(payload.customer.email, "alpha@example.com");
    assert.equal(payload.customer.aggregation_level, "customer");
    assert.equal(payload.customer.branch_code, null);
    assert.equal(payload.customer.branch_description, null);
    assert.equal(payload.summary.total_orders, 2);
    assert.equal(payload.summary.total_revenue, 245.6);
    assert.equal(payload.summary.average_order_value, 122.8);
    assert.equal(payload.top_products_by_qty[0].code, "P1");
    assert.equal(payload.top_products_by_value[0].code, "P1");
    assert.equal(payload.available_branches.length, 2);
    assert.equal(payload.product_sales.items.length, 1);
    assert.equal(payload.recent_orders.length, 1);
    assert.equal(payload.monthly_sales.current_year[1].revenue, 175.6);
    assert.equal(payload.monthly_sales.previous_year[11].revenue, 70);
    assert.equal(payload.monthly_sales.yearly_series.length, 3);
    assert.equal(payload.monthly_sales.yearly_series[0].year, olderYear);
    assert.equal(payload.monthly_sales.yearly_series[0].months[0].revenue, 0);
    assert.equal(payload.detailed_orders[0].lines[0].code, "P1");
    assert.equal(payload.detailed_orders[0].lines[0].discount_pct, 7);
    assert.equal(payload.recent_orders[0].ordered_at, `${currentYear}-02-14`);
    assert.equal(payload.recent_orders[0].sent_at, `${currentYear}-02-16`);
    assert.equal(payload.receivables.open_balance, 321.45);
    assert.equal(payload.receivables.overdue_balance, 0);
    assert.equal(payload.receivables.progressive_credit, 120.5);
    assert.equal(payload.receivables.items.length, 2);
    assert.equal(payload.receivables.items[0].document_no, "INV-2");
    assert.equal(payload.receivables.items[0].reason, "Ledger movement");
    assert.equal(payload.receivables.items[0].ledger_balance, 321.45);

    const branchPayload = await provider.getCustomerStats("C001", {
      branchCode: "B1",
    });
    assert.equal(branchPayload.customer.aggregation_level, "branch");
    assert.equal(branchPayload.customer.branch_code, "B1");
    assert.equal(branchPayload.summary.total_orders, 1);
    assert.equal(branchPayload.summary.total_revenue, 175.6);
    assert.equal(branchPayload.recent_orders[0].average_discount_pct, 7);

    const allTimePayload = await provider.getCustomerStats("C001", {
      salesTimeRange: "all",
    });
    assert.equal(allTimePayload.product_sales.items.length, 2);
    assert.equal(allTimePayload.recent_orders.length, 2);
    assert.equal(allTimePayload.monthly_sales.previous_year[11].revenue, 70);

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

test("SQLite-backed imported stats excludes progressed pre-approvals and executed open orders in scoped fallback mode", async () => {
  const db = await openTestDb();
  const currentYear = new Date().getUTCFullYear();
  const openType = FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes[0];
  const executedType = FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes[0];
  const preApprovalType = FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes[0];

  try {
    await db.run(
      `
        INSERT INTO imported_customers(customer_code, customer_name, delivery_code, delivery_description, source_file)
        VALUES (?, ?, ?, ?, ?)
      `,
      ["C778", "Reference Customer", "D1", "Main", "2026.CSV"],
    );

    await db.run(
      `
        INSERT INTO imported_sales_lines(
          source_file, order_date, order_year, order_month, document_no, document_type,
          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
          discount_pct_1, discount_pct_2, discount_pct_total,
          customer_code, customer_name, delivery_code, delivery_description, account_code,
          account_description, branch_code, branch_description, note_1
        )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "2026.CSV",
        `${currentYear}-03-01`,
        currentYear,
        3,
        "OPEN-1",
        openType,
        "P1",
        "Open order",
        "PCS",
        10,
        10,
        10,
        100,
        0,
        0,
        0,
        "C777",
        "Branch Scoped Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "ΕΝΕΡΓΕΙΑ ΚΗΠΟΥ 2025 (ΜΕΤΑΛΛΙΚΟ STAND)  | ΚΑΜ1 ΠΡΟΣ ΚΑΣ",
        "2026.CSV",
        `${currentYear}-03-02`,
        currentYear,
        3,
        "EXEC-1",
        executedType,
        "P1",
        "Executed order",
        "PCS",
        10,
        10,
        10,
        100,
        0,
        0,
        0,
        "C777",
        "Branch Scoped Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "ΕΝΕΡΓΕΙΑ ΚΗΠΟΥ 2025 (ΜΕΤΑΛΛΙΚΟ STAND) ΚΑΜ1 ΠΡΟΣ ΚΑΣ",
        "2026.CSV",
        `${currentYear}-03-02`,
        currentYear,
        3,
        "PRE-1",
        preApprovalType,
        "P2",
        "Pre approval",
        "PCS",
        5,
        5,
        10,
        50,
        0,
        0,
        0,
        "C777",
        "Branch Scoped Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "ref:pre-1",
        "2026.CSV",
        `${currentYear}-03-03`,
        currentYear,
        3,
        "PROG-1",
        openType,
        "P2",
        "Progressed order",
        "PCS",
        5,
        5,
        10,
        50,
        0,
        0,
        0,
        "C777",
        "Branch Scoped Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "ref:pre-1",
      ],
    );

    const provider = createSqliteCustomerStatsProvider({
      db,
      sqlDialect: "sqlite",
    });
    const payload = await provider.getCustomerStats("C777", {
      branchCode: "B1",
      salesTimeRange: "all",
    });

    assert.equal(payload.customer.aggregation_level, "branch");
    assert.equal(payload.customer.branch_code, "B1");
    assert.equal(payload.open_orders.length, 1);
    assert.equal(payload.pre_approval_orders.length, 0);
    assert.equal(payload.detailed_open_orders.length, 1);
    assert.equal(payload.detailed_pre_approval_orders.length, 0);
    assert.equal(payload.recent_orders.length, 1);
    assert.equal(
      payload.open_orders[0].order_id,
      `C777::${currentYear}-03-03::PROG-1`,
    );
  } finally {
    await db.close();
  }
});

test("SQLite-backed imported stats keeps referenced pre-approvals when progressed rows have empty references", async () => {
  const db = await openTestDb();
  const currentYear = new Date().getUTCFullYear();
  const openType = FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes[0];
  const preApprovalType = FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes[0];

  try {
    await db.run(
      `
        INSERT INTO imported_customers(customer_code, customer_name, delivery_code, delivery_description, source_file)
        VALUES (?, ?, ?, ?, ?)
      `,
      ["C778", "Reference Customer", "D1", "Main", "2026.CSV"],
    );

    await db.run(
      `
        INSERT INTO imported_sales_lines(
          source_file, order_date, order_year, order_month, document_no, document_type,
          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
          discount_pct_1, discount_pct_2, discount_pct_total,
          customer_code, customer_name, delivery_code, delivery_description, account_code,
          account_description, branch_code, branch_description, note_1
        )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "2026.CSV",
        `${currentYear}-03-23`,
        currentYear,
        3,
        "PRE-REF-1",
        preApprovalType,
        "P1",
        "Pre approval",
        "PCS",
        10,
        10,
        10,
        100,
        0,
        0,
        0,
        "C778",
        "Reference Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:4302748473",
        "2026.CSV",
        `${currentYear}-03-23`,
        currentYear,
        3,
        "OPEN-NO-REF-1",
        openType,
        "P1",
        "Open order",
        "PCS",
        10,
        10,
        10,
        100,
        0,
        0,
        0,
        "C778",
        "Reference Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "",
      ],
    );

    const provider = createSqliteCustomerStatsProvider({
      db,
      sqlDialect: "sqlite",
    });
    const payload = await provider.getCustomerStats("C778", {
      salesTimeRange: "all",
    });

    assert.equal(payload.pre_approval_orders.length, 1);
    assert.equal(
      payload.pre_approval_orders[0].order_id,
      `C778::${currentYear}-03-23::PRE-REF-1`,
    );
  } finally {
    await db.close();
  }
});

test("SQLite-backed imported stats keeps partially progressed referenced pre-approvals", async () => {
  const db = await openTestDb();
  const currentYear = new Date().getUTCFullYear();
  const openType = FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes[0];
  const preApprovalType = FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes[0];

  try {
    await db.run(
      `
        INSERT INTO imported_customers(customer_code, customer_name, delivery_code, delivery_description, source_file)
        VALUES (?, ?, ?, ?, ?)
      `,
      ["C779", "Partial Progress Customer", "D1", "Main", "2026.CSV"],
    );

    await db.run(
      `
        INSERT INTO imported_sales_lines(
          source_file, order_date, order_year, order_month, document_no, document_type,
          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
          discount_pct_1, discount_pct_2, discount_pct_total,
          customer_code, customer_name, delivery_code, delivery_description, account_code,
          account_description, branch_code, branch_description, note_1
        )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "2026.CSV",
        `${currentYear}-03-23`,
        currentYear,
        3,
        "PRE-PARTIAL-1",
        preApprovalType,
        "P1",
        "Pre approval line 1",
        "PCS",
        1,
        1,
        10,
        10,
        0,
        0,
        0,
        "C779",
        "Partial Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-PARTIAL-1",
        "2026.CSV",
        `${currentYear}-03-23`,
        currentYear,
        3,
        "PRE-PARTIAL-1",
        preApprovalType,
        "P2",
        "Pre approval line 2",
        "PCS",
        1,
        1,
        10,
        10,
        0,
        0,
        0,
        "C779",
        "Partial Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-PARTIAL-1",
        "2026.CSV",
        `${currentYear}-03-24`,
        currentYear,
        3,
        "OPEN-PARTIAL-1",
        openType,
        "P1",
        "Open line 1",
        "PCS",
        1,
        1,
        10,
        10,
        0,
        0,
        0,
        "C779",
        "Partial Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-PARTIAL-1",
        "2026.CSV",
        `${currentYear}-03-24`,
        currentYear,
        3,
        "OPEN-PARTIAL-1",
        openType,
        "P2",
        "Open line 2",
        "PCS",
        1,
        0,
        10,
        0,
        0,
        0,
        0,
        "C779",
        "Partial Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-PARTIAL-1",
      ],
    );

    const provider = createSqliteCustomerStatsProvider({
      db,
      sqlDialect: "sqlite",
    });
    const payload = await provider.getCustomerStats("C779", {
      salesTimeRange: "all",
    });

    assert.equal(payload.pre_approval_orders.length, 1);
    assert.equal(
      payload.pre_approval_orders[0].order_id,
      `C779::${currentYear}-03-23::PRE-PARTIAL-1`,
    );
  } finally {
    await db.close();
  }
});

test("SQLite-backed imported stats excludes referenced pre-approvals when progression is split with rejection", async () => {
  const db = await openTestDb();
  const currentYear = new Date().getUTCFullYear();
  const openType = FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes[0];
  const preApprovalType = FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes[0];

  try {
    await db.run(
      `
        INSERT INTO imported_customers(customer_code, customer_name, delivery_code, delivery_description, source_file)
        VALUES (?, ?, ?, ?, ?)
      `,
      ["C780", "Split Progress Customer", "D1", "Main", "2026.CSV"],
    );

    await db.run(
      `
        INSERT INTO imported_sales_lines(
          source_file, order_date, order_year, order_month, document_no, document_type,
          item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
          discount_pct_1, discount_pct_2, discount_pct_total,
          customer_code, customer_name, delivery_code, delivery_description, account_code,
          account_description, branch_code, branch_description, note_1
        )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "2026.CSV",
        `${currentYear}-03-16`,
        currentYear,
        3,
        "PRE-SPLIT-1",
        preApprovalType,
        "P1",
        "Pre approval main",
        "PCS",
        1,
        1,
        99.93,
        99.93,
        0,
        0,
        0,
        "C780",
        "Split Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-SPLIT-1",
        "2026.CSV",
        `${currentYear}-03-16`,
        currentYear,
        3,
        "PRE-SPLIT-1",
        preApprovalType,
        "P2",
        "Pre approval rejected",
        "PCS",
        1,
        1,
        12.77,
        12.77,
        0,
        0,
        0,
        "C780",
        "Split Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-SPLIT-1",
        "2026.CSV",
        `${currentYear}-03-17`,
        currentYear,
        3,
        "OPEN-SPLIT-1",
        openType,
        "P1",
        "Open progressed",
        "PCS",
        1,
        1,
        99.93,
        99.93,
        0,
        0,
        0,
        "C780",
        "Split Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-SPLIT-1",
        "2026.CSV",
        `${currentYear}-03-17`,
        currentYear,
        3,
        "REJ-SPLIT-1",
        "ΠΑΑ",
        "P2",
        "Rejected remainder",
        "PCS",
        1,
        1,
        12.77,
        12.77,
        0,
        0,
        0,
        "C780",
        "Split Progress Customer",
        "D1",
        "Main",
        "A1",
        "Account",
        "B1",
        "Branch 1",
        "Αρ.Παραγγελίας:REF-SPLIT-1",
      ],
    );

    const provider = createSqliteCustomerStatsProvider({
      db,
      sqlDialect: "sqlite",
    });
    const payload = await provider.getCustomerStats("C780", {
      salesTimeRange: "all",
    });

    assert.equal(payload.pre_approval_orders.length, 0);
  } finally {
    await db.close();
  }
});
