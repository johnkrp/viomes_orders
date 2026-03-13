import { mkdirSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const importerPath = path.join(__dirname, "..", "..", "backend", "import_entersoft.py");

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

const cli = parseArgs(process.argv.slice(2));
const requestedMode = cli.mode || process.env.ENTERSOFT_IMPORT_MODE || "incremental";
const hasExplicitSalesFiles = Boolean(
  String(cli["sales-files"] || process.env.ENTERSOFT_SALES_FILES || "").trim(),
);
const defaultTimeoutSeconds = hasExplicitSalesFiles || requestedMode === "full_refresh" ? 10800 : 1800;
const timeoutSeconds = Math.max(
  Number(
    process.env.ENTERSOFT_IMPORT_TIMEOUT_SECONDS ||
      process.env.IMPORT_TIMEOUT_SECONDS ||
      defaultTimeoutSeconds,
  ),
  30,
);
const timeoutMs = timeoutSeconds * 1000;
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
  const filename = `entersoft-import-${slugify(requestedMode)}-${timestamp}.log`;
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

function writeCapturedOutput(output, stream = "stdout") {
  const text = output?.toString?.() || "";
  if (!text) return;
  if (stream === "stderr") {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }
  appendFileSync(logFile, text, "utf8");
}

const effectiveEnv = {
  ...process.env,
  MYSQL_HOST: cli["mysql-host"] || process.env.MYSQL_HOST,
  MYSQL_PORT: cli["mysql-port"] || process.env.MYSQL_PORT,
  MYSQL_DATABASE: cli["mysql-database"] || process.env.MYSQL_DATABASE,
  MYSQL_USER: cli["mysql-user"] || process.env.MYSQL_USER,
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
  ENTERSOFT_IMPORT_MODE: requestedMode,
  ENTERSOFT_SALES_FILES: cli["sales-files"] || process.env.ENTERSOFT_SALES_FILES,
  ENTERSOFT_DAILY_INFO_FILE: cli["daily-info-file"] || process.env.ENTERSOFT_DAILY_INFO_FILE,
  ENTERSOFT_LEDGER_FILE: cli["ledger-file"] || process.env.ENTERSOFT_LEDGER_FILE,
  IMPORT_TRIGGER_SOURCE: cli["trigger-source"] || process.env.IMPORT_TRIGGER_SOURCE,
  ENTERSOFT_IMPORT_LOG_FILE: logFile,
};

if (cli["mysql-password"] !== undefined) {
  writeLog(
    "[import] ignoring --mysql-password CLI override. Set MYSQL_PASSWORD in the environment instead.",
    "stderr",
  );
}

const requiredEnv = ["MYSQL_DATABASE", "MYSQL_USER"];
const missing = requiredEnv.filter((key) => !String(effectiveEnv[key] || "").trim());
if (missing.length) {
  writeLog(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      "Set MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD in the environment.",
    "stderr",
  );
  process.exit(1);
}

function runPython(executable) {
  writeLog(`[import] log file: ${logFile}`);
  writeLog(`[import] mode=${requestedMode} default_timeout=${defaultTimeoutSeconds}s`);
  writeLog(`[import] launching ${executable} with timeout=${timeoutSeconds}s`);
  return spawnSync(executable, ["-u", importerPath], {
    stdio: "pipe",
    env: effectiveEnv,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
}

function installDeps(executable) {
  writeLog(`[import] installing PyMySQL with ${executable} -m pip install --user PyMySQL`);
  return spawnSync(executable, ["-m", "pip", "install", "--user", "PyMySQL"], {
    stdio: "pipe",
    env: effectiveEnv,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
}

const attempts = ["python3", "python"];
let lastError = null;

for (const exe of attempts) {
  if (cli["python-install-deps"] === "1" || cli["install-pymysql"] === "1") {
    const depResult = installDeps(exe);
    writeCapturedOutput(depResult.stdout, "stdout");
    writeCapturedOutput(depResult.stderr, "stderr");
    if (depResult.error?.code === "ETIMEDOUT") {
      writeLog(
        `[import] dependency install timed out after ${timeoutSeconds}s and was terminated.`,
        "stderr",
      );
      process.exit(124);
    }
    if (!depResult.error && typeof depResult.status === "number" && depResult.status !== 0) {
      process.exit(depResult.status);
    }
  }

  const result = runPython(exe);
  writeCapturedOutput(result.stdout, "stdout");
  writeCapturedOutput(result.stderr, "stderr");
  if (!result.error && result.status === 0) {
    writeLog("[import] importer completed successfully");
    process.exit(0);
  }
  if (result.error?.code === "ETIMEDOUT") {
    writeLog(
      `[import] timed out after ${timeoutSeconds}s and was terminated. ` +
        "Increase ENTERSOFT_IMPORT_TIMEOUT_SECONDS if needed.",
      "stderr",
    );
    process.exit(124);
  }
  if (!result.error && typeof result.status === "number") {
    process.exit(result.status);
  }
  lastError = result.error;
}

writeLog(`Failed to run importer with python3/python: ${lastError?.message || "unknown error"}`, "stderr");
process.exit(1);
