import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../lib/db/client.js";
import {
  DUPLICATE_SAMPLE_SQL,
  getImportedSalesProjectionHealth,
} from "../lib/imported-sales.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = process.env.ENTERSOFT_IMPORT_LOG_DIR || path.join(__dirname, "..", "logs", "imports");

function slugify(value) {
  return String(value || "value")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";
}

function buildLogFilePath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `import-integrity-check-${slugify(process.env.NODE_ENV || "manual")}-${timestamp}.log`;
  return path.join(logDir, filename);
}

mkdirSync(logDir, { recursive: true });
const logFile = process.env.ENTERSOFT_IMPORT_LOG_FILE || buildLogFilePath();

function writeLog(message, stream = "stdout") {
  const line = `${message}\n`;
  if (stream === "stderr") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
  appendFileSync(logFile, line, "utf8");
}

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
  writeLog(`[check] log file: ${logFile}`);

  if (cli["mysql-password"] !== undefined) {
    writeLog(
      "[check] ignoring --mysql-password CLI override. Set MYSQL_PASSWORD in the environment instead.",
      "stderr",
    );
  }

  const required = ["MYSQL_DATABASE", "MYSQL_USER"];
  const missing = required.filter((key) => !String(env[key] || "").trim());
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Provide non-secret --mysql-* args or set env vars. MYSQL_PASSWORD must come from the environment.",
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

    writeLog("[check] row counts");
    for (const [name, value] of Object.entries(counts)) {
      writeLog(`[check] ${name}=${value}`);
    }

    writeLog("[check] architecture");
    writeLog(`[check] raw_fact_table=${health.architecture.rawFactTable}`);
    writeLog(`[check] projection_strategy=${health.architecture.projectionStrategy}`);

    writeLog("[check] invariants");
    for (const [name, value] of Object.entries(health.invariants)) {
      writeLog(`[check] ${name}=${value}`);
    }

    if (duplicateSamples.length) {
      writeLog("[check] duplicate samples");
      for (const row of duplicateSamples) {
        writeLog(
          `[check] order_date=${row.order_date} document_no=${row.document_no} ` +
            `customer_code=${row.customer_code} item_code=${row.item_code} copies=${row.copies} ` +
            `files=${row.files}`,
        );
      }
    }

    if (health.latest_import_run) {
      const run = health.latest_import_run;
      writeLog("[check] latest import run");
      writeLog(
        `[check] id=${run.id} mode=${run.import_mode} status=${run.status} source_row_count=${run.source_row_count} ` +
          `rows_upserted=${run.rows_upserted} rows_skipped_duplicate=${run.rows_skipped_duplicate} ` +
          `rows_rejected=${run.rows_rejected} trigger_source=${run.trigger_source}`,
      );
    }

    if (!health.ok) {
      writeLog("[check] FAILED import integrity checks", "stderr");
      process.exit(1);
    }

    writeLog("[check] OK import integrity checks passed");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  writeLog(`[check] failed: ${error.message || String(error)}`, "stderr");
  process.exit(1);
});
