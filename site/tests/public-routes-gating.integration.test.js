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
  ]);

  return {
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
      if (sql.includes("SELECT COUNT(*) AS n FROM products")) {
        return { n: 0 };
      }
      throw new Error(`Unexpected db.get SQL: ${sql}`);
    },
    async all(sql) {
      if (sql.includes("FROM products")) {
        return [];
      }
      throw new Error(`Unexpected db.all SQL: ${sql}`);
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
      throw new Error(`Unexpected db.run SQL: ${sql} :: ${JSON.stringify(params)}`);
    },
  };
}

async function startTestApp() {
  const db = createDbFixture();
  const backendDir = await mkdtemp(
    path.join(os.tmpdir(), "viomes-public-gating-"),
  );
  const settings = buildRuntimeSettings({
    env: {
      NODE_ENV: "test",
      SESSION_COOKIE_NAME: "viomes_admin_session",
      CUSTOMER_SESSION_COOKIE_NAME: "viomes_customer_session",
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
    async adminCookie() {
      const response = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret" }),
      });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie");
    },
    async customerCookie() {
      const response = await fetch(`${baseUrl}/api/customer/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "cust1", password: "custsecret" }),
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

const EXPORT_XLSX_PAYLOAD = {
  customerName: "Alpha Store",
  customerEmail: "buyer@example.com",
  comment: "Test",
  items: [
    {
      code: "P001",
      description: "First Product",
      color: "Blue",
      packs: 2,
      qty: 12,
      volume_liters: 5,
    },
  ],
};

for (const routeCase of [
  { label: "GET /catalog.json", method: "GET", url: "/catalog.json" },
  { label: "GET /api/catalog", method: "GET", url: "/api/catalog" },
  {
    label: "POST /api/order/export-xlsx",
    method: "POST",
    url: "/api/order/export-xlsx",
    body: EXPORT_XLSX_PAYLOAD,
  },
]) {
  test(`${routeCase.label} is gated: 401 unauthenticated, 200 for staff and customer sessions`, async () => {
    const app = await startTestApp();

    try {
      const fetchOptions = (cookie) => ({
        method: routeCase.method,
        headers: {
          ...(routeCase.body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(routeCase.body ? { body: JSON.stringify(routeCase.body) } : {}),
      });

      let response = await fetch(`${app.baseUrl}${routeCase.url}`, fetchOptions());
      assert.equal(response.status, 401);
      await response.arrayBuffer();

      const adminCookie = await app.adminCookie();
      response = await fetch(
        `${app.baseUrl}${routeCase.url}`,
        fetchOptions(adminCookie),
      );
      assert.equal(response.status, 200);
      await response.arrayBuffer();

      const customerCookie = await app.customerCookie();
      response = await fetch(
        `${app.baseUrl}${routeCase.url}`,
        fetchOptions(customerCookie),
      );
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    } finally {
      await app.close();
    }
  });
}
