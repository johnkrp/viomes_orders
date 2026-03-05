import cookieParser from "cookie-parser";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCustomerStatsProvider } from "./lib/customer-stats/index.js";
import { openDatabase } from "./lib/db/client.js";
import { initDatabaseSchema } from "./lib/db/init-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_NAME = "VIOMES Order Form API";
const PORT = Number(process.env.PORT || 3001);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "viomes_admin_session";
const SESSION_MAX_AGE_SECONDS = Number(process.env.SESSION_MAX_AGE_SECONDS || 28800);
const PBKDF2_ITERATIONS = 600000;

const DB_PATH = path.join(__dirname, "..", "backend", "app.db");
const publicDir = path.join(__dirname, "public");

const app = express();
let db;
let dbClient;
let customerStatsProvider;

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

function hashPassword(password, salt) {
  const effectiveSalt = salt || crypto.randomBytes(16).toString("hex");
  const digest = crypto
    .pbkdf2Sync(password, effectiveSalt, PBKDF2_ITERATIONS, 32, "sha256")
    .toString("hex");
  return `${effectiveSalt}$${digest}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes("$")) return false;
  const [salt, digest] = storedHash.split("$", 2);
  const computed = hashPassword(password, salt).split("$", 2)[1];
  return crypto.timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(computed, "utf8"));
}

function newSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

async function initDb() {
  dbClient = await openDatabase({ env: process.env, sqlitePath: DB_PATH });
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    db_client: dbClient?.kind || null,
    customer_stats_provider: customerStatsProvider?.name || null,
  });
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
      secure: false,
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

app.get("/api/admin/customers/:code/stats", requireAdmin, async (req, res) => {
  try {
    const payload = await customerStatsProvider.getCustomerStats(req.params.code);
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
