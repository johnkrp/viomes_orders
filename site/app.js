import cookieParser from "cookie-parser";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import path from "node:path";
import { hashPassword, newSessionToken, verifyPassword } from "./lib/admin-auth.js";
import { searchImportedCustomers } from "./lib/admin-customer-search.js";
import { createCustomerStatsProvider } from "./lib/customer-stats/index.js";
import { openDatabase } from "./lib/db/client.js";
import { initDatabaseSchema } from "./lib/db/init-schema.js";
import { buildCorsOriginDelegate, buildSessionCookieOptions } from "./lib/http-security.js";
import {
  ensureImportedCustomerBranchProjection,
  getImportedSalesProjectionHealth,
  IMPORTED_SALES_ARCHITECTURE,
  LATEST_IMPORT_RUN_SQL,
} from "./lib/imported-sales.js";
import { validateRuntimeConfig } from "./lib/runtime-config.js";

export const APP_NAME = "VIOMES Order Form API";

function normGr(value) {
  return (value ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function buildRuntimeSettings({ env = process.env, publicDir, imagesDir } = {}) {
  const port = Number(env.PORT || 3001);
  const nodeEnv = String(env.NODE_ENV || "development").trim().toLowerCase();
  const adminUsernameEnv = String(env.ADMIN_USERNAME || "").trim();
  const adminPasswordEnv = String(env.ADMIN_PASSWORD || "");
  const defaultAdminPassword = "change-me-now";

  return {
    port,
    env,
    nodeEnv,
    adminUsernameEnv,
    adminPasswordEnv,
    adminUsername: adminUsernameEnv || "admin",
    adminPassword: adminPasswordEnv || defaultAdminPassword,
    defaultAdminPassword,
    sessionCookieName: env.SESSION_COOKIE_NAME || "viomes_admin_session",
    sessionMaxAgeSeconds: Number(env.SESSION_MAX_AGE_SECONDS || 28800),
    syncAdminPasswordOnStartup: String(env.SYNC_ADMIN_PASSWORD_ON_STARTUP || "0")
      .trim()
      .toLowerCase(),
    cookieSecureMode: String(
      env.COOKIE_SECURE_MODE || (nodeEnv === "production" ? "auto" : "off"),
    )
      .trim()
      .toLowerCase(),
    publicDir,
    imagesDir,
    corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
  };
}

function shouldUseSecureCookie(req, cookieSecureMode) {
  if (cookieSecureMode === "off") return false;
  if (cookieSecureMode === "on") return true;
  return req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
}

function shouldSyncAdminPasswordOnStartup(value) {
  return value === "1" || value === "true";
}

export async function initializeRuntimeState({ settings }) {
  validateRuntimeConfig({
    cookieSecureMode: settings.cookieSecureMode,
    syncAdminPasswordOnStartup: settings.syncAdminPasswordOnStartup,
    nodeEnv: settings.nodeEnv,
    adminUsernameEnv: settings.adminUsernameEnv,
    adminPasswordEnv: settings.adminPasswordEnv,
    defaultAdminPassword: settings.defaultAdminPassword,
  });

  const dbClient = await openDatabase({ env: settings.env });
  const db = dbClient;
  await initDatabaseSchema({ db, kind: dbClient.kind });
  const branchProjectionRepair = await ensureImportedCustomerBranchProjection(db);
  if (branchProjectionRepair.repaired) {
    console.log(
      `Backfilled imported_customer_branches (${branchProjectionRepair.branch_count} rows) from imported_sales_lines during startup.`,
    );
  }

  const admin = await db.get(
    `SELECT id, username, password_hash FROM admin_users WHERE username = ?`,
    [settings.adminUsername],
  );

  if (!admin) {
    await db.run(
      `
        INSERT INTO admin_users(username, password_hash, is_active)
        VALUES (?, ?, 1)
      `,
      [settings.adminUsername, hashPassword(settings.adminPassword)],
    );
  } else if (
    shouldSyncAdminPasswordOnStartup(settings.syncAdminPasswordOnStartup) &&
    !verifyPassword(settings.adminPassword, admin.password_hash)
  ) {
    await db.run(
      `
        UPDATE admin_users
        SET password_hash = ?
        WHERE id = ?
      `,
      [hashPassword(settings.adminPassword), admin.id],
    );
    console.log(`Admin password synchronized for user "${settings.adminUsername}" during startup.`);
  }

  const customerStatsProvider = createCustomerStatsProvider({
    db,
    sqlDialect: dbClient.kind,
    env: settings.env,
  });

  return { db, dbClient, customerStatsProvider };
}

export function createApp({
  settings,
  db,
  dbClient,
  customerStatsProvider,
} = {}) {
  if (!settings) {
    throw new Error("createApp requires runtime settings.");
  }

  const app = express();
  const corsPolicy = buildCorsOriginDelegate({
    nodeEnv: settings.nodeEnv,
    corsAllowedOrigins: settings.corsAllowedOrigins,
    port: settings.port,
  });

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
      origin: corsPolicy.origin,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use("/images", express.static(settings.imagesDir));
  app.use(express.static(settings.publicDir));
  app.get("/", (req, res) => res.sendFile(path.join(settings.publicDir, "index.html")));

  async function requireAdmin(req, res, next) {
    try {
      const token = req.cookies?.[settings.sessionCookieName];
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
      const expiresAt = new Date(Date.now() + settings.sessionMaxAgeSeconds * 1000).toISOString();

      await db.run(
        `
          INSERT INTO admin_sessions(admin_user_id, token, expires_at)
          VALUES (?, ?, ?)
        `,
        [admin.id, token, expiresAt],
      );

      const cookieOptions = buildSessionCookieOptions({
        secure: shouldUseSecureCookie(req, settings.cookieSecureMode),
      });
      res.cookie(settings.sessionCookieName, token, {
        ...cookieOptions,
        maxAge: settings.sessionMaxAgeSeconds * 1000,
      });
      res.json({ ok: true, username: admin.username, authenticated: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/admin/me", async (req, res) => {
    try {
      const token = req.cookies?.[settings.sessionCookieName];
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
      const token = req.cookies?.[settings.sessionCookieName];
      if (token) {
        await db.run(`DELETE FROM admin_sessions WHERE token = ?`, [token]);
      }
      res.clearCookie(
        settings.sessionCookieName,
        buildSessionCookieOptions({
          secure: shouldUseSecureCookie(req, settings.cookieSecureMode),
        }),
      );
      res.json({ ok: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/admin/customers/search", requireAdmin, async (req, res) => {
    try {
      const payload = await searchImportedCustomers(
        db,
        {
          customer_name: String(req.query.customer_name || "").trim(),
          customer_code: String(req.query.customer_code || "").trim(),
          branch_code: String(req.query.branch_code || "").trim(),
          branch_description: String(req.query.branch_description || "").trim(),
        },
        {
          limit: req.query.limit,
        },
      );
      res.json(payload);
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

  app.post("/api/order/export-xlsx", async (req, res) => {
    try {
      const { customerName, customerEmail, comment, items } = req.body;

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Order");

      worksheet.columns = [
        { header: "ΞΟ‰Ξ΄ΞΉΞΊΟΟ‚", key: "code", width: 15 },
        { header: "Ξ ΞµΟΞΉΞ³ΟΞ±Ο†Ξ®", key: "description", width: 45 },
        { header: "Ξ§ΟΟΞΌΞ±", key: "color", width: 18 },
        { header: "Ξ£Ο…ΟƒΞΊΞµΟ…Ξ±ΟƒΞ―ΞµΟ‚", key: "packs", width: 12 },
        { header: "Ξ¤ΞµΞΌΞ¬Ο‡ΞΉΞ±", key: "qty", width: 10 },
        { header: "ΞΞ³ΞΊΞΏΟ‚ (L)", key: "vol", width: 10 },
      ];

      worksheet.insertRows(1, [
        ["Ξ ΞµΞ»Ξ¬Ο„Ξ·Ο‚:", customerName || ""],
        ["Email:", customerEmail || ""],
        ["Ξ£Ο‡ΟΞ»ΞΉΞ±:", comment || ""],
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

  return app;
}
