import cookieParser from "cookie-parser";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { hashPassword, newSessionToken, verifyPassword } from "./lib/admin-auth.js";
import { searchImportedCustomers } from "./lib/admin-customer-search.js";
import { createCustomerStatsProvider } from "./lib/customer-stats/index.js";
import { openDatabase } from "./lib/db/client.js";
import { initDatabaseSchema } from "./lib/db/init-schema.js";
import { buildCorsOriginDelegate, buildSessionCookieOptions } from "./lib/http-security.js";
import {
  registerAdminAuthRoutes,
  registerAdminCustomerRoutes,
  registerAdminImportRoutes,
} from "./lib/routes/admin.js";
import { registerPublicRoutes } from "./lib/routes/public.js";
import {
  ensureImportedCustomerBranchProjection,
  getImportedSalesProjectionHealth,
  IMPORTED_SALES_ARCHITECTURE,
  LATEST_IMPORT_RUN_SQL,
} from "./lib/imported-sales.js";
import { validateRuntimeConfig } from "./lib/runtime-config.js";

export const APP_NAME = "VIOMES Order Form API";
const ORDER_EXPORT_MAX_ITEMS = 500;
const ORDER_EXPORT_MAX_TEXT_LENGTH = 500;
const ORDER_EXPORT_MAX_COMMENT_LENGTH = 4000;
const ORDER_EXPORT_FILENAME_PREFIX = "order";
const ADMIN_IMPORT_UPLOAD_MAX_BYTES = 250 * 1024 * 1024;
const ADMIN_IMPORT_OUTPUT_SNIPPET_MAX = 4000;

const ORDER_EXPORT_SHEET_COLUMNS = [
  { header: "\u039a\u03a9\u0394\u0399\u039a\u039f\u03a3", key: "code", width: 15 },
  { header: "\u03a0\u0395\u03a1\u0399\u0393\u03a1\u0391\u03a6\u0397", key: "description", width: 45 },
  { header: "\u03a7\u03a1\u03a9\u039c\u0391", key: "color", width: 18 },
  { header: "\u03a3\u03a5\u03a3\u039a\u0395\u03a5\u0391\u03a3\u0399\u0395\u03a3", key: "packs", width: 12 },
  { header: "\u03a4\u0395\u039c\u0391\u03a7\u0399\u0391", key: "qty", width: 10 },
  { header: "\u039f\u0393\u039a\u039f\u03a3 (L)", key: "vol", width: 10 },
];

function sanitizeExportText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validateEmailAddress(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateOrderExportRequest(body) {
  const customerName = sanitizeExportText(body?.customerName, ORDER_EXPORT_MAX_TEXT_LENGTH);
  const customerEmail = sanitizeExportText(body?.customerEmail, ORDER_EXPORT_MAX_TEXT_LENGTH);
  const comment = sanitizeExportText(body?.comment, ORDER_EXPORT_MAX_COMMENT_LENGTH);
  const items = Array.isArray(body?.items) ? body.items : null;

  if (!items || !items.length) {
    const error = new Error("Order export requires at least one item.");
    error.status = 400;
    throw error;
  }

  if (items.length > ORDER_EXPORT_MAX_ITEMS) {
    const error = new Error(`Order export supports up to ${ORDER_EXPORT_MAX_ITEMS} items.`);
    error.status = 400;
    throw error;
  }

  if (!validateEmailAddress(customerEmail)) {
    const error = new Error("Customer email address is invalid.");
    error.status = 400;
    throw error;
  }

  const normalizedItems = items.map((item, index) => {
    const code = sanitizeExportText(item?.code, 128);
    const description = sanitizeExportText(item?.description, 255);
    const color = sanitizeExportText(item?.color, 128);
    const packs =
      item?.packs === "" || item?.packs === null || item?.packs === undefined
        ? ""
        : Number(item.packs);
    const qty = Number(item?.qty);
    const volumeLiters = item?.volume_liters === undefined ? 0 : Number(item.volume_liters);

    if (!code) {
      const error = new Error(`Item ${index + 1} is missing a product code.`);
      error.status = 400;
      throw error;
    }

    if (!description) {
      const error = new Error(`Item ${index + 1} is missing a description.`);
      error.status = 400;
      throw error;
    }

    if (!validatePositiveInteger(qty)) {
      const error = new Error(`Item ${index + 1} has an invalid quantity.`);
      error.status = 400;
      throw error;
    }

    if (packs !== "" && !validatePositiveInteger(packs)) {
      const error = new Error(`Item ${index + 1} has an invalid package count.`);
      error.status = 400;
      throw error;
    }

    if (!validateNonNegativeNumber(volumeLiters)) {
      const error = new Error(`Item ${index + 1} has an invalid volume value.`);
      error.status = 400;
      throw error;
    }

    return {
      code,
      description,
      color,
      packs,
      qty,
      volume_liters: volumeLiters,
    };
  });

  return {
    customerName,
    customerEmail,
    comment,
    items: normalizedItems,
  };
}

function normGr(value) {
  return (value ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sanitizeUploadedFilename(value, fallbackName) {
  const raw = String(value || "").trim();
  const base = path.basename(raw || fallbackName || "upload.csv");
  const normalized = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized || fallbackName || "upload.csv";
}

function validateImportUploadFilename(uploadTarget, filename) {
  const normalized = String(filename || "").trim().toLowerCase();
  if (!normalized) {
    const error = new Error("Upload filename is required.");
    error.status = 400;
    throw error;
  }

  if (!normalized.endsWith(".csv")) {
    const error = new Error("Upload filename must end with .csv.");
    error.status = 400;
    throw error;
  }

  const salesNames = new Set(["yearly-factuals.csv", "cur-week.csv"]);
  const ledgerNames = new Set(["yearly-receivables.csv", "new-kart.csv"]);

  if (uploadTarget.kind === "sales" && ledgerNames.has(normalized)) {
    const error = new Error(`Filename "${filename}" looks like a ledger upload. Use the ledger dataset instead.`);
    error.status = 400;
    throw error;
  }

  if (uploadTarget.kind === "ledger" && salesNames.has(normalized)) {
    const error = new Error(`Filename "${filename}" looks like a sales upload. Use the sales dataset instead.`);
    error.status = 400;
    throw error;
  }
}

function resolveImportUploadTarget(datasetName) {
  const normalized = String(datasetName || "").trim().toLowerCase();
  if (["sales", "factuals", "yearly-factuals"].includes(normalized)) {
    return {
      kind: "sales",
      defaultFilename: "yearly-factuals.csv",
      importerFlag: "sales-files",
    };
  }
  if (["ledger", "receivables", "yearly-receivables"].includes(normalized)) {
    return {
      kind: "ledger",
      defaultFilename: "yearly-receivables.csv",
      importerFlag: "ledger-file",
    };
  }
  return null;
}

function formatImportCommandArgs(args = {}) {
  return Object.entries(args)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `--${key}=${value}`);
}

function trimCommandOutput(text, maxLength = ADMIN_IMPORT_OUTPUT_SNIPPET_MAX) {
  const normalized = String(text || "").trim();
  if (!normalized || normalized.length <= maxLength) return normalized;
  return normalized.slice(normalized.length - maxLength);
}

export function buildRuntimeSettings({ env = process.env, publicDir, imagesDir, backendDir } = {}) {
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
    adminUploadApiKey: String(env.ADMIN_UPLOAD_API_KEY || "").trim(),
    cookieSecureMode: String(
      env.COOKIE_SECURE_MODE || (nodeEnv === "production" ? "auto" : "off"),
    )
      .trim()
      .toLowerCase(),
    publicDir,
    imagesDir,
    siteDir: path.resolve(publicDir, ".."),
    backendDir: backendDir ? path.resolve(backendDir) : path.resolve(publicDir, "..", "..", "backend"),
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

function logRouteError(error) {
  if ((error?.status || 500) >= 500) {
    console.error(error);
  }
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
  importRunner,
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
    const isAdminAsset =
      req.path === "/admin.html" ||
      req.path === "/admin.js" ||
      req.path === "/styles.css" ||
      req.path.endsWith(".js");

    if (isAdminAsset) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    next();
  });

  app.use(
    (req, res, next) =>
      cors({
        origin: (origin, callback) => corsPolicy.origin(origin, req, callback),
        credentials: true,
      })(req, res, next),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use("/images", express.static(settings.imagesDir));
  app.use(express.static(settings.publicDir));

  async function getAuthenticatedAdmin(req) {
    const bearerToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (settings.adminUploadApiKey && bearerToken === settings.adminUploadApiKey) {
      return { id: null, username: "upload-api" };
    }

    const token = req.cookies?.[settings.sessionCookieName];
    if (!token) return null;

    const now = new Date().toISOString();
    return db.get(
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
  }

  async function requireAdmin(req, res, next) {
    try {
      const admin = await getAuthenticatedAdmin(req);
      if (!admin) {
        res.status(401).json({ detail: "Unauthorized" });
        return;
      }

      req.admin = admin;
      next();
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  }

  async function runAdminImport({ uploadTarget, filePath, originalFilename, adminUsername }) {
    const args = formatImportCommandArgs({
      [uploadTarget.importerFlag]: filePath,
      "mysql-host": settings.env.MYSQL_HOST,
      "mysql-port": settings.env.MYSQL_PORT,
      "mysql-database": settings.env.MYSQL_DATABASE,
      "mysql-user": settings.env.MYSQL_USER,
      "trigger-source": `admin_upload:${adminUsername || "unknown"}:${originalFilename}`,
    });

    if (typeof importRunner === "function") {
      return importRunner({ args, settings, uploadTarget, filePath, originalFilename, adminUsername });
    }

    const scriptPath = path.join(settings.siteDir, "scripts", "run-entersoft-import.js");
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        cwd: settings.siteDir,
        env: settings.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        resolve({ code: code ?? 1, signal: signal || null, stdout, stderr, args });
      });
    });
  }

  registerPublicRoutes(app, {
    db,
    path,
    settings,
    normGr,
    validateOrderExportRequest,
    ORDER_EXPORT_FILENAME_PREFIX,
    ORDER_EXPORT_SHEET_COLUMNS,
    ExcelJS,
    APP_NAME,
    dbClient,
    customerStatsProvider,
    IMPORTED_SALES_ARCHITECTURE,
    LATEST_IMPORT_RUN_SQL,
    logRouteError,
  });

  registerAdminImportRoutes(app, {
    express,
    mkdir,
    writeFile,
    path,
    db,
    settings,
    requireAdmin,
    runAdminImport,
    getImportedSalesProjectionHealth,
    trimCommandOutput,
    resolveImportUploadTarget,
    sanitizeUploadedFilename,
    validateImportUploadFilename,
    ADMIN_IMPORT_UPLOAD_MAX_BYTES,
    logRouteError,
  });

  registerAdminAuthRoutes(app, {
    db,
    settings,
    verifyPassword,
    newSessionToken,
    buildSessionCookieOptions,
    shouldUseSecureCookie,
    logRouteError,
  });

  registerAdminCustomerRoutes(app, {
    requireAdmin,
    db,
    searchImportedCustomers,
    customerStatsProvider,
    logRouteError,
  });

  app.post("/api/order/export-xlsx", async (req, res) => {
    try {
      const { customerName, customerEmail, comment, items } = validateOrderExportRequest(req.body);

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
      worksheet.getCell("A1").value = "\u03a0\u03b5\u03bb\u03ac\u03c4\u03b7\u03c2:";
      worksheet.getCell("A3").value = "\u03a3\u03c7\u03cc\u03bb\u03b9\u03b1:";
      ORDER_EXPORT_SHEET_COLUMNS.forEach((column, index) => {
        worksheet.getRow(5).getCell(index + 1).value = column.header;
      });

      items.forEach((item) => {
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
      const filename = `${ORDER_EXPORT_FILENAME_PREFIX}_${Date.now()}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      logRouteError(error);
      res.status(error.status || 500).json({ error: error.message || String(error) });
    }
  });

  return app;
}
