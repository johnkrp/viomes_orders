import { openDatabase } from "../lib/db/client.js";
import {
  DUPLICATE_SAMPLE_SQL,
  getImportedSalesProjectionHealth,
} from "../lib/imported-sales.js";

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
    MYSQL_PASSWORD: cli["mysql-password"] || process.env.MYSQL_PASSWORD,
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const env = buildEnv(cli);

  const required = ["MYSQL_DATABASE", "MYSQL_USER"];
  const missing = required.filter((key) => !String(env[key] || "").trim());
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Provide --mysql-* args or set env vars.",
    );
  }

  const db = await openDatabase({ env });

  try {
    const counts = {
      imported_sales_lines: Number((await db.get("SELECT COUNT(*) AS n FROM imported_sales_lines"))?.n || 0),
      imported_orders: Number((await db.get("SELECT COUNT(*) AS n FROM imported_orders"))?.n || 0),
      imported_monthly_sales: Number(
        (await db.get("SELECT COUNT(*) AS n FROM imported_monthly_sales"))?.n || 0,
      ),
      imported_product_sales: Number(
        (await db.get("SELECT COUNT(*) AS n FROM imported_product_sales"))?.n || 0,
      ),
      imported_customers: Number((await db.get("SELECT COUNT(*) AS n FROM imported_customers"))?.n || 0),
      mirrored_customers: Number(
        (await db.get("SELECT COUNT(*) AS n FROM customers WHERE source = 'entersoft_import'"))?.n || 0
      ),
    };

    const health = await getImportedSalesProjectionHealth(db);
    const duplicateSamples = await db.all(DUPLICATE_SAMPLE_SQL);

    console.log("[check] row counts");
    for (const [name, value] of Object.entries(counts)) {
      console.log(`[check] ${name}=${value}`);
    }

    console.log("[check] architecture");
    console.log(`[check] raw_fact_table=${health.architecture.rawFactTable}`);
    console.log(`[check] projection_strategy=${health.architecture.projectionStrategy}`);

    console.log("[check] invariants");
    for (const [name, value] of Object.entries(health.invariants)) {
      console.log(`[check] ${name}=${value}`);
    }

    if (duplicateSamples.length) {
      console.log("[check] duplicate samples");
      for (const row of duplicateSamples) {
        console.log(
          `[check] order_date=${row.order_date} document_no=${row.document_no} ` +
            `customer_code=${row.customer_code} item_code=${row.item_code} copies=${row.copies} ` +
            `files=${row.files}`,
        );
      }
    }

    if (health.latest_import_run) {
      const run = health.latest_import_run;
      console.log("[check] latest import run");
      console.log(
        `[check] id=${run.id} mode=${run.import_mode} status=${run.status} source_row_count=${run.source_row_count} ` +
          `rows_upserted=${run.rows_upserted} rows_skipped_duplicate=${run.rows_skipped_duplicate} ` +
          `rows_rejected=${run.rows_rejected} trigger_source=${run.trigger_source}`,
      );
    }

    if (!health.ok) {
      console.error("[check] FAILED import integrity checks");
      process.exit(1);
    }

    console.log("[check] OK import integrity checks passed");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("[check] failed:", error.message || String(error));
  process.exit(1);
});
