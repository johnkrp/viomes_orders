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
  const customerSessions = new Map();
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
    [
      "cust-disabled",
      {
        id: 2,
        username: "cust-disabled",
        password_hash: hashPassword("custsecret"),
        customer_code: "C002",
        is_active: 0,
      },
    ],
  ]);
  const importedCustomers = new Map([
    ["C001", { customer_code: "C001", customer_name: "Alpha Store", is_inactive: 0 }],
  ]);

  return {
    customerSessions,
    async get(sql, params = []) {
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
      if (
        sql.includes("FROM admin_users") &&
        sql.includes("WHERE username = ?")
      ) {
        return undefined;
      }
      if (
        sql.includes("FROM admin_sessions s") &&
        sql.includes("SELECT u.id, u.username")
      ) {
        return undefined;
      }
      throw new Error(`Unexpected db.get SQL: ${sql}`);
    },
    async all() {
      throw new Error("Unexpected db.all call in customer auth test fixture");
    },
    async run(sql, params = []) {
      if (sql.includes("INSERT INTO customer_sessions")) {
        const [customerUserId, token, expiresAt] = params;
        customerSessions.set(token, {
          customer_user_id: customerUserId,
          token,
          expires_at: expiresAt,
        });
        return { changes: 1, lastID: customerSessions.size };
      }
      if (sql.includes("DELETE FROM customer_sessions")) {
        const [token] = params;
        const existed = customerSessions.delete(token);
        return { changes: existed ? 1 : 0, lastID: 0 };
      }
      throw new Error(`Unexpected db.run SQL: ${sql} :: ${JSON.stringify(params)}`);
    },
  };
}

async function startTestApp() {
  const db = createDbFixture();
  const backendDir = await mkdtemp(
    path.join(os.tmpdir(), "viomes-customer-auth-"),
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
    db,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("customer login rejects unknown username, wrong password, and inactive accounts", async () => {
  const app = await startTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nobody", password: "whatever" }),
    });
    assert.equal(response.status, 401);
    let payload = await response.json();
    assert.equal(payload.authenticated, false);

    response = await fetch(`${app.baseUrl}/api/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "cust1", password: "wrong-password" }),
    });
    assert.equal(response.status, 401);

    response = await fetch(`${app.baseUrl}/api/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "cust-disabled", password: "custsecret" }),
    });
    assert.equal(response.status, 401);
  } finally {
    await app.close();
  }
});

test("customer login, me, and logout share a working session", async () => {
  const app = await startTestApp();

  try {
    const loginResponse = await fetch(`${app.baseUrl}/api/customer/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "cust1", password: "custsecret" }),
    });
    assert.equal(loginResponse.status, 200);
    const loginPayload = await loginResponse.json();
    assert.equal(loginPayload.authenticated, true);
    assert.equal(loginPayload.customer_code, "C001");
    assert.equal(loginPayload.customer_name, "Alpha Store");

    const cookie = loginResponse.headers.get("set-cookie");
    assert.match(cookie, /viomes_customer_session=/);
    assert.match(cookie, /HttpOnly/i);

    let response = await fetch(`${app.baseUrl}/api/customer/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const mePayload = await response.json();
    assert.deepEqual(mePayload, {
      ok: true,
      username: "cust1",
      authenticated: true,
      customer_code: "C001",
      customer_name: "Alpha Store",
    });

    response = await fetch(`${app.baseUrl}/api/customer/me`);
    const anonymousPayload = await response.json();
    assert.equal(anonymousPayload.authenticated, false);

    response = await fetch(`${app.baseUrl}/api/customer/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);

    response = await fetch(`${app.baseUrl}/api/customer/me`, {
      headers: { Cookie: cookie },
    });
    const afterLogoutPayload = await response.json();
    assert.equal(afterLogoutPayload.authenticated, false);
  } finally {
    await app.close();
  }
});
