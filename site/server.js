import cookieParser from "cookie-parser";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, newSessionToken, verifyPassword } from "./lib/admin-auth.js";
import { createCustomerStatsProvider } from "./lib/customer-stats/index.js";
import { openDatabase } from "./lib/db/client.js";
import { initDatabaseSchema } from "./lib/db/init-schema.js";
import {
  getImportedSalesProjectionHealth,
  IMPORTED_SALES_ARCHITECTURE,
  LATEST_IMPORT_RUN_SQL,
} from "./lib/imported-sales.js";
import { validateRuntimeConfig } from "./lib/runtime-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_NAME = "VIOMES Order Form API";
const PORT = Number(process.env.PORT || 3001);
const ADMIN_USERNAME_ENV = String(process.env.ADMIN_USERNAME || "").trim();
const ADMIN_PASSWORD_ENV = String(process.env.ADMIN_PASSWORD || "");
const ADMIN_USERNAME = ADMIN_USERNAME_ENV || "admin";
const DEFAULT_ADMIN_PASSWORD = "change-me-now";
const ADMIN_PASSWORD = ADMIN_PASSWORD_ENV || DEFAULT_ADMIN_PASSWORD;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "viomes_admin_session";
const SESSION_MAX_AGE_SECONDS = Number(process.env.SESSION_MAX_AGE_SECONDS || 28800);
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const SYNC_ADMIN_PASSWORD_ON_STARTUP = String(process.env.SYNC_ADMIN_PASSWORD_ON_STARTUP || "0")
  .trim()
  .toLowerCase();
const COOKIE_SECURE_MODE = String(
  process.env.COOKIE_SECURE_MODE || (NODE_ENV === "production" ? "auto" : "off"),
)
  .trim()
  .toLowerCase();
const publicDir = path.join(__dirname, "public");

const app = express();
let db;
let dbClient;
let customerStatsProvider;

app.use((req, res, next) => {
  if (req.path === "/admin.html" || req.path === "/admin.js" || req.path === "/styles.css") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use("/images", express.static(path.join(__dirname, "images")));
app.use(express.static(publicDir));
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

function normGr(value) {
  return (value ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function shouldUseSecureCookie(req) {
  if (COOKIE_SECURE_MODE === "off") return false;
  if (COOKIE_SECURE_MODE === "on") return true;
  return req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
}

function shouldSyncAdminPasswordOnStartup() {
  return SYNC_ADMIN_PASSWORD_ON_STARTUP === "1" || SYNC_ADMIN_PASSWORD_ON_STARTUP === "true";
}

async function initDb() {
  validateRuntimeConfig({
    cookieSecureMode: COOKIE_SECURE_MODE,
    syncAdminPasswordOnStartup: SYNC_ADMIN_PASSWORD_ON_STARTUP,
    nodeEnv: NODE_ENV,
    adminUsernameEnv: ADMIN_USERNAME_ENV,
    adminPasswordEnv: ADMIN_PASSWORD_ENV,
    defaultAdminPassword: DEFAULT_ADMIN_PASSWORD,
  });
  dbClient = await openDatabase({ env: process.env });
  db = dbClient;
  await initDatabaseSchema({ db, kind: dbClient.kind });

  const admin = await db.get(
    `SELECT id, username, password_hash FROM admin_users WHERE username = ?`,
    [ADMIN_USERNAME],
  );

  if (!admin) {
    await db.run(
      `
        INSERT INTO admin_users(username, password_hash, is_active)
        VALUES (?, ?, 1)
      `,
      [ADMIN_USERNAME, hashPassword(ADMIN_PASSWORD)],
    );
  } else if (shouldSyncAdminPasswordOnStartup() && !verifyPassword(ADMIN_PASSWORD, admin.password_hash)) {
    await db.run(
      `
        UPDATE admin_users
        SET password_hash = ?
        WHERE id = ?
      `,
      [hashPassword(ADMIN_PASSWORD), admin.id],
    );
    console.log(`Admin password synchronized for user "${ADMIN_USERNAME}" during startup.`);
  }

  customerStatsProvider = createCustomerStatsProvider({
    db,
    sqlDialect: dbClient.kind,
    env: process.env,
  });
}

async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    const now = new Date().toISOString();
    const admin = await db.get(
      `
        SELECT u.id, u.username
        FROM admin_sessions s
        JOIN admin_users u ON u.id = s.admin_user_id
        WHERE s.token = ?
          AND s.expires_at > ?
          AND u.is_active = 1
      `,
      [token, now],
    );

    if (!admin) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }

    req.admin = admin;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
}

app.get("/api/health", async (req, res) => {
  let latestImportRun = null;
  try {
    latestImportRun = await db.get(LATEST_IMPORT_RUN_SQL);
  } catch {
    latestImportRun = null;
  }

  res.json({
    ok: true,
    app: APP_NAME,
    db_client: dbClient?.kind || null,
    customer_stats_provider: customerStatsProvider?.name || null,
    customer_stats_provider_mode: customerStatsProvider?.mode || null,
    db_architecture: {
      raw_fact_table: IMPORTED_SALES_ARCHITECTURE.rawFactTable,
      projection_tables: IMPORTED_SALES_ARCHITECTURE.projectionTables,
      legacy_dormant_tables: IMPORTED_SALES_ARCHITECTURE.legacyDormantTables,
      projection_strategy: IMPORTED_SALES_ARCHITECTURE.projectionStrategy,
    },
    latest_import_run: latestImportRun,
  });
});

app.get("/api/admin/import-health", requireAdmin, async (req, res) => {
  try {
    const health = await getImportedSalesProjectionHealth(db);
    res.json(health);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/catalog", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size || "10", 10), 1), 200);
    const qRaw = String(req.query.q || "").trim();
    const qNorm = normGr(qRaw);
    const offset = (page - 1) * pageSize;

    let total = 0;
    let rows = [];

    if (qRaw) {
      const needleRaw = `%${qRaw.toLowerCase()}%`;
      const needleNorm = `%${qNorm}%`;
      total = (
        await db.get(
          `
            SELECT COUNT(*) AS n
            FROM products
            WHERE lower(code) LIKE ?
               OR lower(description) LIKE ?
               OR lower(color) LIKE ?
               OR description_norm LIKE ?
               OR color_norm LIKE ?
          `,
          [needleRaw, needleRaw, needleRaw, needleNorm, needleNorm],
        )
      ).n;

      rows = await db.all(
        `
          SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
          FROM products
          WHERE lower(code) LIKE ?
             OR lower(description) LIKE ?
             OR lower(color) LIKE ?
             OR description_norm LIKE ?
             OR color_norm LIKE ?
          ORDER BY code
          LIMIT ? OFFSET ?
        `,
        [needleRaw, needleRaw, needleRaw, needleNorm, needleNorm, pageSize, offset],
      );
    } else {
      total = (await db.get(`SELECT COUNT(*) AS n FROM products`)).n;
      rows = await db.all(
        `
          SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
          FROM products
          ORDER BY code
          LIMIT ? OFFSET ?
        `,
        [pageSize, offset],
      );
    }

    res.json({
      items: rows,
      page,
      page_size: pageSize,
      total,
      pages: total ? Math.ceil(total / pageSize) : 1,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    const admin = await db.get(
      `
        SELECT id, username, password_hash, is_active
        FROM admin_users
        WHERE username = ?
      `,
      [username],
    );

    if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
      res.status(401).json({ ok: false, username: null, authenticated: false });
      return;
    }

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

    await db.run(
      `
        INSERT INTO admin_sessions(admin_user_id, token, expires_at)
        VALUES (?, ?, ?)
      `,
      [admin.id, token, expiresAt],
    );

    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS * 1000,
      secure: shouldUseSecureCookie(req),
    });
    res.json({ ok: true, username: admin.username, authenticated: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/admin/me", async (req, res) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      res.json({ ok: true, username: null, authenticated: false });
      return;
    }

    const admin = await db.get(
      `
        SELECT u.username
        FROM admin_sessions s
        JOIN admin_users u ON u.id = s.admin_user_id
        WHERE s.token = ?
          AND s.expires_at > ?
          AND u.is_active = 1
      `,
      [token, new Date().toISOString()],
    );

    if (!admin) {
      res.json({ ok: true, username: null, authenticated: false });
      return;
    }

    res.json({ ok: true, username: admin.username, authenticated: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/admin/logout", async (req, res) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await db.run(`DELETE FROM admin_sessions WHERE token = ?`, [token]);
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/admin/customers/search", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);
    const filters = {
      customer_name: String(req.query.customer_name || "").trim(),
      customer_code: String(req.query.customer_code || "").trim(),
      branch_code: String(req.query.branch_code || "").trim(),
      branch_description: String(req.query.branch_description || "").trim(),
    };

    if (!Object.values(filters).some(Boolean)) {
      res.json({ items: [], total: 0, filters });
      return;
    }

    const whereParts = [];
    const whereParams = [];
    const exactScoreParts = [];
    const exactScoreParams = [];
    const prefixScoreParts = [];
    const prefixScoreParams = [];

    if (filters.customer_name) {
      whereParts.push("customer_name LIKE ?");
      whereParams.push(`%${filters.customer_name}%`);
      exactScoreParts.push("MAX(CASE WHEN customer_name = ? THEN 1 ELSE 0 END)");
      exactScoreParams.push(filters.customer_name);
      prefixScoreParts.push("MAX(CASE WHEN customer_name LIKE ? THEN 1 ELSE 0 END)");
      prefixScoreParams.push(`${filters.customer_name}%`);
    }

    if (filters.customer_code) {
      whereParts.push("customer_code LIKE ?");
      whereParams.push(`%${filters.customer_code}%`);
      exactScoreParts.push("MAX(CASE WHEN customer_code = ? THEN 1 ELSE 0 END)");
      exactScoreParams.push(filters.customer_code);
      prefixScoreParts.push("MAX(CASE WHEN customer_code LIKE ? THEN 1 ELSE 0 END)");
      prefixScoreParams.push(`${filters.customer_code}%`);
    }

    if (filters.branch_code) {
      whereParts.push("branch_code LIKE ?");
      whereParams.push(`%${filters.branch_code}%`);
      exactScoreParts.push("MAX(CASE WHEN branch_code = ? THEN 1 ELSE 0 END)");
      exactScoreParams.push(filters.branch_code);
      prefixScoreParts.push("MAX(CASE WHEN branch_code LIKE ? THEN 1 ELSE 0 END)");
      prefixScoreParams.push(`${filters.branch_code}%`);
    }

    if (filters.branch_description) {
      whereParts.push("branch_description LIKE ?");
      whereParams.push(`%${filters.branch_description}%`);
      exactScoreParts.push("MAX(CASE WHEN branch_description = ? THEN 1 ELSE 0 END)");
      exactScoreParams.push(filters.branch_description);
      prefixScoreParts.push("MAX(CASE WHEN branch_description LIKE ? THEN 1 ELSE 0 END)");
      prefixScoreParams.push(`${filters.branch_description}%`);
    }

    const rows = await db.all(
      `
        SELECT
          customer_code AS code,
          COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS name,
          CASE
            WHEN COUNT(DISTINCT CONCAT(COALESCE(branch_code, ''), '||', COALESCE(branch_description, ''))) = 1
              THEN MAX(branch_code)
            ELSE ''
          END AS branch_code,
          CASE
            WHEN COUNT(DISTINCT CONCAT(COALESCE(branch_code, ''), '||', COALESCE(branch_description, ''))) = 1
              THEN MAX(branch_description)
            ELSE CONCAT(COUNT(DISTINCT CONCAT(COALESCE(branch_code, ''), '||', COALESCE(branch_description, ''))), ' υποκαταστήματα')
          END AS branch_description
        FROM imported_sales_lines
        WHERE ${whereParts.join(" AND ")}
        GROUP BY customer_code
        ORDER BY
          (${exactScoreParts.join(" + ") || "0"}) DESC,
          (${prefixScoreParts.join(" + ") || "0"}) DESC,
          name,
          customer_code
        LIMIT ?
      `,
      [...whereParams, ...exactScoreParams, ...prefixScoreParams, limit],
    );

    res.json({
      filters,
      total: rows.length,
      items: rows.map((row) => ({
        code: row.code,
        name: row.name,
        branch_code: row.branch_code || "",
        branch_description: row.branch_description || "",
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/admin/customers/:code/stats", requireAdmin, async (req, res) => {
  try {
    const payload = await customerStatsProvider.getCustomerStats(req.params.code, {
      branchCode: String(req.query.branch_code || "").trim() || null,
      branchScopeCode: String(req.query.filter_branch_code || "").trim() || null,
      branchScopeDescription: String(req.query.filter_branch_description || "").trim() || null,
    });
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ detail: error.message || String(error) });
  }
});

// Compatibility endpoint retained for manual/server-side export flows.
// The current public order form uses catalog.json plus client-side XLSX/email draft generation.
app.post("/api/order/export-xlsx", async (req, res) => {
  try {
    const { customerName, customerEmail, comment, items } = req.body;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Order");

    worksheet.columns = [
      { header: "Κωδικός", key: "code", width: 15 },
      { header: "Περιγραφή", key: "description", width: 45 },
      { header: "Χρώμα", key: "color", width: 18 },
      { header: "Συσκευασίες", key: "packs", width: 12 },
      { header: "Τεμάχια", key: "qty", width: 10 },
      { header: "Όγκος (L)", key: "vol", width: 10 },
    ];

    worksheet.insertRows(1, [
      ["Πελάτης:", customerName || ""],
      ["Email:", customerEmail || ""],
      ["Σχόλια:", comment || ""],
      [],
    ]);

    worksheet.spliceRows(
      5,
      0,
      worksheet.columns.map((column) => column.header),
    );
    worksheet.getRow(5).font = { bold: true };

    (items || []).forEach((item) => {
      worksheet.addRow({
        code: item.code,
        description: item.description,
        color: item.color,
        packs: item.packs ?? "",
        qty: item.qty,
        vol: item.volume_liters ?? 0,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `order_${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: String(error) });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`${APP_NAME} listening on :${PORT}`);
      console.log(`Static root: ${publicDir}`);
      console.log(`Database (${dbClient?.kind || "unknown"}): ${dbClient?.description || "n/a"}`);
      console.log(`Customer stats provider: ${customerStatsProvider?.name || "n/a"}`);
    });
  })
  .catch((error) => {
    console.error("DB init failed:", error);
    process.exit(1);
  });
