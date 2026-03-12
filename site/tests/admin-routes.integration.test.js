import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
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
      if (sql.includes("COUNT(*) AS duplicate_groups")) {
        return { duplicate_groups: 0, duplicate_rows: 0 };
      }
      if (sql.includes("missing_mirrors")) {
        return { missing_mirrors: 0 };
      }
      if (sql.includes("orphan_mirrors")) {
        return { orphan_mirrors: 0 };
      }
      if (sql.includes("imported_orders_count")) {
        return { imported_orders_count: 1, grouped_orders_count: 1 };
      }
      if (sql.includes("imported_product_sales_count")) {
        return { imported_product_sales_count: 1, grouped_products_count: 1 };
      }
      if (sql.includes("imported_monthly_sales_count")) {
        return { imported_monthly_sales_count: 1, grouped_months_count: 1 };
      }
      if (sql.includes("ORDER BY id DESC") && sql.includes("FROM import_runs")) {
        return {
          id: 5,
          dataset: "sales_lines",
          file_name: "cur-week.csv",
          import_mode: "incremental",
          status: "success",
          started_at: "2026-03-12T12:12:49.653353+00:00",
          finished_at: "2026-03-12T12:14:25.888253+00:00",
          source_row_count: 10420,
          rows_in: 10420,
          rows_upserted: 10363,
          rows_skipped_duplicate: 9,
          rows_rejected: 48,
          rebuild_started_at: "2026-03-12T12:14:20.000000+00:00",
          rebuild_finished_at: "2026-03-12T12:14:25.000000+00:00",
          schema_version: "import-ledger-v2",
          trigger_source: "manual_or_cli",
          source_checksum: "abc123",
        };
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
      if (sql.includes("FROM imported_orders")) {
        return [];
      }
      if (sql.includes("unmapped_document_types") || sql.includes("document_type NOT IN")) {
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
  const backendDir = await mkdtemp(path.join(os.tmpdir(), "viomes-admin-upload-"));
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
      ADMIN_UPLOAD_API_KEY: "upload-key",
    },
    publicDir: path.join(siteDir, "public"),
    imagesDir: path.join(siteDir, "images"),
    backendDir,
  });
  const customerStatsProvider = {
    name: "test-provider",
    mode: "test",
    async getCustomerStats(code, options = {}) {
      startTestApp.lastStatsRequestOptions = options;
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

  const importRuns = [];

  const app = createApp({
    settings,
    db,
    dbClient: { kind: "mysql", description: "test" },
    customerStatsProvider,
    async importRunner(context) {
      importRuns.push(context);
      return {
        code: 0,
        signal: null,
        stdout: `[import] ok ${context.uploadTarget.kind}`,
        stderr: "",
      };
    },
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    db,
    backendDir,
    importRuns,
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

    response = await fetch(`${app.baseUrl}/api/admin/customers/C001/stats?branch_code=B1&sales_time_range=6m`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const statsPayload = await response.json();
    assert.equal(statsPayload.customer.aggregation_level, "branch");
    assert.equal(statsPayload.customer.branch_code, "B1");
    assert.equal(startTestApp.lastStatsRequestOptions.branchCode, "B1");
    assert.equal(startTestApp.lastStatsRequestOptions.salesTimeRange, "6m");

    response = await fetch(`${app.baseUrl}/api/admin/import-health`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const healthPayload = await response.json();
    assert.equal(healthPayload.ok, true);
    assert.equal(healthPayload.latest_import_run.dataset, "sales_lines");
    assert.equal(healthPayload.invariants.duplicate_groups, 0);

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

test("order export endpoint validates payloads and returns an xlsx file for valid requests", async () => {
  const app = await startTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/order/export-xlsx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "Alpha Store",
        customerEmail: "not-an-email",
        comment: "Test",
        items: [{ code: "P001", description: "First Product", qty: 12, volume_liters: 5 }],
      }),
    });

    assert.equal(response.status, 400);
    const invalidPayload = await response.json();
    assert.match(invalidPayload.error, /invalid/i);

    response = await fetch(`${app.baseUrl}/api/order/export-xlsx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    assert.match(response.headers.get("content-disposition") || "", /attachment; filename="order_/i);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.ok(buffer.length > 0);
  } finally {
    await app.close();
  }
});

test("admin import upload endpoint stores files and runs the existing importer path", async () => {
  const app = await startTestApp();

  try {
    let response = await fetch(`${app.baseUrl}/api/admin/import-upload/factuals`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer upload-key",
        "Content-Type": "text/csv",
        "X-Upload-Filename": "yearly-factuals.csv",
      },
      body: "date,document\n2026-01-01,A-1\n",
    });

    assert.equal(response.status, 200);
    const uploadPayload = await response.json();
    assert.equal(uploadPayload.ok, true);
    assert.equal(uploadPayload.dataset, "sales");
    assert.equal(uploadPayload.file_name, "yearly-factuals.csv");

    const storedFactuals = await readFile(path.join(app.backendDir, "yearly-factuals.csv"), "utf8");
    assert.match(storedFactuals, /A-1/);
    assert.equal(app.importRuns.length, 1);
    assert.match(app.importRuns[0].args.join(" "), /--sales-files=/);

    response = await fetch(`${app.baseUrl}/api/admin/import-upload/receivables`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer upload-key",
        "Content-Type": "application/octet-stream",
        "X-Upload-Filename": "yearly-receivables.csv",
      },
      body: "customer,balance\nC001,120.55\n",
    });

    assert.equal(response.status, 200);
    const ledgerPayload = await response.json();
    assert.equal(ledgerPayload.ok, true);
    assert.equal(ledgerPayload.dataset, "ledger");
    assert.equal(app.importRuns.length, 2);
    assert.match(app.importRuns[1].args.join(" "), /--ledger-file=/);
    assert.match(app.importRuns[1].args.join(" "), /--trigger-source=admin_upload:upload-api:yearly-receivables\.csv/);
  } finally {
    await app.close();
  }
});
