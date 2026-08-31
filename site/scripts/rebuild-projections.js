// Recompute every imported-sales projection table (imported_orders,
// imported_open_orders, imported_monthly_sales, imported_product_sales,
// imported_customers, imported_customer_branches, customers[source=entersoft_import])
// from the raw imported_sales_lines fact table, in one transaction.
//
// Use this after the raw table has been edited without a full Entersoft import —
// e.g. to pick up the qty_base->qty fallback on the back-catalogue without waiting
// for the next import. A normal `npm run import:entersoft` does the same rebuild on
// the Python side; this is the standalone Node equivalent (same code path dedupe uses).

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { openDatabase } from "../lib/db/client.js";
import { rebuildImportedSalesData } from "../lib/imported-sales.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.join(__dirname, "..", ".env"),
  override: false,
  quiet: true,
});

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

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const env = buildEnv(cli);
  const missing = ["MYSQL_DATABASE", "MYSQL_USER"].filter(
    (key) => !String(env[key] || "").trim(),
  );
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Set them in site/.env, export them, or pass non-secret --mysql-* args. " +
        "MYSQL_PASSWORD must come from the environment.",
    );
  }

  const db = await openDatabase({ env });

  try {
    try {
      await db.run("SET SESSION max_statement_time = 0");
    } catch (error) {
      console.log(
        `[rebuild-projections] could not disable max_statement_time: ${
          error.message || String(error)
        }`,
      );
    }

    const before = await db.get(
      "SELECT " +
        "(SELECT COUNT(*) FROM imported_orders) AS orders, " +
        "(SELECT COUNT(*) FROM imported_open_orders) AS open_orders, " +
        "(SELECT COUNT(*) FROM imported_product_sales) AS product_sales",
    );
    console.log(
      `[rebuild-projections] before: orders=${before.orders} open_orders=${before.open_orders} product_sales=${before.product_sales}`,
    );

    await db.run("START TRANSACTION");
    await rebuildImportedSalesData(db);
    await db.run("COMMIT");

    const after = await db.get(
      "SELECT " +
        "(SELECT COUNT(*) FROM imported_orders) AS orders, " +
        "(SELECT COUNT(*) FROM imported_open_orders) AS open_orders, " +
        "(SELECT COUNT(*) FROM imported_product_sales) AS product_sales",
    );
    console.log(
      `[rebuild-projections] after:  orders=${after.orders} open_orders=${after.open_orders} product_sales=${after.product_sales}`,
    );
    console.log("[rebuild-projections] done");
  } catch (error) {
    try {
      await db.run("ROLLBACK");
    } catch {
      // best effort
    }
    throw error;
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
