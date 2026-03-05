import path from "node:path";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "node:url";
import { open } from "sqlite";
import { openDatabase } from "../lib/db/client.js";
import { initDatabaseSchema } from "../lib/db/init-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultSqlitePath = path.join(__dirname, "..", "..", "backend", "app.db");

const TABLES = [
  "products",
  "orders",
  "order_lines",
  "customers",
  "customer_receivables",
  "imported_customers",
  "imported_sales_lines",
  "imported_orders",
  "imported_monthly_sales",
  "imported_product_sales",
  "import_runs",
  "admin_users",
  "admin_sessions",
];

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

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replaceAll("`", "``")}\``;
}

async function insertRows(targetDb, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `
    INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
    VALUES (${placeholders})
  `;

  for (const row of rows) {
    const values = columns.map((column) => row[column]);
    await targetDb.run(sql, values);
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const sqlitePath = cli["source-sqlite-path"] || process.env.SOURCE_SQLITE_PATH || defaultSqlitePath;
  const effectiveEnv = {
    ...process.env,
    DB_CLIENT: cli.target || process.env.DB_CLIENT,
    MYSQL_HOST: cli["mysql-host"] || process.env.MYSQL_HOST,
    MYSQL_PORT: cli["mysql-port"] || process.env.MYSQL_PORT,
    MYSQL_DATABASE: cli["mysql-database"] || process.env.MYSQL_DATABASE,
    MYSQL_USER: cli["mysql-user"] || process.env.MYSQL_USER,
    MYSQL_PASSWORD: cli["mysql-password"] || process.env.MYSQL_PASSWORD,
  };

  const sourceDb = await open({ filename: sqlitePath, driver: sqlite3.Database });
  const targetDb = await openDatabase({ env: effectiveEnv, sqlitePath });

  if (targetDb.kind !== "mysql") {
    throw new Error(
      "This migration script requires MySQL target. Use DB_CLIENT=mysql or pass --target=mysql.",
    );
  }

  try {
    await initDatabaseSchema({ db: targetDb, kind: targetDb.kind });
    await targetDb.run("SET FOREIGN_KEY_CHECKS = 0");

    for (const table of [...TABLES].reverse()) {
      await targetDb.run(`DELETE FROM ${quoteIdentifier(table)}`);
    }

    for (const table of TABLES) {
      const rows = await sourceDb.all(`SELECT * FROM ${table}`);
      await insertRows(targetDb, table, rows);
      console.log(`Migrated ${table}: ${rows.length}`);
    }

    await targetDb.run("SET FOREIGN_KEY_CHECKS = 1");
    console.log("SQLite -> MySQL migration completed.");
  } finally {
    try {
      await targetDb.run("SET FOREIGN_KEY_CHECKS = 1");
    } catch {
      // Ignore cleanup errors.
    }
    await sourceDb.close();
    await targetDb.close();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
