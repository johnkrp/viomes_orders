import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// static
const publicDir = path.join(__dirname, "..");
app.use(express.static(publicDir));
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

// ---- norm function (ΛΕΙΠΕΙ ΑΠΟ ΤΟ server.js) ----
function normGr(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ---- DB ----
const DB_PATH = path.join(__dirname, "data", "products.db");
let db;

async function initDb() {
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec(`
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
  `);
}

// ---- API ----
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/catalog", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const page_size = Math.min(Math.max(parseInt(req.query.page_size || "10", 10), 1), 200);

    const qRaw = (req.query.q || "").toString().trim();
    const qNorm = normGr(qRaw);
    const offset = (page - 1) * page_size;

    let total, rows;

    if (qRaw) {
      const needleRaw = `%${qRaw.toLowerCase()}%`;   // για code/description/color (raw)
      const needleNorm = `%${qNorm}%`;              // για norm columns

      total = (await db.get(
        `SELECT COUNT(*) AS n FROM products
         WHERE lower(code) LIKE ?
            OR lower(description) LIKE ?
            OR lower(color) LIKE ?
            OR description_norm LIKE ?
            OR color_norm LIKE ?`,
        [needleRaw, needleRaw, needleRaw, needleNorm, needleNorm]
      )).n;

      rows = await db.all(
        `SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
         FROM products
         WHERE lower(code) LIKE ?
            OR lower(description) LIKE ?
            OR lower(color) LIKE ?
            OR description_norm LIKE ?
            OR color_norm LIKE ?
         ORDER BY code
         LIMIT ? OFFSET ?`,
        [needleRaw, needleRaw, needleRaw, needleNorm, needleNorm, page_size, offset]
      );
    } else {
      total = (await db.get(`SELECT COUNT(*) AS n FROM products`)).n;
      rows = await db.all(
        `SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
         FROM products
         ORDER BY code
         LIMIT ? OFFSET ?`,
        [page_size, offset]
      );
    }

    const pages = total ? Math.ceil(total / page_size) : 1;
    res.json({ items: rows, page, page_size, total, pages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

import ExcelJS from "exceljs";

app.post("/api/order/export-xlsx", async (req, res) => {
  try {
    const { customerName, customerEmail, comment, items } = req.body;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Order");

    ws.columns = [
      { header: "Κωδικός", key: "code", width: 15 },
      { header: "Περιγραφή", key: "description", width: 45 },
      { header: "Χρώμα", key: "color", width: 18 },
      { header: "Συσκευασίες", key: "packs", width: 12 },
      { header: "Τεμάχια", key: "qty", width: 10 },
      { header: "Όγκος (L)", key: "vol", width: 10 },
    ];

    // Header info
    ws.insertRows(1, [
      ["Πελάτης:", customerName || ""],
      ["Email:", customerEmail || ""],
      ["Σχόλια:", comment || ""],
      [],
    ]);

    // Πήδα 4 γραμμές και βάλε τα headers
    ws.spliceRows(5, 0, ws.columns.map(c => c.header));
    ws.getRow(5).font = { bold: true };

    // Items
    (items || []).forEach((it) => {
      ws.addRow({
        code: it.code,
        description: it.description,
        color: it.color,
        packs: it.packs ?? "",
        qty: it.qty,
        vol: it.volume_liters ?? 0,
      });
    });

    const buffer = await wb.xlsx.writeBuffer();

    const filename = `order_${Date.now()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3001;

initDb()
  .then(() => app.listen(PORT, () => console.log(`API listening on :${PORT}`)))
  .catch((e) => {
    console.error("DB init failed:", e);
    process.exit(1);
  });
/*
  Legacy / frozen file.
  The active backend for this project is now FastAPI under ../backend.
  Keep this file only as historical reference; do not add new features here.
*/
