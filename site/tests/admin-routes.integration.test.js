import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, buildRuntimeSettings } from "../app.js";
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
      },
    ],
  ]);

  return {
    sessions,
    async get(sql, params = []) {
      if (sql.includes("FROM admin_users") && sql.includes("WHERE username = ?")) {
        return adminUsers.get(params[0]);
      }
      if (sql.includes("FROM admin_sessions s") && sql.includes("SELECT u.id, u.username")) {
        const [token] = params;
        const session = sessions.get(token);
        if (!session || session.expires_at <= new Date().toISOString()) return undefined;
        const user = [...adminUsers.values()].find((candidate) => candidate.id === session.admin_user_id);
        return user && user.is_active ? { id: user.id, username: user.username } : undefined;
      }
      if (sql.includes("FROM admin_sessions s") && sql.includes("SELECT u.username")) {
        const [token] = params;
        const session = sessions.get(token);
        if (!session || session.expires_at <= new Date().toISOString()) return undefined;
        const user = [...adminUsers.values()].find((candidate) => candidate.id === session.admin_user_id);
        return user && user.is_active ? { username: user.username } : undefined;
      }
      if (sql.includes("SELECT COUNT(*) AS n FROM products")) {
        return { n: 0 };
      }
      if (sql.includes("SELECT COUNT(*) AS n") && sql.includes("FROM imported_sales_lines")) {
        return { n: 0 };
      }
      if (sql.includes("ORDER BY id DESC") && sql.includes("FROM import_runs")) {
        return null;
      }
      throw new Error(`Unexpected db.get SQL: ${sql}`);
    },
    async all(sql, params = []) {
      if (sql.includes("FROM imported_customer_branches")) {
        return [
          {
            code: "C001",
            name: "Alpha Store",
            branch_count: 1,
            branch_code: "B1",
            branch_description: "Branch 1",
          },
        ];
      }
      if (sql.includes("FROM products")) {
        return [];
      }
      throw new Error(`Unexpected db.all SQL: ${sql} :: ${JSON.stringify(params)}`);
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
      if (sql.includes("DELETE FROM admin_sessions WHERE token = ?")) {
        sessions.delete(params[0]);
        return { changes: 1, lastID: 0 };
      }
      throw new Error(`Unexpected db.run SQL: ${sql}`);
    },
  };
}

async function startTestApp() {
  const db = createDbFixture();
  const settings = buildRuntimeSettings({
    env: {
      NODE_ENV: "test",
      SESSION_COOKIE_NAME: "viomes_admin_session",
      SESSION_MAX_AGE_SECONDS: "60",
      COOKIE_SECURE_MODE: "off",
      CORS_ALLOWED_ORIGINS: "http://localhost:3000",
    },
    publicDir: path.join(siteDir, "public"),
    imagesDir: path.join(siteDir, "images"),
  });
  const customerStatsProvider = {
    name: "test-provider",
    mode: "test",
    async getCustomerStats(code, options = {}) {
      return {
        customer: {
          code,
          name: "Alpha Store",
          aggregation_level: options.branchCode ? "branch" : "customer",
          branch_code: options.branchCode || null,
          branch_description: options.branchCode ? "Branch 1" : null,
        },
        summary: { total_orders: 1, total_pieces: 10, total_revenue: 175.6 },
        monthly_sales: { current_year: [], previous_year: [], yearly_series: [] },
        product_sales: { metric: "revenue", items: [] },
        receivables: { currency: "EUR", open_balance: 0, overdue_balance: 0, items: [] },
        top_products_by_qty: [],
        top_products_by_value: [],
        available_branches: [{ branch_code: "B1", branch_description: "Branch 1", orders: 1, revenue: 175.6, raw_rows: 2 }],
        recent_orders: [],
        detailed_orders: [],
      };
    },
  };

  const app = createApp({
    settings,
    db,
    dbClient: { kind: "mysql", description: "test" },
    customerStatsProvider,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    db,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

test("admin auth routes support login, me, logout, and protected admin endpoints", async () => {
  const app = await startTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/admin/customers/search?customer_name=Alpha`);
    assert.equal(response.status, 401);

    response = await fetch(`${app.baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret" }),
    });
    assert.equal(response.status, 200);
    const loginPayload = await response.json();
    assert.equal(loginPayload.authenticated, true);

    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /viomes_admin_session=/);
    assert.match(cookie, /HttpOnly/i);

    response = await fetch(`${app.baseUrl}/api/admin/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const mePayload = await response.json();
    assert.deepEqual(mePayload, { ok: true, username: "admin", authenticated: true });

    response = await fetch(`${app.baseUrl}/api/admin/customers/search?customer_name=Alpha`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const searchPayload = await response.json();
    assert.equal(searchPayload.total, 1);
    assert.equal(searchPayload.items[0].code, "C001");

    response = await fetch(`${app.baseUrl}/api/admin/customers/C001/stats?branch_code=B1`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const statsPayload = await response.json();
    assert.equal(statsPayload.customer.aggregation_level, "branch");
    assert.equal(statsPayload.customer.branch_code, "B1");

    response = await fetch(`${app.baseUrl}/api/admin/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const clearedCookie = response.headers.get("set-cookie");
    assert.match(clearedCookie, /viomes_admin_session=/);
    assert.match(clearedCookie, /HttpOnly/i);
    assert.match(clearedCookie, /Path=\//i);

    response = await fetch(`${app.baseUrl}/api/admin/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const loggedOutPayload = await response.json();
    assert.deepEqual(loggedOutPayload, { ok: true, username: null, authenticated: false });
  } finally {
    await app.close();
  }
});
