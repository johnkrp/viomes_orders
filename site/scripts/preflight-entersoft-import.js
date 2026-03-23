import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../lib/db/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const importerPath = path.join(__dirname, "..", "..", "backend", "import_entersoft.py");
const backendDir = path.join(__dirname, "..", "..", "backend");
const DEFAULT_SALES_FILES = [path.join(backendDir, "2025.CSV"), path.join(backendDir, "2026.CSV")];
const VALID_IMPORT_MODES = new Set(["incremental", "full_refresh", "replace_sales_year"]);

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

function splitCsvList(raw) {
  return String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function log(message, stream = "stdout") {
  const line = `${message}\n`;
  if (stream === "stderr") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
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
    ENTERSOFT_IMPORT_MODE: cli.mode || process.env.ENTERSOFT_IMPORT_MODE || "incremental",
    ENTERSOFT_REPLACE_SALES_YEAR:
      cli["replace-sales-year"] || process.env.ENTERSOFT_REPLACE_SALES_YEAR,
    ENTERSOFT_SALES_FILES: cli["sales-files"] || process.env.ENTERSOFT_SALES_FILES,
    ENTERSOFT_DAILY_INFO_FILE: cli["daily-info-file"] || process.env.ENTERSOFT_DAILY_INFO_FILE,
    ENTERSOFT_LEDGER_FILE: cli["ledger-file"] || process.env.ENTERSOFT_LEDGER_FILE,
  };
}

function resolveSalesFiles(env, ledgerFile) {
  const explicitSalesFiles = splitCsvList(env.ENTERSOFT_SALES_FILES);
  const explicitDaily = String(env.ENTERSOFT_DAILY_INFO_FILE || "").trim();
  const explicitSalesConfig = Boolean(explicitSalesFiles.length || explicitDaily);

  if (!explicitSalesConfig && ledgerFile) {
    return [];
  }

  if (explicitSalesFiles.length) {
    return explicitSalesFiles;
  }

  if (explicitDaily) {
    return [explicitDaily];
  }

  return DEFAULT_SALES_FILES;
}

function checkPython(executable) {
  const result = spawnSync(executable, ["--version"], { stdio: "pipe", encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  const version = String(result.stdout || result.stderr || "").trim();
  return { executable, version };
}

function checkPymysql(executable) {
  const result = spawnSync(
    executable,
    ["-c", "import pymysql; print(getattr(pymysql, '__version__', 'unknown'))"],
    { stdio: "pipe", encoding: "utf8" },
  );
  return !result.error && result.status === 0;
}

function validateImportMode(env) {
  const mode = String(env.ENTERSOFT_IMPORT_MODE || "incremental").trim().toLowerCase();
  if (!VALID_IMPORT_MODES.has(mode)) {
    throw new Error(
      `Unsupported ENTERSOFT_IMPORT_MODE='${mode}'. Allowed values: ${Array.from(VALID_IMPORT_MODES)
        .sort()
        .join(", ")}`,
    );
  }
  if (mode === "replace_sales_year") {
    const year = Number(String(env.ENTERSOFT_REPLACE_SALES_YEAR || "").trim());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new Error(
        "replace_sales_year requires ENTERSOFT_REPLACE_SALES_YEAR (or --replace-sales-year) between 2000 and 2100.",
      );
    }
  }
  return mode;
}

async function summarizeCsv(filePath) {
  let lineCount = 0;
  let header = "";
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      lineCount += 1;
      if (!header) header = trimmed;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  const stats = statSync(filePath);
  const delimiter = header.includes(";") ? ";" : header.includes(",") ? "," : "unknown";
  return {
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    lineCount,
    approxDataRows: Math.max(lineCount - 1, 0),
    delimiter,
  };
}

async function checkDb(env) {
  const db = await openDatabase({ env });
  try {
    await db.get("SELECT 1 AS ok");
    const requiredTables = [
      "import_runs",
      "imported_sales_lines",
      "imported_customers",
      "imported_orders",
      "imported_monthly_sales",
      "imported_product_sales",
      "imported_customer_ledgers",
      "imported_customer_ledger_lines",
    ];

    const placeholders = requiredTables.map(() => "?").join(",");
    const rows = await db.all(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name IN (${placeholders})
      `,
      [env.MYSQL_DATABASE, ...requiredTables],
    );

    const existing = new Set(rows.map((row) => String(row.table_name || "").trim()));
    const missing = requiredTables.filter((name) => !existing.has(name));

    return { missingTables: missing };
  } finally {
    await db.close();
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const env = buildEnv(cli);
  const errors = [];
  const warnings = [];

  log("[preflight] Entersoft import preflight checks");
  log(`[preflight] importer path: ${importerPath}`);

  if (cli["mysql-password"] !== undefined) {
    warnings.push(
      "Ignoring --mysql-password CLI override. Keep MYSQL_PASSWORD in environment variables.",
    );
  }

  if (!existsSync(importerPath)) {
    errors.push(`Importer not found: ${importerPath}`);
  }

  const required = ["MYSQL_DATABASE", "MYSQL_USER"];
  const missingRequired = required.filter((key) => !String(env[key] || "").trim());
  if (missingRequired.length) {
    errors.push(
      `Missing required environment variables: ${missingRequired.join(", ")}. Provide --mysql-* args or env vars.`,
    );
  }

  if (!String(env.MYSQL_PASSWORD || "").trim()) {
    warnings.push("MYSQL_PASSWORD is empty. This is valid only if your MySQL user has no password.");
  }

  let mode = "incremental";
  try {
    mode = validateImportMode(env);
  } catch (error) {
    errors.push(error.message || String(error));
  }

  const ledgerFile = String(env.ENTERSOFT_LEDGER_FILE || "").trim();
  const salesFiles = resolveSalesFiles(env, ledgerFile);

  if (!salesFiles.length && !ledgerFile) {
    errors.push(
      "No import input configured. Set --sales-files, --daily-info-file, or --ledger-file (or corresponding env vars).",
    );
  }

  if (ledgerFile && !existsSync(ledgerFile)) {
    errors.push(`Ledger file not found: ${ledgerFile}`);
  }

  for (const filePath of salesFiles) {
    if (!existsSync(filePath)) {
      errors.push(`Sales file not found: ${filePath}`);
    }
  }

  const python = checkPython("python3") || checkPython("python");
  if (!python) {
    errors.push("Python interpreter not found (tried python3, python).");
  }

  if (!errors.length && python && !checkPymysql(python.executable)) {
    warnings.push(
      "PyMySQL is not importable in the detected Python environment. Use --python-install-deps=1 during import if needed.",
    );
  }

  if (!errors.length && !missingRequired.length) {
    try {
      const dbResult = await checkDb(env);
      if (dbResult.missingTables.length) {
        warnings.push(
          `DB reachable but some import tables are missing: ${dbResult.missingTables.join(", ")}. ` +
            "The importer can create these during init_schema().",
        );
      }
      log(
        `[preflight] db connection: OK (${env.MYSQL_HOST || "127.0.0.1"}:${env.MYSQL_PORT || 3306}/${env.MYSQL_DATABASE})`,
      );
    } catch (error) {
      errors.push(`DB connection failed: ${error.message || String(error)}`);
    }
  }

  log(`[preflight] mode: ${mode}`);
  if (python) {
    log(`[preflight] python: ${python.executable} (${python.version})`);
  }

  if (salesFiles.length) {
    log(`[preflight] sales files (${salesFiles.length})`);
    for (const filePath of salesFiles) {
      if (!existsSync(filePath)) continue;
      const summary = await summarizeCsv(filePath);
      log(
        `[preflight]   ${filePath} rows≈${summary.approxDataRows} delimiter=${summary.delimiter} size=${summary.sizeBytes}B mtime=${summary.modifiedAt}`,
      );
    }
  }

  if (ledgerFile && existsSync(ledgerFile)) {
    const summary = await summarizeCsv(ledgerFile);
    log(
      `[preflight] ledger file ${ledgerFile} rows≈${summary.approxDataRows} delimiter=${summary.delimiter} size=${summary.sizeBytes}B mtime=${summary.modifiedAt}`,
    );
  }

  for (const warning of warnings) {
    log(`[preflight] warning: ${warning}`, "stderr");
  }

  if (errors.length) {
    for (const error of errors) {
      log(`[preflight] error: ${error}`, "stderr");
    }
    log("[preflight] FAILED", "stderr");
    process.exit(1);
  }

  log("[preflight] OK");
}

main().catch((error) => {
  log(`[preflight] failed: ${error.message || String(error)}`, "stderr");
  process.exit(1);
});
