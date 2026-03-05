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

const attempts = ["python3", "python"];
let lastError = null;

for (const exe of attempts) {
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
