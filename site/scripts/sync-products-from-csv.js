// Sync the MySQL `products` table from an ES1 item export (products.csv).
//
// This is step 1 of the order-catalog pipeline:
//
//   exports/products.csv  ->  [sync-products-from-csv.js]  ->  products table
//                         ->  [generate-catalog-from-db.js] ->  public/catalog.json
//
// The order-form server validates order quantities and pack sizes against the
// `products` table, and catalog.json is regenerated from that same table, so the
// table — not the JSON — is the thing that has to track ES1. You drop a fresh
// `exports/products.csv` (tab-separated ES1 export) and run this; it upserts every
// order-channel item and flags the rest as not orderable.
//
// Membership rule (matches project memory orders-catalog-flag5-flag6-reconcile):
//   - keep    Χ5-orders = 1
//   - drop    X6-Private Label = 1                 (private label, own customer coding)
//   - drop    "mixed content" movement-control SKUs (hold no stock of their own)
//
// What comes from the CSV:  code, description, color, pieces_per_package, membership.
// What does NOT (ES1 export has no such column):
//   - volume_liters : preserved from the existing row by code; 0 + logged for new codes.
//   - image_url     : computed from code, https://viomes.gr/images/packshot_photos/
//                     viomes_<code with "." "/" "+" -> "_">.jpg  (same convention
//                     as the products-grouped pipeline and viomes_db/catalog.json;
//                     the packshot files on viomes.gr are named that way — a bare
//                     "/" -> "_" leaves "+"/"." codes 404ing).
//
// Rows are never deleted (order_lines.product_id -> products.id). A de-flagged item
// gets orderable = 0 and generate-catalog-from-db.js filters it out.
//
// Safety: before any write it dumps the current products table and a rollback .sql
// to site/logs/catalog-sync/, and always writes catalog-sync-anomalies.json.
// Use --dry-run to produce the backup + anomaly report without touching the DB.
//
// Usage (from site/, production DB):
//   MYSQL_PASSWORD='...' node scripts/sync-products-from-csv.js \
//     --input=D:/Desktop/programming/viomes/viomes_db/exports/products.csv \
//     --mysql-host=213.158.90.203 --mysql-port=3306 \
//     --mysql-database=admin_viomes_orders --mysql-user=admin_viomes_app
//   # add --dry-run first and review site/logs/catalog-sync/

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { openDatabase } from "../lib/db/client.js";
import { initDatabaseSchema } from "../lib/db/init-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// override: true — match server.js / rebuild-projections.js. site/.env is the source
// of truth for the DB connection; stale shell MYSQL_* vars must not win.
dotenv.config({
  path: path.join(__dirname, "..", ".env"),
  override: true,
  quiet: true,
});

const DEFAULT_CSV_INPUT =
  "D:/Desktop/programming/viomes/viomes_db/exports/products.csv";
const LOG_DIR = path.join(__dirname, "..", "logs", "catalog-sync");
const PACKSHOT_BASE = "https://viomes.gr/images/packshot_photos/";

// ES1 column headers this script reads. The export is tab-separated with a BOM and
// quoted headers; `Ανενεργό` is deliberately NOT required — it is ignored on
// purpose, same as generate-catalog-from-products-csv.js.
const REQUIRED_COLUMNS = [
  "Κωδ.Είδους",
  "Περιγραφή",
  "Χρώμα",
  "Υποσυσκευασία",
  "Συσκευασία",
  "Σχέδιο ελέγχου διακίνησης",
  "Χ5-orders",
  "X6-Private Label",
];

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [rawKey, ...rest] = token.slice(2).split("=");
    const key = rawKey.trim();
    if (key) args[key] = rest.join("=").trim() || "true";
  }
  return args;
}

function buildEnv(cli) {
  return {
    ...process.env,
    DB_CLIENT: process.env.DB_CLIENT || "mysql",
    MYSQL_HOST: cli["mysql-host"] || process.env.MYSQL_HOST,
    MYSQL_PORT: cli["mysql-port"] || process.env.MYSQL_PORT,
    MYSQL_DATABASE: cli["mysql-database"] || process.env.MYSQL_DATABASE,
    MYSQL_USER: cli["mysql-user"] || process.env.MYSQL_USER,
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
  };
}

// trim -> lower -> NFD -> strip combining marks. Same recipe as backend norm_gr()
// so description_norm / color_norm stay consistent with rows written by the
// Entersoft importer.
function normGr(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "");
}

// Accent- and case-insensitive contains, for matching Greek label text whose exact
// punctuation/spelling in the export is not guaranteed stable.
function normContains(haystack, needle) {
  return normGr(haystack).includes(normGr(needle));
}

function parseCsvNumber(value) {
  return parseFloat(String(value || "0").replace(",", "."));
}

function imageUrlForCode(code) {
  return `${PACKSHOT_BASE}viomes_${code.replace(/[./+]/g, "_")}.jpg`;
}

function parseProductsCsv(csvPath) {
  const text = readFileSync(csvPath).toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (!lines.length) throw new Error(`CSV is empty: ${csvPath}`);

  const header = lines[0].split("\t").map((s) => s.replace(/^"|"$/g, ""));
  const idx = (name) => header.indexOf(name);
  const missing = REQUIRED_COLUMNS.filter((name) => idx(name) === -1);
  if (missing.length) {
    throw new Error(
      `CSV is missing required column(s): ${missing.join(", ")}.\n` +
        `Found columns: ${header.join(" | ")}`,
    );
  }

  const col = {
    code: idx("Κωδ.Είδους"),
    description: idx("Περιγραφή"),
    color: idx("Χρώμα"),
    hypo: idx("Υποσυσκευασία"),
    susk: idx("Συσκευασία"),
    controlPlan: idx("Σχέδιο ελέγχου διακίνησης"),
    ordersChannel: idx("Χ5-orders"),
    privateLabel: idx("X6-Private Label"),
  };

  const rows = new Map();
  let duplicateCodeRows = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split("\t").map((s) => s.replace(/^"|"$/g, ""));
    const code = (cells[col.code] || "").trim();
    if (!code) continue;
    // ES1 sometimes repeats a code across rows; first occurrence wins.
    if (rows.has(code)) {
      duplicateCodeRows += 1;
      continue;
    }
    rows.set(code, {
      code,
      description: (cells[col.description] || "").trim(),
      color: (cells[col.color] || "").trim(),
      hypo: parseCsvNumber(cells[col.hypo]),
      susk: parseCsvNumber(cells[col.susk]),
      controlPlan: (cells[col.controlPlan] || "").trim(),
      isOrderChannel: (cells[col.ordersChannel] || "").trim() === "1",
      isPrivateLabel: (cells[col.privateLabel] || "").trim() === "1",
    });
  }
  return { rows, duplicateCodeRows };
}

// Υποσυσκευασία is an inner-pack override ES1 leaves at 0 for most products;
// Συσκευασία is the standard pack size. When ES1 gives no signal at all, keep
// whatever the existing row has rather than collapsing to 1 (validated at 97.8%
// agreement against the pre-drift catalog).
function resolvePackSize(row, existing) {
  const raw = row.hypo !== 0 ? row.hypo : row.susk;
  if (raw > 0) return { pack: Math.round(raw), fallback: false };
  const existingPack = Number(existing?.pieces_per_package);
  if (existingPack > 0) return { pack: existingPack, fallback: "existing" };
  return { pack: 1, fallback: "default-1" };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sqlStr(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const csvPath = path.resolve(cli.input || DEFAULT_CSV_INPUT);
  const dryRun = cli["dry-run"] === "true";
  const force = cli.force === "true";
  const logDir = path.resolve(cli["log-dir"] || LOG_DIR);
  const env = buildEnv(cli);

  const missingEnv = ["MYSQL_DATABASE", "MYSQL_USER"].filter(
    (key) => !String(env[key] || "").trim(),
  );
  if (missingEnv.length) {
    throw new Error(
      `Missing required environment variables: ${missingEnv.join(", ")}. ` +
        "Set them in site/.env, export them, or pass non-secret --mysql-* args. " +
        "MYSQL_PASSWORD must come from the environment.",
    );
  }

  mkdirSync(logDir, { recursive: true });
  const ts = timestamp();

  console.log(`[sync-catalog] reading ${csvPath}`);
  const { rows: csvRows, duplicateCodeRows } = parseProductsCsv(csvPath);
  console.log(
    `[sync-catalog] ${csvRows.size} unique codes in CSV` +
      (duplicateCodeRows ? ` (${duplicateCodeRows} duplicate-code rows ignored)` : ""),
  );

  const db = await openDatabase({ env });
  console.log(`[sync-catalog] db: ${db.description}`);

  try {
    await initDatabaseSchema({ db, kind: db.kind });

    const existingRows = await db.all(
      `SELECT id, code, description, image_url, pieces_per_package,
              volume_liters, color, description_norm, color_norm, orderable
       FROM products`,
    );
    const existingByCode = new Map(existingRows.map((r) => [r.code, r]));
    console.log(`[sync-catalog] ${existingRows.length} rows currently in products`);

    // --- classify every CSV row -------------------------------------------------
    const anomalies = {
      generated_at: new Date().toISOString(),
      source_csv: csvPath,
      dry_run: dryRun,
      summary: {},
      new_codes_zero_volume: [],
      pack_fallback: [],
      mixed_content_skipped: [],
      deflagged: [],
      reflagged: [],
    };

    const desired = new Map(); // code -> full row to upsert (orderable = 1)
    let privateLabelSkipped = 0;

    for (const [code, row] of csvRows) {
      if (!row.isOrderChannel) continue;
      if (row.isPrivateLabel) {
        privateLabelSkipped += 1;
        continue;
      }
      if (normContains(row.controlPlan, "μεικτ")) {
        // "Ενεργά είδη (περιεχόμενου μεικτού)" — catalog-only SKU, no stock of its
        // own. Log every hit so a wording drift in the export is visible.
        anomalies.mixed_content_skipped.push({ code, control_plan: row.controlPlan });
        continue;
      }

      const existing = existingByCode.get(code);
      const { pack, fallback } = resolvePackSize(row, existing);
      if (fallback) anomalies.pack_fallback.push({ code, used: pack, via: fallback });

      let volume = 0;
      if (existing) {
        volume = Number(existing.volume_liters) || 0;
      } else {
        anomalies.new_codes_zero_volume.push(code);
      }

      const description = row.description;
      const color = row.color || "N/A";
      desired.set(code, {
        code,
        description,
        image_url: imageUrlForCode(code),
        pieces_per_package: pack,
        volume_liters: volume,
        color,
        description_norm: normGr(description),
        color_norm: normGr(color),
      });

      if (existing && Number(existing.orderable) !== 1) {
        anomalies.reflagged.push(code);
      }
    }

    // codes currently orderable that the CSV no longer keeps -> orderable = 0
    const toDeflag = existingRows
      .filter((r) => Number(r.orderable) === 1 && !desired.has(r.code))
      .map((r) => r.code);
    anomalies.deflagged = [...toDeflag];

    const newCodes = [...desired.keys()].filter((c) => !existingByCode.has(c));

    anomalies.summary = {
      csv_unique_codes: csvRows.size,
      order_channel_kept: desired.size,
      private_label_skipped: privateLabelSkipped,
      mixed_content_skipped: anomalies.mixed_content_skipped.length,
      inserts: newCodes.length,
      updates: desired.size - newCodes.length,
      deflagged_to_zero: toDeflag.length,
      reflagged_to_one: anomalies.reflagged.length,
      pack_fallbacks: anomalies.pack_fallback.length,
      new_codes_zero_volume: anomalies.new_codes_zero_volume.length,
    };

    // --- backup + rollback (always, even on dry run) ---------------------------
    const backupPath = path.join(logDir, `products-backup-${ts}.json`);
    writeFileSync(
      backupPath,
      JSON.stringify({ generated_at: anomalies.generated_at, rows: existingRows }, null, 2),
      "utf8",
    );

    const rollbackPath = path.join(logDir, `rollback-${ts}.sql`);
    const rollbackLines = [
      `-- Rollback for sync-products-from-csv.js run at ${anomalies.generated_at}`,
      `-- Restores every pre-existing products row and removes rows this run inserts.`,
      `-- Safe to run: inserted codes are new and cannot yet be referenced by order_lines.`,
      "START TRANSACTION;",
    ];
    for (const r of existingRows) {
      rollbackLines.push(
        `UPDATE products SET ` +
          `description=${sqlStr(r.description)}, ` +
          `image_url=${sqlStr(r.image_url)}, ` +
          `pieces_per_package=${Number(r.pieces_per_package) || 0}, ` +
          `volume_liters=${Number(r.volume_liters) || 0}, ` +
          `color=${sqlStr(r.color)}, ` +
          `description_norm=${sqlStr(r.description_norm)}, ` +
          `color_norm=${sqlStr(r.color_norm)}, ` +
          `orderable=${Number(r.orderable) === 1 ? 1 : 0} ` +
          `WHERE code=${sqlStr(r.code)};`,
      );
    }
    for (const code of newCodes) {
      rollbackLines.push(`DELETE FROM products WHERE code=${sqlStr(code)};`);
    }
    rollbackLines.push("COMMIT;", "");
    writeFileSync(rollbackPath, rollbackLines.join("\n"), "utf8");

    const anomaliesPath = path.join(logDir, "catalog-sync-anomalies.json");
    writeFileSync(anomaliesPath, JSON.stringify(anomalies, null, 2), "utf8");
    writeFileSync(
      path.join(logDir, `catalog-sync-anomalies-${ts}.json`),
      JSON.stringify(anomalies, null, 2),
      "utf8",
    );

    console.log("[sync-catalog] plan:", JSON.stringify(anomalies.summary, null, 2));
    console.log(`[sync-catalog] backup:   ${backupPath}`);
    console.log(`[sync-catalog] rollback: ${rollbackPath}`);
    console.log(`[sync-catalog] anomalies: ${anomaliesPath}`);

    if (toDeflag.length > 200 && !force) {
      throw new Error(
        `Refusing to run: ${toDeflag.length} codes would be flagged not-orderable ` +
          `in one pass. That usually means a truncated or wrong CSV. Review the ` +
          `anomaly report; re-run with --force to override.`,
      );
    }

    if (dryRun) {
      console.log("[sync-catalog] dry run — no changes written.");
      return;
    }

    // --- apply ---------------------------------------------------------------
    await db.run("START TRANSACTION");
    try {
      let written = 0;
      for (const row of desired.values()) {
        await db.run(
          `INSERT INTO products
             (code, description, image_url, pieces_per_package, volume_liters,
              color, description_norm, color_norm, orderable)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             description = VALUES(description),
             image_url = VALUES(image_url),
             pieces_per_package = VALUES(pieces_per_package),
             volume_liters = VALUES(volume_liters),
             color = VALUES(color),
             description_norm = VALUES(description_norm),
             color_norm = VALUES(color_norm),
             orderable = 1`,
          [
            row.code,
            row.description,
            row.image_url,
            row.pieces_per_package,
            row.volume_liters,
            row.color,
            row.description_norm,
            row.color_norm,
          ],
        );
        written += 1;
      }

      let deflagged = 0;
      for (let i = 0; i < toDeflag.length; i += 500) {
        const chunk = toDeflag.slice(i, i + 500);
        const placeholders = chunk.map(() => "?").join(",");
        const res = await db.run(
          `UPDATE products SET orderable = 0 WHERE code IN (${placeholders})`,
          chunk,
        );
        deflagged += Number(res.changes || 0);
      }

      await db.run("COMMIT");
      console.log(
        `[sync-catalog] committed: ${written} upserted, ${deflagged} flagged not-orderable.`,
      );
    } catch (error) {
      try {
        await db.run("ROLLBACK");
      } catch {
        // best effort
      }
      throw error;
    }

    const check = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM products) AS total,
         (SELECT COUNT(*) FROM products WHERE orderable = 1) AS orderable`,
    );
    console.log(
      `[sync-catalog] products now: ${check.total} total, ${check.orderable} orderable.`,
    );
    console.log(
      "[sync-catalog] next: npm run generate:catalog  (then review + upload public/catalog.json)",
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`[sync-catalog] failed: ${error.message || String(error)}`);
  process.exitCode = 1;
});
