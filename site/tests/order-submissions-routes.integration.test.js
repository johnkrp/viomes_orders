import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { buildRuntimeSettings, createApp } from "../app.js";
import { hashPassword } from "../lib/admin-auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const siteDir = path.resolve(__dirname, "..");

function createDbFixture() {
  const sessions = new Map();
  const customerSessions = new Map();
  const adminUsers = new Map([
    [
      "admin",
      {
        id: 1,
        username: "admin",
        password_hash: hashPassword("secret"),
        is_active: 1,
        is_owner: 1,
      },
    ],
    [
      "salesperson1",
      {
        id: 2,
        username: "salesperson1",
        password_hash: hashPassword("secret2"),
        is_active: 1,
        is_owner: 0,
      },
    ],
  ]);
  const customerUsers = new Map([
    [
      "cust1",
      {
        id: 1,
        username: "cust1",
        password_hash: hashPassword("custsecret"),
        customer_code: "C001",
        is_active: 1,
      },
    ],
  ]);
  const importedCustomers = new Map([
    ["C001", { customer_code: "C001", customer_name: "Alpha Store", is_inactive: 0 }],
    ["C002", { customer_code: "C002", customer_name: "Beta Store", is_inactive: 0 }],
    ["C003", { customer_code: "C003", customer_name: "Gamma Store", is_inactive: 0 }],
    ["C999", { customer_code: "C999", customer_name: "Inactive Store", is_inactive: 1 }],
  ]);
  const products = new Map([
    ["P001", { id: 101, code: "P001", description: "First Product" }],
    ["P002", { id: 102, code: "P002", description: "Second Product" }],
    ["P003", { id: 103, code: "P003", description: "Third Product" }],
    // Sold only in packs of 42 - the others have no recorded pack size.
    [
      "P042",
      {
        id: 142,
        code: "P042",
        description: "Packaged Product",
        pieces_per_package: 42,
      },
    ],
  ]);
  const orders = new Map();
  const orderLines = [];
  // Fake "last invoiced" history for the value-estimate lookup. Each entry:
  // { itemCode, customerCode (null = matches the "any customer" fallback query), unitPrice, discountPct }
  const importedSalesLines = [];
  let nextOrderId = 1;
  let nextOrderLineId = 1;

  return {
    sessions,
    customerSessions,
    orders,
    importedSalesLines,
    async get(sql, params = []) {
      // The ordering customer's own average discount, used when a price has to be
      // borrowed from another customer's invoice. Must be matched BEFORE the
      // last-invoiced-line branch below, which also reads imported_sales_lines.
      if (
        sql.includes("FROM imported_sales_lines") &&
        sql.includes("avg_discount_pct")
      ) {
        const [customerCode] = params;
        const own = importedSalesLines.filter(
          (row) => row.customerCode === customerCode,
        );
        if (!own.length) return { avg_discount_pct: null };
        return {
          avg_discount_pct:
            own.reduce((sum, row) => sum + Number(row.discountPct || 0), 0) /
            own.length,
        };
      }
      if (sql.includes("FROM imported_sales_lines")) {
        const hasCustomerFilter = sql.includes("AND customer_code = ?");
        const [itemCode, , , , customerCode] = params; // itemCode, 3 doc types, [customerCode]
        const match = importedSalesLines.find((row) =>
          hasCustomerFilter
            ? row.itemCode === itemCode && row.customerCode === customerCode
            : row.itemCode === itemCode && row.customerCode === null,
        );
        return match
          ? { unit_price: match.unitPrice, discount_pct: match.discountPct }
          : undefined;
      }
      if (
        sql.includes("FROM admin_users") &&
        sql.includes("WHERE username = ?")
      ) {
        return adminUsers.get(params[0]);
      }
      if (
        sql.includes("FROM admin_sessions s") &&
        sql.includes("SELECT u.id, u.username")
      ) {
        const [token] = params;
        const session = sessions.get(token);
        if (!session || session.expires_at <= new Date().toISOString())
          return undefined;
        const user = [...adminUsers.values()].find(
          (candidate) => candidate.id === session.admin_user_id,
        );
        return user && user.is_active
          ? { id: user.id, username: user.username, is_owner: user.is_owner }
          : undefined;
      }
      if (
        sql.includes("FROM customer_users") &&
        sql.includes("WHERE username = ?")
      ) {
        return customerUsers.get(params[0]);
      }
      if (
        sql.includes("FROM customer_sessions s") &&
        sql.includes("JOIN customer_users u")
      ) {
        const [token] = params;
        const session = customerSessions.get(token);
        if (!session || session.expires_at <= new Date().toISOString())
          return undefined;
        const user = [...customerUsers.values()].find(
          (candidate) => candidate.id === session.customer_user_id,
        );
        return user && user.is_active
          ? { id: user.id, username: user.username, customer_code: user.customer_code }
          : undefined;
      }
      if (
        sql.includes("FROM imported_customers") &&
        sql.includes("WHERE customer_code = ?")
      ) {
        const record = importedCustomers.get(params[0]);
        return record
          ? {
              code: record.customer_code,
              name: record.customer_name,
              is_inactive: record.is_inactive,
            }
          : undefined;
      }
      if (sql.includes("SELECT id, status FROM orders WHERE id = ?")) {
        const order = orders.get(Number(params[0]));
        return order ? { id: order.id, status: order.status } : undefined;
      }
      throw new Error(`Unexpected db.get SQL: ${sql}`);
    },
    async all(sql, params = []) {
      if (sql.includes("FROM products WHERE code IN")) {
        return params
          .map((code) => products.get(code))
          .filter(Boolean)
          .map((product) => ({
            id: product.id,
            code: product.code,
            pieces_per_package: product.pieces_per_package ?? 0,
          }));
      }
      if (
        sql.includes("FROM orders") &&
        sql.includes("WHERE status = 'pending'")
      ) {
        return [...orders.values()]
          .filter((order) => order.status === "pending")
          .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
      }
      if (
        sql.includes("FROM order_lines ol") &&
        sql.includes("JOIN products p")
      ) {
        const orderIds = new Set(params.map(Number));
        return orderLines
          .filter((line) => orderIds.has(line.order_id))
          .map((line) => {
            const product = [...products.values()].find(
              (candidate) => candidate.id === line.product_id,
            );
            return {
              order_id: line.order_id,
              qty_pieces: line.qty_pieces,
              unit_price: line.unit_price,
              discount_pct: line.discount_pct,
              line_net_value: line.line_net_value,
              price_source: line.price_source,
              code: product?.code,
              description: product?.description,
            };
          });
      }
      throw new Error(
        `Unexpected db.all SQL: ${sql} :: ${JSON.stringify(params)}`,
      );
    },
    async run(sql, params = []) {
      if (sql.includes("INSERT INTO admin_sessions")) {
        const [adminUserId, token, expiresAt] = params;
        sessions.set(token, {
          admin_user_id: adminUserId,
          token,
          expires_at: expiresAt,
        });
        return { changes: 1, lastID: sessions.size };
      }
      if (sql.includes("INSERT INTO customer_sessions")) {
        const [customerUserId, token, expiresAt] = params;
        customerSessions.set(token, {
          customer_user_id: customerUserId,
          token,
          expires_at: expiresAt,
        });
        return { changes: 1, lastID: customerSessions.size };
      }
      if (sql.includes("INSERT INTO orders(")) {
        const [
          customerName,
          customerEmail,
          customerCode,
          customerSubstore,
          notes,
          totalQtyPieces,
          totalNetValue,
          submittedBy,
          submittedByRole,
          submittedAt,
          createdAt,
        ] = params;
        const id = nextOrderId++;
        orders.set(id, {
          id,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_code: customerCode,
          customer_substore: customerSubstore,
          notes,
          total_qty_pieces: totalQtyPieces,
          total_net_value: totalNetValue,
          status: "pending",
          submitted_by: submittedBy,
          submitted_by_role: submittedByRole,
          submitted_at: submittedAt,
          created_at: createdAt,
          approved_by: null,
          approved_at: null,
        });
        return { changes: 1, lastID: id };
      }
      if (sql.includes("INSERT INTO order_lines(")) {
        const [
          orderId,
          productId,
          qtyPieces,
          unitPrice,
          discountPct,
          lineNetValue,
          priceSource,
        ] = params;
        orderLines.push({
          id: nextOrderLineId++,
          order_id: orderId,
          product_id: productId,
          qty_pieces: qtyPieces,
          unit_price: unitPrice,
          discount_pct: discountPct,
          line_net_value: lineNetValue,
          price_source: priceSource,
        });
        return { changes: 1, lastID: nextOrderLineId - 1 };
      }
      if (sql.includes("UPDATE orders") && sql.includes("SET status = ?")) {
        const [status, approvedBy, approvedAt, orderId] = params;
        const order = orders.get(Number(orderId));
        if (order) {
          order.status = status;
          order.approved_by = approvedBy;
          order.approved_at = approvedAt;
        }
        return { changes: order ? 1 : 0, lastID: 0 };
      }
      throw new Error(`Unexpected db.run SQL: ${sql} :: ${JSON.stringify(params)}`);
    },
  };
}

async function startTestApp() {
  const db = createDbFixture();
  const backendDir = await mkdtemp(
    path.join(os.tmpdir(), "viomes-order-submissions-"),
  );
  const settings = buildRuntimeSettings({
    env: {
      NODE_ENV: "test",
      SESSION_COOKIE_NAME: "viomes_admin_session",
      SESSION_MAX_AGE_SECONDS: "60",
      COOKIE_SECURE_MODE: "off",
      CORS_ALLOWED_ORIGINS: "http://localhost:3000",
      MYSQL_HOST: "127.0.0.1",
      MYSQL_PORT: "3306",
      MYSQL_DATABASE: "test_db",
      MYSQL_USER: "tester",
      MYSQL_PASSWORD: "secret",
    },
    publicDir: path.join(siteDir, "public"),
    imagesDir: path.join(siteDir, "images"),
    backendDir,
  });

  const app = createApp({
    settings,
    db,
    dbClient: { kind: "mysql", description: "test" },
    customerStatsProvider: { name: "test-provider", mode: "test" },
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    db,
    async loginCookie(username = "admin", password = "secret") {
      const response = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie");
    },
    async customerLoginCookie(username = "cust1", password = "custsecret") {
      const response = await fetch(`${baseUrl}/api/customer/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie");
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("order submission endpoint validates and persists a pending order", async () => {
  const app = await startTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ code: "P001", qty: 3 }],
      }),
    });
    assert.equal(response.status, 401);

    const cookie = await app.loginCookie();

    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        items: [{ code: "P001", qty: 3 }],
      }),
    });
    assert.equal(response.status, 400);
    let payload = await response.json();
    assert.match(payload.error, /select a customer/i);

    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C999",
        items: [{ code: "P001", qty: 3 }],
      }),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.match(payload.error, /unknown or inactive customer code/i);

    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "UNKNOWN", qty: 1 }],
      }),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.match(payload.error, /Unknown product code/i);

    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        customerSubstore: "Branch 1",
        customerEmail: "buyer@example.com",
        notes: "Please ship fast",
        items: [
          { code: "P001", qty: 3 },
          { code: "P002", qty: 2 },
        ],
      }),
    });
    assert.equal(response.status, 200);
    payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.order_id, "number");

    const order = app.db.orders.get(payload.order_id);
    assert.equal(order.customer_name, "Alpha Store");
    assert.equal(order.customer_code, "C001");
    assert.equal(order.status, "pending");
    assert.equal(order.total_qty_pieces, 5);
    assert.equal(order.submitted_by, "admin");
    assert.equal(order.submitted_by_role, "staff");
  } finally {
    await app.close();
  }
});

test("order submission endpoint stamps the session's real customer_code even if the request body spoofs another one", async () => {
  const app = await startTestApp();

  try {
    const customerCookie = await app.customerLoginCookie();

    const response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: customerCookie },
      body: JSON.stringify({
        customerCode: "C002",
        customerName: "Spoofed Name",
        items: [{ code: "P001", qty: 1 }],
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();

    const order = app.db.orders.get(payload.order_id);
    assert.equal(order.customer_code, "C001");
    assert.equal(order.customer_name, "Alpha Store");
    // A self-service order must be attributable to the customer account, not to staff.
    assert.equal(order.submitted_by, "cust1");
    assert.equal(order.submitted_by_role, "customer");
  } finally {
    await app.close();
  }
});

test("admin order-submission routes require auth and support list/approve/reject", async () => {
  const app = await startTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/admin/order-submissions`);
    assert.equal(response.status, 401);

    const cookie = await app.loginCookie();

    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "P001", qty: 4 }],
      }),
    });
    const { order_id: orderId } = await submitResponse.json();

    response = await fetch(`${app.baseUrl}/api/admin/order-submissions`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const listPayload = await response.json();
    assert.equal(listPayload.items.length, 1);
    assert.equal(listPayload.items[0].id, orderId);
    assert.deepEqual(listPayload.items[0].lines, [
      {
        code: "P001",
        description: "First Product",
        qty: 4,
        unit_price: 0,
        discount_pct: 0,
        line_net_value: 0,
        price_source: "no_history",
      },
    ]);
    // No imported_sales_lines history seeded for P001/C001 in this test -> unpriced.
    assert.equal(listPayload.items[0].total_net_value, 0);
    assert.equal(listPayload.items[0].value_is_partial, true);

    response = await fetch(
      `${app.baseUrl}/api/admin/order-submissions/${orderId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
      },
    );
    assert.equal(response.status, 200);

    const approvedOrder = app.db.orders.get(orderId);
    assert.equal(approvedOrder.status, "approved");
    assert.equal(approvedOrder.approved_by, "admin");

    response = await fetch(
      `${app.baseUrl}/api/admin/order-submissions/${orderId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({}),
      },
    );
    assert.equal(response.status, 409);

    response = await fetch(`${app.baseUrl}/api/admin/order-submissions`, {
      headers: { Cookie: cookie },
    });
    const emptyListPayload = await response.json();
    assert.equal(emptyListPayload.items.length, 0);
  } finally {
    await app.close();
  }
});

test("admin order-submission reject sets status to rejected", async () => {
  const app = await startTestApp();

  try {
    const cookie = await app.loginCookie();

    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C002",
        items: [{ code: "P002", qty: 1 }],
      }),
    });
    const { order_id: orderId } = await submitResponse.json();

    const response = await fetch(
      `${app.baseUrl}/api/admin/order-submissions/${orderId}/reject`,
      {
        method: "POST",
        headers: { Cookie: cookie },
      },
    );
    assert.equal(response.status, 200);

    const rejectedOrder = app.db.orders.get(orderId);
    assert.equal(rejectedOrder.status, "rejected");
    assert.equal(rejectedOrder.approved_by, "admin");
  } finally {
    await app.close();
  }
});

test("order value estimate uses last-invoiced customer price, falls back to any-customer price, and leaves truly unpriced lines at zero", async () => {
  const app = await startTestApp();

  try {
    // P001: this customer has bought it before -> use their own last invoiced price/discount.
    app.db.importedSalesLines.push({
      itemCode: "P001",
      customerCode: "C001",
      unitPrice: 10,
      discountPct: 20,
    });
    // P003: C001 has never bought it, but someone else has -> fall back to that price.
    app.db.importedSalesLines.push({
      itemCode: "P003",
      customerCode: null,
      unitPrice: 5,
      discountPct: 0,
    });
    // P002: no invoice history anywhere -> stays unpriced (0), order flagged partial.

    const cookie = await app.loginCookie();

    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [
          { code: "P001", qty: 3 },
          { code: "P002", qty: 1 },
          { code: "P003", qty: 2 },
        ],
      }),
    });
    assert.equal(submitResponse.status, 200);

    const response = await fetch(`${app.baseUrl}/api/admin/order-submissions`, {
      headers: { Cookie: cookie },
    });
    const { items } = await response.json();
    assert.equal(items.length, 1);

    const order = items[0];
    // 3 * 10 * (1 - 0.20) = 24 (customer's own last price/discount)
    // 1 *  0 * ...        =  0 (no history anywhere)
    // 2 *  5 * (1 - 0.20) =  8 (borrowed price, but THIS customer's 20% discount,
    //                           NOT the donor's 0% - see the THE MART/DEDEMAN case)
    assert.equal(order.total_net_value, 32);
    assert.equal(order.value_is_partial, true);

    const byCode = Object.fromEntries(order.lines.map((line) => [line.code, line]));
    assert.equal(byCode.P001.unit_price, 10);
    assert.equal(byCode.P001.discount_pct, 20);
    assert.equal(byCode.P001.line_net_value, 24);
    assert.equal(byCode.P001.price_source, "last_invoice_customer");
    assert.equal(byCode.P002.line_net_value, 0);
    assert.equal(byCode.P002.price_source, "no_history");
    assert.equal(byCode.P003.unit_price, 5);
    assert.equal(byCode.P003.discount_pct, 20);
    assert.equal(byCode.P003.line_net_value, 8);
    assert.equal(byCode.P003.price_source, "last_invoice_any_customer");
  } finally {
    await app.close();
  }
});

test("the API enforces package multiples, not just the browser form", async () => {
  const app = await startTestApp();

  try {
    const cookie = await app.loginCookie();

    // The salesman form blocks this client-side; posting straight to the API used to
    // sail through, which matters once customers submit their own orders.
    let response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "P042", qty: 7 }],
      }),
    });
    assert.equal(response.status, 400);
    let payload = await response.json();
    assert.match(payload.error, /συσκευασία/i);
    assert.match(payload.error, /42/);

    // A whole number of packages is fine.
    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "P042", qty: 84 }],
      }),
    });
    assert.equal(response.status, 200);

    // Products with no recorded pack size must not be blocked.
    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "P001", qty: 7 }],
      }),
    });
    assert.equal(response.status, 200);
  } finally {
    await app.close();
  }
});

test("an implausible quantity is rejected, but real-world large quantities are not", async () => {
  const app = await startTestApp();

  try {
    const cookie = await app.loginCookie();

    let response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "P001", qty: 1000000000 }],
      }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /implausible quantity/i);

    // The largest single ΠΑΡ line on record is 384,000 pieces - that must still pass.
    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "P001", qty: 384000 }],
      }),
    });
    assert.equal(response.status, 200);
  } finally {
    await app.close();
  }
});

// Regression for the real THE MART / DEDEMAN case: THE MART (35% discount) ordered
// family 1050, which it had never bought, so every line borrowed DEDEMAN's price -
// and, before this fix, DEDEMAN's 0% discount with it. That showed €122.40 where
// ~€79.56 was realistic, with no visual warning at all.
test("a borrowed price does not import the donor customer's discount, and the order is flagged", async () => {
  const app = await startTestApp();

  try {
    // C001 buys P001 at a 35% discount - that is C001's commercial reality.
    app.db.importedSalesLines.push({
      itemCode: "P001",
      customerCode: "C001",
      unitPrice: 10,
      discountPct: 35,
    });
    // P003 was last invoiced to somebody else at full price (0% discount).
    app.db.importedSalesLines.push({
      itemCode: "P003",
      customerCode: null,
      unitPrice: 2,
      discountPct: 0,
    });

    const cookie = await app.loginCookie();
    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        customerCode: "C001",
        items: [{ code: "P003", qty: 36 }],
      }),
    });
    assert.equal(submitResponse.status, 200);

    const response = await fetch(`${app.baseUrl}/api/admin/order-submissions`, {
      headers: { Cookie: cookie },
    });
    const { items } = await response.json();
    const order = items[0];
    const line = order.lines[0];

    // Donor's 0% would give 36 * 2 = 72.00. C001's own 35% gives 46.80.
    assert.equal(line.unit_price, 2);
    assert.equal(line.discount_pct, 35);
    assert.equal(line.line_net_value, 46.8);
    assert.equal(order.total_net_value, 46.8);

    // Every line is priced, so the old "partial" flag stays false - which is exactly
    // why a separate fallback flag is needed for the approver to see the weak signal.
    assert.equal(order.value_is_partial, false);
    assert.equal(order.value_has_fallback, true);
    assert.equal(line.price_source, "last_invoice_any_customer");
  } finally {
    await app.close();
  }
});

test("order-submission routes are forbidden for a non-owner admin (salesman) login", async () => {
  const app = await startTestApp();

  try {
    const salespersonCookie = await app.loginCookie(
      "salesperson1",
      "secret2",
    );

    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: salespersonCookie },
      body: JSON.stringify({
        customerCode: "C003",
        items: [{ code: "P001", qty: 1 }],
      }),
    });
    const { order_id: orderId } = await submitResponse.json();

    let response = await fetch(`${app.baseUrl}/api/admin/order-submissions`, {
      headers: { Cookie: salespersonCookie },
    });
    assert.equal(response.status, 403);

    response = await fetch(
      `${app.baseUrl}/api/admin/order-submissions/${orderId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: salespersonCookie },
        body: JSON.stringify({}),
      },
    );
    assert.equal(response.status, 403);

    response = await fetch(
      `${app.baseUrl}/api/admin/order-submissions/${orderId}/reject`,
      {
        method: "POST",
        headers: { Cookie: salespersonCookie },
      },
    );
    assert.equal(response.status, 403);

    const untouchedOrder = app.db.orders.get(orderId);
    assert.equal(untouchedOrder.status, "pending");

    const ownerCookie = await app.loginCookie();
    response = await fetch(`${app.baseUrl}/api/admin/order-submissions`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(response.status, 200);
    const listPayload = await response.json();
    assert.equal(listPayload.items.length, 1);
  } finally {
    await app.close();
  }
});
