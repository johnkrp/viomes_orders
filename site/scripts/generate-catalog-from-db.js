import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { openDatabase } from "../lib/db/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultOutput = path.join(__dirname, "..", "public", "catalog.json");

// override: true — match server.js / sync-products-from-csv.js. site/.env is the
// source of truth for the DB connection; stale shell MYSQL_* vars must not win.
dotenv.config({
  path: path.join(__dirname, "..", ".env"),
  override: true,
  quiet: true,
});

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [rawKey, ...rest] = token.slice(2).split("=");
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!key) continue;
    args[key] = value || "true";
  }
  return args;
}

function buildEnv(cli) {
  return {
    ...process.env,
    DB_CLIENT: "mysql",
    MYSQL_HOST: cli["mysql-host"] || process.env.MYSQL_HOST,
    MYSQL_PORT: cli["mysql-port"] || process.env.MYSQL_PORT,
    MYSQL_DATABASE: cli["mysql-database"] || process.env.MYSQL_DATABASE,
    MYSQL_USER: cli["mysql-user"] || process.env.MYSQL_USER,
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const env = buildEnv(cli);
  const outputPath = path.resolve(cli.output || defaultOutput);
  const dryRun = cli["dry-run"] === "true";

  if (cli["mysql-password"] !== undefined) {
    console.error(
      "[catalog] ignoring --mysql-password CLI override. Set MYSQL_PASSWORD in the environment instead.",
    );
  }

  const db = await openDatabase({ env });

  try {
    // Membership is driven by products.orderable (set by sync-products-from-csv.js
    // from ES1's Χ5-orders channel). The column is added by initDatabaseSchema on
    // server boot; guard here so a fresh checkout running this script standalone,
    // before the schema has ever been initialised, still works.
    const colRow = await db.get(
      `SELECT COUNT(*) AS n
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'products'
         AND column_name = 'orderable'`,
    );
    const hasOrderable = Number(colRow?.n || 0) > 0;
    if (!hasOrderable) {
      console.warn(
        "[catalog] products.orderable not found — emitting every product row. " +
          "Run sync-products-from-csv.js (or boot the server once) to add it.",
      );
    }

    const rows = await db.all(
      `SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
       FROM products
       ${hasOrderable ? "WHERE orderable = 1" : ""}
       ORDER BY code`,
    );

    const items = rows.map((row) => ({
      id: Number(row.id),
      code: String(row.code || ""),
      description: String(row.description || ""),
      image_url: String(row.image_url || ""),
      pieces_per_package: Number(row.pieces_per_package) > 0 ? Number(row.pieces_per_package) : 1,
      volume_liters: Number(row.volume_liters) || 0,
      color: String(row.color || ""),
    }));

    console.log(`[catalog] built ${items.length} products from the products table`);
    console.log("[catalog] preview first 2 items:", items.slice(0, 2));

    if (dryRun) {
      console.log("[catalog] dry run complete. Output file was not written.");
      return;
    }

    writeFileSync(outputPath, JSON.stringify({ items }, null, 2), "utf8");
    console.log(`[catalog] wrote catalog JSON to: ${outputPath}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(`[catalog] failed: ${error.message || String(error)}`);
  process.exit(1);
});
