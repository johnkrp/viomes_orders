import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const importerPath = path.join(__dirname, "..", "..", "backend", "import_entersoft.py");
const timeoutSeconds = Math.max(
  Number(process.env.ENTERSOFT_IMPORT_TIMEOUT_SECONDS || process.env.IMPORT_TIMEOUT_SECONDS || 1800),
  30,
);
const timeoutMs = timeoutSeconds * 1000;

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
const effectiveEnv = {
  ...process.env,
  MYSQL_HOST: cli["mysql-host"] || process.env.MYSQL_HOST,
  MYSQL_PORT: cli["mysql-port"] || process.env.MYSQL_PORT,
  MYSQL_DATABASE: cli["mysql-database"] || process.env.MYSQL_DATABASE,
  MYSQL_USER: cli["mysql-user"] || process.env.MYSQL_USER,
  MYSQL_PASSWORD: cli["mysql-password"] || process.env.MYSQL_PASSWORD,
  ENTERSOFT_CUSTOMERS_FILE: cli["customers-file"] || process.env.ENTERSOFT_CUSTOMERS_FILE,
  ENTERSOFT_SALES_FILES: cli["sales-files"] || process.env.ENTERSOFT_SALES_FILES,
  ENTERSOFT_DAILY_INFO_FILE: cli["daily-info-file"] || process.env.ENTERSOFT_DAILY_INFO_FILE,
  ENTERSOFT_SKIP_CUSTOMERS: cli["skip-customers"] || process.env.ENTERSOFT_SKIP_CUSTOMERS,
};

const requiredEnv = ["MYSQL_DATABASE", "MYSQL_USER"];
const missing = requiredEnv.filter((key) => !String(effectiveEnv[key] || "").trim());
if (missing.length) {
  console.error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      "Set MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD in Plesk.",
  );
  process.exit(1);
}

function runPython(executable) {
  console.log(`[import] launching ${executable} with timeout=${timeoutSeconds}s`);
  return spawnSync(executable, ["-u", importerPath], {
    stdio: "inherit",
    env: effectiveEnv,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
}

function installDeps(executable) {
  console.log(`[import] installing PyMySQL with ${executable} -m pip install --user PyMySQL`);
  return spawnSync(executable, ["-m", "pip", "install", "--user", "PyMySQL"], {
    stdio: "inherit",
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
    if (depResult.error?.code === "ETIMEDOUT") {
      console.error(
        `[import] dependency install timed out after ${timeoutSeconds}s and was terminated.`,
      );
      process.exit(124);
    }
    if (!depResult.error && typeof depResult.status === "number" && depResult.status !== 0) {
      process.exit(depResult.status);
    }
  }

  const result = runPython(exe);
  if (!result.error && result.status === 0) {
    process.exit(0);
  }
  if (result.error?.code === "ETIMEDOUT") {
    console.error(
      `[import] timed out after ${timeoutSeconds}s and was terminated. ` +
        "Increase ENTERSOFT_IMPORT_TIMEOUT_SECONDS if needed.",
    );
    process.exit(124);
  }
  if (!result.error && typeof result.status === "number") {
    process.exit(result.status);
  }
  lastError = result.error;
}

console.error(`Failed to run importer with python3/python: ${lastError?.message || "unknown error"}`);
process.exit(1);
