import cookieParser from "cookie-parser";
import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "node:url";
import { open } from "sqlite";

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
const publicDir = __dirname;

const app = express();
let db;

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
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

function asMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function parseIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function productStatRow(row) {
  return {
    code: row.code,
    description: row.description,
    qty: row.qty || 0,
    orders: row.orders || 0,
    revenue: asMoney(row.revenue),
    avg_unit_price: asMoney(row.avg_unit_price),
  };
}

async function initDb() {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      pieces_per_package INTEGER NOT NULL,
      volume_liters REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT 'N/A',
      description_norm TEXT NOT NULL DEFAULT '',
      color_norm TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      customer_code TEXT,
      notes TEXT,
      total_qty_pieces INTEGER NOT NULL DEFAULT 0,
      total_net_value REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_pieces INTEGER NOT NULL CHECK(qty_pieces > 0),
      unit_price REAL NOT NULL DEFAULT 0,
      discount_pct REAL NOT NULL DEFAULT 0,
      line_net_value REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT,
      source TEXT NOT NULL DEFAULT 'local'
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );
  `);

  const orderColumns = await db.all(`PRAGMA table_info(orders)`);
  const orderLineColumns = await db.all(`PRAGMA table_info(order_lines)`);
  const hasOrderColumn = (name) => orderColumns.some((column) => column.name === name);
  const hasOrderLineColumn = (name) => orderLineColumns.some((column) => column.name === name);

  if (!hasOrderColumn("customer_code")) {
    await db.exec(`ALTER TABLE orders ADD COLUMN customer_code TEXT`);
  }
  if (!hasOrderColumn("total_qty_pieces")) {
    await db.exec(`ALTER TABLE orders ADD COLUMN total_qty_pieces INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasOrderColumn("total_net_value")) {
    await db.exec(`ALTER TABLE orders ADD COLUMN total_net_value REAL NOT NULL DEFAULT 0`);
  }
  if (!hasOrderLineColumn("unit_price")) {
    await db.exec(`ALTER TABLE order_lines ADD COLUMN unit_price REAL NOT NULL DEFAULT 0`);
  }
  if (!hasOrderLineColumn("discount_pct")) {
    await db.exec(`ALTER TABLE order_lines ADD COLUMN discount_pct REAL NOT NULL DEFAULT 0`);
  }
  if (!hasOrderLineColumn("line_net_value")) {
    await db.exec(`ALTER TABLE order_lines ADD COLUMN line_net_value REAL NOT NULL DEFAULT 0`);
  }

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

async function buildCustomerStats(customerCode) {
  const code = String(customerCode || "").trim();
  if (!code) {
    const error = new Error("Customer code is required.");
    error.status = 400;
    throw error;
  }

  const customer = await db.get(
    `
      SELECT code, name, email
      FROM customers
      WHERE code = ?
    `,
    [code],
  );

  if (!customer) {
    const error = new Error(`Customer not found: ${code}`);
    error.status = 404;
    throw error;
  }

  const summary = await db.get(
    `
      SELECT
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(SUM(ol.line_net_value), 0) AS total_revenue,
        MAX(o.created_at) AS last_order_date
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
    `,
    [code],
  );

  const productQuery = `
    SELECT
      p.code,
      p.description,
      SUM(ol.qty_pieces) AS qty,
      COUNT(DISTINCT o.id) AS orders,
      COALESCE(SUM(ol.line_net_value), 0) AS revenue,
      CASE
        WHEN SUM(ol.qty_pieces) > 0 THEN COALESCE(SUM(ol.line_net_value), 0) / SUM(ol.qty_pieces)
        ELSE 0
      END AS avg_unit_price
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    JOIN products p ON p.id = ol.product_id
    WHERE o.customer_code = ?
    GROUP BY p.id, p.code, p.description
  `;

  const topProductsByQty = await db.all(
    `${productQuery} ORDER BY qty DESC, revenue DESC, p.code ASC LIMIT 10`,
    [code],
  );
  const topProductsByValue = await db.all(
    `${productQuery} ORDER BY revenue DESC, qty DESC, p.code ASC LIMIT 10`,
    [code],
  );

  const recentOrders = await db.all(
    `
      SELECT
        o.id AS order_id,
        o.created_at,
        o.total_net_value,
        COUNT(ol.id) AS total_lines,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
      GROUP BY o.id, o.created_at, o.total_net_value
      ORDER BY o.created_at DESC
      LIMIT 10
    `,
    [code],
  );

  const detailedOrderHeaders = await db.all(
    `
      SELECT
        o.id AS order_id,
        o.created_at,
        o.notes,
        o.total_net_value,
        COUNT(ol.id) AS total_lines,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
      GROUP BY o.id, o.created_at, o.notes, o.total_net_value
      ORDER BY o.created_at DESC
      LIMIT 6
    `,
    [code],
  );

  const detailedOrders = [];
  for (const order of detailedOrderHeaders) {
    const lines = await db.all(
      `
        SELECT
          p.code,
          p.description,
          ol.qty_pieces,
          ol.unit_price,
          ol.discount_pct,
          ol.line_net_value
        FROM order_lines ol
        JOIN products p ON p.id = ol.product_id
        WHERE ol.order_id = ?
        ORDER BY p.code ASC
      `,
      [order.order_id],
    );

    detailedOrders.push({
      order_id: order.order_id,
      created_at: order.created_at,
      notes: order.notes || "",
      total_lines: order.total_lines || 0,
      total_pieces: order.total_pieces || 0,
      total_net_value: asMoney(order.total_net_value),
      average_discount_pct: asMoney(order.average_discount_pct),
      lines: lines.map((line) => ({
        code: line.code,
        description: line.description,
        qty: line.qty_pieces || 0,
        unit_price: asMoney(line.unit_price),
        discount_pct: asMoney(line.discount_pct),
        line_net_value: asMoney(line.line_net_value),
      })),
    });
  }

  const now = new Date();
  const lastOrderDate = parseIso(summary.last_order_date);
  const daysSinceLastOrder = lastOrderDate
    ? Math.max(0, Math.floor((now.getTime() - lastOrderDate.getTime()) / 86400000))
    : null;

  const recentChronological = [...recentOrders]
    .map((row) => ({ ...row, parsedDate: parseIso(row.created_at) }))
    .filter((row) => row.parsedDate)
    .sort((a, b) => a.parsedDate - b.parsedDate);

  let averageDaysBetweenOrders = null;
  if (recentChronological.length >= 2) {
    const gaps = [];
    for (let index = 1; index < recentChronological.length; index += 1) {
      const previous = recentChronological[index - 1].parsedDate;
      const current = recentChronological[index].parsedDate;
      gaps.push(Math.floor((current.getTime() - previous.getTime()) / 86400000));
    }
    if (gaps.length) {
      averageDaysBetweenOrders = Number((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length).toFixed(1));
    }
  }

  function revenueSince(days) {
    const cutoff = new Date(now.getTime() - days * 86400000);
    return asMoney(
      recentOrders.reduce((sum, order) => {
        const date = parseIso(order.created_at);
        if (!date || date < cutoff) return sum;
        return sum + Number(order.total_net_value || 0);
      }, 0),
    );
  }

  const totalOrders = summary.total_orders || 0;
  const totalRevenue = asMoney(summary.total_revenue);

  return {
    customer: {
      code: customer.code,
      name: customer.name,
      email: customer.email,
    },
    summary: {
      total_orders: totalOrders,
      total_pieces: summary.total_pieces || 0,
      total_revenue: totalRevenue,
      revenue_3m: revenueSince(90),
      revenue_6m: revenueSince(180),
      revenue_12m: revenueSince(365),
      average_order_value: totalOrders ? asMoney(totalRevenue / totalOrders) : 0,
      average_days_between_orders: averageDaysBetweenOrders,
      days_since_last_order: daysSinceLastOrder,
      last_order_date: summary.last_order_date,
    },
    top_products_by_qty: topProductsByQty.map(productStatRow),
    top_products_by_value: topProductsByValue.map(productStatRow),
    recent_orders: recentOrders.map((order) => ({
      order_id: order.order_id,
      created_at: order.created_at,
      total_lines: order.total_lines || 0,
      total_pieces: order.total_pieces || 0,
      total_net_value: asMoney(order.total_net_value),
      average_discount_pct: asMoney(order.average_discount_pct),
    })),
    detailed_orders: detailedOrders,
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: APP_NAME });
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
    const payload = await buildCustomerStats(req.params.code);
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
      console.log(`Database: ${DB_PATH}`);
    });
  })
  .catch((error) => {
    console.error("DB init failed:", error);
    process.exit(1);
  });
