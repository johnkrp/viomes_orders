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
  const products = new Map([
    ["P001", { id: 101, code: "P001", description: "First Product" }],
    ["P002", { id: 102, code: "P002", description: "Second Product" }],
  ]);
  const orders = new Map();
  const orderLines = [];
  let nextOrderId = 1;
  let nextOrderLineId = 1;

  return {
    sessions,
    orders,
    async get(sql, params = []) {
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
      if (sql.includes("SELECT id, status FROM orders WHERE id = ?")) {
        const order = orders.get(Number(params[0]));
        return order ? { id: order.id, status: order.status } : undefined;
      }
      throw new Error(`Unexpected db.get SQL: ${sql}`);
    },
    async all(sql, params = []) {
      if (sql.includes("SELECT id, code FROM products WHERE code IN")) {
        return params
          .map((code) => products.get(code))
          .filter(Boolean)
          .map((product) => ({ id: product.id, code: product.code }));
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
      if (sql.includes("INSERT INTO orders(")) {
        const [
          customerName,
          customerEmail,
          customerSubstore,
          notes,
          totalQtyPieces,
          submittedAt,
          createdAt,
        ] = params;
        const id = nextOrderId++;
        orders.set(id, {
          id,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_substore: customerSubstore,
          notes,
          total_qty_pieces: totalQtyPieces,
          total_net_value: 0,
          status: "pending",
          submitted_at: submittedAt,
          created_at: createdAt,
          warehouse_code: null,
          approved_by: null,
          approved_at: null,
        });
        return { changes: 1, lastID: id };
      }
      if (sql.includes("INSERT INTO order_lines(")) {
        const [orderId, productId, qtyPieces] = params;
        orderLines.push({
          id: nextOrderLineId++,
          order_id: orderId,
          product_id: productId,
          qty_pieces: qtyPieces,
        });
        return { changes: 1, lastID: nextOrderLineId - 1 };
      }
      if (sql.includes("UPDATE orders") && sql.includes("SET status = ?")) {
        const [status, approvedBy, approvedAt, warehouseCode, orderId] =
          params;
        const order = orders.get(Number(orderId));
        if (order) {
          order.status = status;
          order.approved_by = approvedBy;
          order.approved_at = approvedAt;
          order.warehouse_code = warehouseCode;
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
        customerName: "",
        items: [{ code: "P001", qty: 3 }],
      }),
    });
    assert.equal(response.status, 400);
    let payload = await response.json();
    assert.match(payload.error, /customer name/i);

    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Alpha Store",
        items: [{ code: "UNKNOWN", qty: 1 }],
      }),
    });
    assert.equal(response.status, 400);
    payload = await response.json();
    assert.match(payload.error, /Unknown product code/i);

    response = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Alpha Store",
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
    assert.equal(order.status, "pending");
    assert.equal(order.total_qty_pieces, 5);
  } finally {
    await app.close();
  }
});

test("admin order-submission routes require auth and support list/approve/reject", async () => {
  const app = await startTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/admin/order-submissions`);
    assert.equal(response.status, 401);

    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Alpha Store",
        items: [{ code: "P001", qty: 4 }],
      }),
    });
    const { order_id: orderId } = await submitResponse.json();

    const cookie = await app.loginCookie();

    response = await fetch(`${app.baseUrl}/api/admin/order-submissions`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const listPayload = await response.json();
    assert.equal(listPayload.items.length, 1);
    assert.equal(listPayload.items[0].id, orderId);
    assert.deepEqual(listPayload.items[0].lines, [
      { code: "P001", description: "First Product", qty: 4 },
    ]);

    response = await fetch(
      `${app.baseUrl}/api/admin/order-submissions/${orderId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ warehouse_code: "WH1" }),
      },
    );
    assert.equal(response.status, 200);

    const approvedOrder = app.db.orders.get(orderId);
    assert.equal(approvedOrder.status, "approved");
    assert.equal(approvedOrder.warehouse_code, "WH1");
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
    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Beta Store",
        items: [{ code: "P002", qty: 1 }],
      }),
    });
    const { order_id: orderId } = await submitResponse.json();
    const cookie = await app.loginCookie();

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

test("order-submission routes are forbidden for a non-owner admin (salesman) login", async () => {
  const app = await startTestApp();

  try {
    const submitResponse = await fetch(`${app.baseUrl}/api/orders/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Gamma Store",
        items: [{ code: "P001", qty: 1 }],
      }),
    });
    const { order_id: orderId } = await submitResponse.json();

    const salespersonCookie = await app.loginCookie(
      "salesperson1",
      "secret2",
    );

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
